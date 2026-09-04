import { tokenLoad, refreshTokenLoad, tokenExpiryLoad, credentialsSave } from './cache/credentials'
import { TransientSyncError } from './conflictError'
import { WORKER_ORIGIN } from './workerOrigin'
import { journal } from './syncJournal'

const GITHUB_CLIENT_ID = 'Iv23liMpUq1CUQl4TcaT'
export const GITHUB_APP_INSTALL_URL = 'https://github.com/apps/realjohndoe-meridian/installations/new'

/** The deployed app's URL — also where an invite message sends a collaborator. */
export const APP_URL = 'https://realjohndoe.github.io/meridian/'

const REDIRECT_URI = `${APP_URL}auth/callback`

const VERIFIER_KEY = 'meridian_oauth_verifier'
const STATE_KEY = 'meridian_oauth_state'
const RECONNECT_KEY = 'meridian_oauth_reconnect'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export class OAuthCallbackError extends Error {}

/**
 * Kicks off the GitHub App sign-in flow via a full-page redirect.
 *
 * `reconnectVaultId`, when given, marks this sign-in as re-authenticating an
 * *existing* vault rather than adding a new one — `auth/callback` reads it
 * back (via `completeGitHubSignIn`) once it has validated the returned state
 * and verifier, never before and never as a substitute for that check.
 */
export async function startGitHubSignIn(opts?: { reconnectVaultId?: string }): Promise<void> {
  const verifier = randomBase64url(32)
  const state = randomBase64url(16)
  const challenge = await codeChallengeFor(verifier)

  // sessionStorage survives the redirect to github.com and back (same tab),
  // but not a new tab — the flow must stay in one tab, which a full-page
  // redirect naturally does.
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  if (opts?.reconnectVaultId) sessionStorage.setItem(RECONNECT_KEY, opts.reconnectVaultId)
  else sessionStorage.removeItem(RECONNECT_KEY)

  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  window.location.href = url.toString()
}

export interface OAuthTokens {
  accessToken:  string
  refreshToken: string
  expiresAt:    number // ms epoch
  /**
   * Set only by `completeGitHubSignIn`, and only when this sign-in started
   * from `startGitHubSignIn({ reconnectVaultId })`. Carried on the resolved
   * value rather than a side channel so a caller can never read it before the
   * state/verifier check that gates whether this promise resolves at all.
   */
  reconnectVaultId?: string
}

/**
 * GitHub rejected the credential itself. Definitive: the grant is gone and no
 * amount of retrying brings it back — the only cure is a fresh sign-in.
 *
 * Extends `OAuthCallbackError` so the sign-in screen keeps rendering its
 * message verbatim; the subclass exists so the *refresh* path can tell "this
 * credential is dead" apart from "we could not ask".
 */
export class OAuthCredentialError extends OAuthCallbackError {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'OAuthCredentialError'
  }
}

/**
 * GitHub `error` codes that mean the presented grant is permanently gone.
 *
 * The list is deliberately short. Getting it wrong is expensive in both
 * directions: a code treated as terminal that isn't nags the user to sign in
 * again for nothing, and a genuinely dead credential treated as recoverable
 * hides behind an infinite retry — the exact shape of the bug this file's
 * single-flight machinery exists to close. So a code is only listed here when
 * it names *the grant we sent*, never when it names the app or the request.
 *
 * Everything else GitHub can answer with — `incorrect_client_credentials`,
 * `redirect_uri_mismatch`, `unsupported_grant_type`, `application_suspended` —
 * is a fault in Meridian's own App configuration. Those are not transient, but
 * they are also not a verdict on the user's credential: signing in again would
 * fail identically, so they must never be reported as "sign in again".
 */
const DEAD_GRANT_ERRORS = new Set([
  'invalid_grant',         // OAuth 2.0's own code for a rejected/expired/revoked grant
  'bad_refresh_token',     // GitHub's spelling of the same thing on the refresh leg
  'expired_token',         // the refresh token aged out (6 months, or the App was reinstalled)
  'bad_verification_code', // authorization-code leg: the code was already spent or expired
  'access_denied',         // the user or an org admin revoked the authorization
])

