import { makeOctokit } from './githubApi'
import { tokenLoad, tokenSave, refreshTokenLoad, refreshTokenSave, tokenExpiryLoad, tokenExpirySave } from './cache'

export const GITHUB_CLIENT_ID = 'Iv23liMpUq1CUQl4TcaT'
export const GITHUB_APP_INSTALL_URL = 'https://github.com/apps/realjohndoe-meridian/installations/new'

const WORKER_ORIGIN = 'https://meridian-oauth.realjohndoe.workers.dev'
const REDIRECT_URI = 'https://realjohndoe.github.io/meridian/auth/callback'

const VERIFIER_KEY = 'meridian_oauth_verifier'
const STATE_KEY = 'meridian_oauth_state'

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

/** Kicks off the GitHub App sign-in flow via a full-page redirect. */
export async function startGitHubSignIn(): Promise<void> {
  const verifier = randomBase64url(32)
  const state = randomBase64url(16)
  const challenge = await codeChallengeFor(verifier)

  // sessionStorage survives the redirect to github.com and back (same tab),
  // but not a new tab — the flow must stay in one tab, which a full-page
  // redirect naturally does.
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

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
}

async function exchangeForTokens(body: Record<string, string>): Promise<OAuthTokens> {
  const res = await fetch(`${WORKER_ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })

  const data = (await res.json()) as Record<string, unknown>
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.expires_in !== 'number') {
    const description = typeof data.error_description === 'string' ? data.error_description : 'Token exchange failed.'
    throw new OAuthCallbackError(description)
  }

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + data.expires_in * 1000,
  }
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
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)

  if (error) throw new OAuthCallbackError(`GitHub sign-in was not completed (${error}).`)
  if (!code) throw new OAuthCallbackError('Missing authorization code from GitHub.')
  if (!storedVerifier || !storedState) throw new OAuthCallbackError('Sign-in session expired — please try again.')
  if (state !== storedState) throw new OAuthCallbackError('Sign-in state mismatch — please try again.')

  return exchangeForTokens({ grant_type: 'authorization_code', code, code_verifier: storedVerifier })
}

/** Silently exchanges a refresh token for a fresh access token + refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  return exchangeForTokens({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

const REFRESH_MARGIN_MS = 5 * 60_000 // refresh if expiring within 5 minutes

/**
 * Returns a usable access token for a GitHub vault, refreshing it first if
 * it's OAuth-managed (has a stored refresh token) and expired or expiring
 * soon (or unconditionally, if `force` is set — used when a live API call
 * came back 401 despite a fresh-looking local expiry).
 *
 * PAT-managed vaults (no stored refresh token) pass through unchanged.
 * On a non-forced refresh failure, falls back to the existing (possibly
 * stale) token — the caller's own permission/API check will surface the
 * failure if it's truly invalid, same as before this existed. On a forced
 * refresh failure, returns null so the caller knows recovery isn't possible
 * and the original error should be surfaced.
 */
export async function ensureFreshAccessToken(vaultId: string, opts?: { force?: boolean }): Promise<string | null> {
  const token = await tokenLoad(vaultId)
  if (!token) return null

  const refreshToken = await refreshTokenLoad(vaultId)
  if (!refreshToken) {
    // PAT-managed — nothing to refresh. On a forced call (post-401 retry in
    // sync.ts), signal "can't recover" rather than handing back the same
    // token that just failed, so the caller doesn't retry pointlessly.
    return opts?.force ? null : token
  }

  if (!opts?.force) {
    const expiresAt = await tokenExpiryLoad(vaultId)
    if (expiresAt !== null && Date.now() < expiresAt - REFRESH_MARGIN_MS) return token
  }

  try {
    const fresh = await refreshAccessToken(refreshToken)
    await tokenSave(vaultId, fresh.accessToken)
    await refreshTokenSave(vaultId, fresh.refreshToken)
    await tokenExpirySave(vaultId, fresh.expiresAt)
    return fresh.accessToken
  } catch (e) {
    console.warn('[oauth] token refresh failed:', e)
    return opts?.force ? null : token
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
