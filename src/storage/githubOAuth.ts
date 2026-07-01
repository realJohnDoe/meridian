import { makeOctokit } from './githubApi'

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

  const res = await fetch(`${WORKER_ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: storedVerifier }).toString(),
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