/**
 * Statuses that carry no verdict on the credential — the endpoint is unwell,
 * not the grant.
 *
 * Deliberately *not* `classifyFailure` from `failureKind.ts`, which answers a
 * different question about a different object: it classifies a thrown GitHub
 * API error, where the absence of a status is itself the signal and 401 means
 * "refresh the credential". Here the subject is the token endpoint's own
 * `Response` — it always has a status, a rejected grant arrives as **200 with
 * an error body**, and 401 would mean the refresh we are already performing.
 * Its fall-through ("any other status is transient") is the part that must not
 * be borrowed: a 400 carrying `invalid_grant` has to reach the check below.
 * The one row the two share is this one, so keep it in step with
 * `classifyFailure`'s 408/429/5xx row.
 */
function isUnwellStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

/**
 * POSTs to the Worker's token endpoint and classifies whatever comes back.
 *
 * Three outcomes, and keeping them apart is the point:
 *
 * - success — tokens.
 * - `TransientSyncError` — the request never got an answer from GitHub: the
 *   network dropped, the Worker or Cloudflare answered instead, or GitHub is
 *   having a bad day. The stored credential is untouched and uncondemned.
 * - `OAuthCredentialError` / `OAuthCallbackError` — GitHub answered, and the
 *   answer was a refusal. Only the former means the credential is dead.
 *
 * Collapsing the first two is what used to report a Worker hiccup as a bad
 * credential; `DEAD_GRANT_ERRORS` above is where that line is drawn.
 */
async function exchangeForTokens(body: Record<string, string>): Promise<OAuthTokens> {
  let res: Response
  try {
    res = await fetch(`${WORKER_ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
  } catch {
    // Never reached the Worker: offline, DNS, captive portal, or the request
    // was killed by backgrounding. Nothing about this is a credential.
    throw new TransientSyncError('Could not reach GitHub to refresh sign-in.')
  }

  let data: Record<string, unknown>
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    // The Worker forwards GitHub's JSON verbatim, so a non-JSON body means
    // something in front of it answered instead — an edge error page, a
    // captive portal's login form. Transient by construction.
    throw new TransientSyncError('Sign-in service returned an unexpected response.')
  }

  if (typeof data.access_token === 'string' && typeof data.refresh_token === 'string' && typeof data.expires_in === 'number') {
    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
    }
  }

  const code = typeof data.error === 'string' ? data.error : null
  const description = typeof data.error_description === 'string' ? data.error_description : 'Token exchange failed.'

  if (isUnwellStatus(res.status)) throw new TransientSyncError(description)
  if (code !== null && DEAD_GRANT_ERRORS.has(code)) throw new OAuthCredentialError(description, code)
  throw new OAuthCallbackError(description)
}

/**
 * Consumes the `code`/`state` GitHub redirected back with, validating against
 * the verifier/state stashed in sessionStorage before the redirect, then
 * exchanges the code for tokens via the Worker.
 */
export async function completeGitHubSignIn(searchParams: URLSearchParams): Promise<OAuthTokens> {
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const storedVerifier = sessionStorage.getItem(VERIFIER_KEY)
  const storedState = sessionStorage.getItem(STATE_KEY)
  // Read and cleared alongside the verifier/state on every path through this
  // function — success, failure, or retry — so a stale reconnect id can never
  // outlive the sign-in attempt it was stashed for. It is attached to the
  // return value below only once the checks past this point have passed.
  const reconnectVaultId = sessionStorage.getItem(RECONNECT_KEY) ?? undefined
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(RECONNECT_KEY)

  if (error) throw new OAuthCallbackError(`GitHub sign-in was not completed (${error}).`)
  if (!code) throw new OAuthCallbackError('Missing authorization code from GitHub.')
  if (!storedVerifier || !storedState) throw new OAuthCallbackError('Sign-in session expired — please try again.')
  if (state !== storedState) throw new OAuthCallbackError('Sign-in state mismatch — please try again.')

  const tokens = await exchangeForTokens({ grant_type: 'authorization_code', code, code_verifier: storedVerifier })
  return reconnectVaultId ? { ...tokens, reconnectVaultId } : tokens
}

/** Silently exchanges a refresh token for a fresh access token + refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  return exchangeForTokens({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

const REFRESH_MARGIN_MS = 5 * 60_000 // refresh if expiring within 5 minutes
/**
 * A GitHub App user access token lives 8 hours. Nothing we store can
 * legitimately claim to outlast that — see `refreshDue` for why we care.
 */
const MAX_TOKEN_LIFETIME_MS = 8 * 60 * 60_000

/**
 * Whether the stored expiry says a refresh is due.
 *
 * **The local clock is a hint here, never the authority.** The authority is
 * GitHub's 401, which `sync.ts` turns into a forced refresh that skips this
 * check entirely. That split is what makes clock skew safe to live with:
 *
 * - `expiresAt` is written as `Date.now() + expires_in`, so a clock that is
 *   merely *offset* — even by hours — cancels out: both ends of the
 *   subtraction below use the same wrong clock. Only a clock that *jumps*
 *   between the write and the read can mislead this check at all.
 * - A jump forward makes a live token look expired, so we refresh early.
 *   Harmless: rotation is atomic (`credentialsSave`) and single-flight (below).
 * - A jump backward makes an expired token look live, suppressing the refresh
 *   until the API 401s — and that 401 is exactly what the forced path is for,
 *   so it self-heals within one sync cycle.
 *
 * The one case worth catching here is a backward jump large enough to suppress
 * refreshes *indefinitely*: an expiry further out than a token can possibly
 * live is not a valid expiry, so it is disbelieved rather than trusted.
 */
function refreshDue(expiresAt: number | null): boolean {
  if (expiresAt === null) return true
  const now = Date.now()
  if (expiresAt - now > MAX_TOKEN_LIFETIME_MS) return true
  return now >= expiresAt - REFRESH_MARGIN_MS
}

/**
 * What `ensureFreshAccessToken` found. The failure variants still carry the
 * last known access token: a non-forced caller can carry on with it exactly as
 * before (the caller's own API call is the real test), while a forced caller —
 * one that already watched that token 401 — ignores it and acts on `status`.
 */
export type FreshTokenResult =
  /** Usable: freshly rotated, or stored and not yet due for rotation. */
  | { status: 'ok';           token: string }
  /** The refresh could not be *asked* — network, Worker, or GitHub 5xx. Retry later; the credential is not implicated. */
  | { status: 'transient';    token: string }
  /** GitHub refused the grant, or there is nothing left to refresh with. Only a fresh sign-in fixes this. */
  | { status: 'needs-reauth'; token: string }
  /** No access token stored for this vault at all. */
  | { status: 'no-credential' }

/**
 * Per-vault serialization of the whole read-decide-rotate-store sequence, and
 * a count of completed rotations.
 *
 * The refresh token is **single-use**: GitHub rotates it on every exchange and
 * invalidates the one presented. Two overlapping refreshes therefore race to
 * spend the same token, and the loser gets `bad_refresh_token` — a permanent
 * failure for a vault whose credential was in fact fine, recoverable only by
 * signing in again. Deduping just the network call would not be enough: a
 * caller that read the old refresh token *before* a rotation would still spend
 * it afterwards. So the storage reads are inside the critical section too.
 */
const refreshChains   = new Map<string, Promise<unknown>>()
const rotationCounts  = new Map<string, number>()

/** Runs `fn` after any previously queued work for this vault, whatever its outcome. */
function serializePerVault<T>(vaultId: string, fn: () => Promise<T>): Promise<T> {
  const previous = refreshChains.get(vaultId) ?? Promise.resolve()
  const next     = previous.then(fn, fn)
  // The chain is only a turnstile — a predecessor's rejection must not reject
  // every call queued behind it, so what is stored is a swallowed copy.
  refreshChains.set(vaultId, next.catch(() => undefined))
  return next
}

/**
 * Returns a usable access token for a GitHub vault, rotating it first if the
 * stored expiry says it is due — or unconditionally when `force` is set, which
 * is what `sync.ts` does after a live API call came back 401 despite a
 * fresh-looking local expiry.
 *
 * **Why a forced call queues behind an in-flight call rather than joining it:**
 * a non-forced call may legitimately decide no rotation is needed and hand back
 * the very token that just 401'd. Joining it would return a known-dead token to
 * the one caller that already knows it is dead. Queuing costs a turn and
 * re-decides against the storage state the predecessor left behind.
 *
 * **And why that does not double-rotate:** the counterpart hazard is the forced
 * call spending a second single-use refresh token on top of a rotation that
 * just completed. A forced caller records the vault's rotation count on entry;
 * if that count moved while it waited, the stored token is strictly newer than
 * the one it saw fail, so it takes that token instead of rotating again. (If
 * that token also 401s, `runSync`'s one-shot `attemptedRefresh` guard stops the
 * loop — there is no path here that retries forever.)
 *
 * A vault with no stored refresh token predates the "Sign in with GitHub" flow.
 * Its token passes through untouched on a non-forced call; a forced call means
 * that token just failed, and for a credential that cannot be refreshed the
 * only cure is signing in.
 */
export async function ensureFreshAccessToken(vaultId: string, opts?: { force?: boolean }): Promise<FreshTokenResult> {
  const force         = opts?.force ?? false
  // Sampled before queuing, so it reflects what this caller knew when it decided to force.
  const rotationsSeen = rotationCounts.get(vaultId) ?? 0
  return serializePerVault(vaultId, () => resolveFreshToken(vaultId, force, rotationsSeen))
}

/** The body of `ensureFreshAccessToken`, always running inside the per-vault turnstile. */
async function resolveFreshToken(vaultId: string, force: boolean, rotationsSeen: number): Promise<FreshTokenResult> {
  const token = await tokenLoad(vaultId)
  if (!token) return { status: 'no-credential' }

  const refreshToken = await refreshTokenLoad(vaultId)
  if (!refreshToken) return force ? { status: 'needs-reauth', token } : { status: 'ok', token }

  if (force) {
    if ((rotationCounts.get(vaultId) ?? 0) > rotationsSeen) return { status: 'ok', token }
  } else if (!refreshDue(await tokenExpiryLoad(vaultId))) {
    return { status: 'ok', token }
  }

  journal('auth-refresh', vaultId, undefined, undefined, 'github')
  try {
    const fresh = await refreshAccessToken(refreshToken)
    await credentialsSave(vaultId, fresh)
    rotationCounts.set(vaultId, (rotationCounts.get(vaultId) ?? 0) + 1)
    journal('auth-refreshed', vaultId, undefined, undefined, 'github')
    return { status: 'ok', token: fresh.accessToken }
  } catch (e) {
    if (e instanceof OAuthCredentialError) {
      console.warn(`[oauth] GitHub rejected the refresh token for ${vaultId} (${e.code}) — sign-in required`)
      journal('auth-failed', vaultId, undefined, { kind: 'auth', note: e.code }, 'github')
      return { status: 'needs-reauth', token }
    }
    // Everything that is not a refusal of the grant is treated as retryable,
    // including an App-configuration fault: those are not the user's to fix,
    // and telling them to sign in again would achieve nothing. They stay
    // visible in the console and, now, the sync journal's "Copy details"
    // rather than in a misdirected prompt.
    console.warn(`[oauth] token refresh for ${vaultId} could not complete:`, e)
    journal('auth-failed', vaultId, undefined, { kind: 'transient' }, 'github')
    return { status: 'transient', token }
  }
}

export interface InstalledRepo {
  owner:  string
  repo:   string
  branch: string
}

type Installation = { id: number }
type InstallationsResponse = { installations: Installation[] }
type InstalledRepository = { name: string; default_branch: string; owner: { login: string } }
type RepositoriesResponse = { repositories: InstalledRepository[] }

/** Repos the GitHub App is installed on, across all of the user's installations. */
export async function fetchInstalledRepos(accessToken: string): Promise<InstalledRepo[]> {
  const { makeOctokit } = await import('./githubApi')
  const octokit = makeOctokit(accessToken)
  const { data: installData } = await octokit.request('GET /user/installations')
  const installations = (installData as InstallationsResponse).installations

  const repos: InstalledRepo[] = []
  for (const installation of installations) {
    const { data: repoData } = await octokit.request('GET /user/installations/{installation_id}/repositories', {
      installation_id: installation.id,
    })
    for (const r of (repoData as RepositoriesResponse).repositories) {
      repos.push({ owner: r.owner.login, repo: r.name, branch: r.default_branch })
    }
  }
  return repos
}
