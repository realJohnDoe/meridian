/**
 * Coverage for two things `githubOAuth.ts` added around reusing an existing
 * GitHub sign-in for a *second* vault:
 *
 * - `fetchInstalledRepos` now pages through both `GET /user/installations`
 *   and each installation's `GET /user/installations/{id}/repositories`
 *   instead of reading only the first (default 30-item) page — the gap that
 *   could leave a just-installed repository invisible to the add-vault
 *   picker on an account with enough installations or enough repos selected
 *   on one installation to spill past page one.
 * - `findReusableGitHubSession` walks a list of existing GitHub vault ids
 *   looking for one whose stored credential is still good, so adding another
 *   vault for the same account can skip `startGitHubSignIn`'s full-page
 *   redirect entirely.
 *
 * `@/storage/cache/credentials` is faked in-memory, same as
 * `githubOAuth.test.ts`; `fetch` is stubbed directly to answer both the
 * GitHub REST calls this file makes and (if a test ever needs it) the OAuth
 * worker's token endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { tokenStore } = vi.hoisted(() => ({
  tokenStore: new Map<string, string | number>(),
}))

vi.mock('@/storage/cache/credentials', () => ({
  tokenLoad: vi.fn(async (vaultId: string) => {
    const v = tokenStore.get(`token:${vaultId}`)
    return typeof v === 'string' ? v : null
  }),
  refreshTokenLoad: vi.fn(async (vaultId: string) => {
    const v = tokenStore.get(`refreshToken:${vaultId}`)
    return typeof v === 'string' ? v : null
  }),
  tokenExpiryLoad: vi.fn(async (vaultId: string) => {
    const v = tokenStore.get(`tokenExpiry:${vaultId}`)
    return typeof v === 'number' ? v : null
  }),
  credentialsSave: vi.fn(async () => {}),
}))

import { fetchInstalledRepos, findReusableGitHubSession } from '@/storage/githubOAuth'

function seed(vaultId: string, opts: { token?: string; refreshToken?: string; expiresAt?: number }): void {
  if (opts.token !== undefined) tokenStore.set(`token:${vaultId}`, opts.token)
  if (opts.refreshToken !== undefined) tokenStore.set(`refreshToken:${vaultId}`, opts.refreshToken)
  if (opts.expiresAt !== undefined) tokenStore.set(`tokenExpiry:${vaultId}`, opts.expiresAt)
}

// Comfortably past the 5-minute refresh margin and under the 8-hour max
// lifetime, so `ensureFreshAccessToken` reports the stored token 'ok'
// without touching the (unmocked, in this file) token-refresh endpoint.
const FAR_FUTURE = () => Date.now() + 60 * 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches vitest's own Procedure = (...args: any[]) => any
let fetchSpy: ReturnType<typeof vi.fn<(...args: any[]) => any>>

function jsonResponse(body: unknown, status = 200) {
  return {
    ok:     status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json:   () => Promise.resolve(body),
    text:   () => Promise.resolve(JSON.stringify(body)),
  }
}

beforeEach(() => {
  tokenStore.clear()
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchInstalledRepos — pagination', () => {
  it('follows a second page of installations to find a repo only the second installation can see', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      const u = new URL(url)
      if (u.pathname === '/user/installations') {
        const page = Number(u.searchParams.get('page'))
        // Page one is a full page (100, the requested per_page) — the "short
        // page means last page" signal fetchInstalledRepos relies on would
        // wrongly stop here if pagination were missing.
        if (page === 1) return jsonResponse({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) })
        if (page === 2) return jsonResponse({ installations: [{ id: 101 }] })
        throw new Error(`unexpected installations page ${page}`)
      }
      const match = /^\/user\/installations\/(\d+)\/repositories$/.exec(u.pathname)
      if (match) {
        const id = Number(match[1])
        if (id === 101) return jsonResponse({ repositories: [{ name: 'second-repo', default_branch: 'main', owner: { login: 'me' } }] })
        return jsonResponse({ repositories: [] })
      }
      throw new Error(`unexpected request: ${url}`)
    })

    const repos = await fetchInstalledRepos('token')

    expect(repos).toEqual([{ owner: 'me', repo: 'second-repo', branch: 'main' }])
  })

  it('follows a second page of one installation\'s own repositories', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      const u = new URL(url)
      if (u.pathname === '/user/installations') return jsonResponse({ installations: [{ id: 1 }] })
      if (u.pathname === '/user/installations/1/repositories') {
        const page = Number(u.searchParams.get('page'))
        if (page === 1) {
          return jsonResponse({
            repositories: Array.from({ length: 100 }, (_, i) => ({ name: `repo-${i}`, default_branch: 'main', owner: { login: 'me' } })),
          })
        }
        if (page === 2) return jsonResponse({ repositories: [{ name: 'second-repo', default_branch: 'main', owner: { login: 'me' } }] })
        throw new Error(`unexpected repositories page ${page}`)
      }
      throw new Error(`unexpected request: ${url}`)
    })

    const repos = await fetchInstalledRepos('token')

    expect(repos).toHaveLength(101)
    expect(repos).toContainEqual({ owner: 'me', repo: 'second-repo', branch: 'main' })
  })
})

describe('findReusableGitHubSession', () => {
  it('returns null given no candidate vaults', async () => {
    await expect(findReusableGitHubSession([])).resolves.toBeNull()
  })

  it('returns null when no candidate has any stored credential', async () => {
    await expect(findReusableGitHubSession(['v1', 'v2'])).resolves.toBeNull()
  })

  it('skips a vault predating the OAuth flow (token but no refresh token)', async () => {
    seed('v1', { token: 'legacy-token' })

    await expect(findReusableGitHubSession(['v1'])).resolves.toBeNull()
  })

  it('reuses the first vault whose token is still good, labelling it with the account login', async () => {
    seed('v1', { token: 'access-1', refreshToken: 'refresh-1', expiresAt: FAR_FUTURE() })
    fetchSpy.mockImplementation(async (url: string) => {
      if (new URL(url).pathname === '/user') return jsonResponse({ login: 'octocat' })
      throw new Error(`unexpected request: ${url}`)
    })

    await expect(findReusableGitHubSession(['v1'])).resolves.toEqual({
      accessToken:  'access-1',
      refreshToken: 'refresh-1',
      expiresAt:    tokenStore.get('tokenExpiry:v1'),
      login:        'octocat',
    })
  })

  it('moves on to the next candidate when GET /user rejects the first token', async () => {
    seed('v1', { token: 'dead-access', refreshToken: 'refresh-1', expiresAt: FAR_FUTURE() })
    seed('v2', { token: 'access-2', refreshToken: 'refresh-2', expiresAt: FAR_FUTURE() })
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname !== '/user') throw new Error(`unexpected request: ${url}`)
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? ''
      if (auth.includes('dead-access')) return jsonResponse({ message: 'Bad credentials' }, 401)
      return jsonResponse({ login: 'octocat' })
    })

    await expect(findReusableGitHubSession(['v1', 'v2'])).resolves.toEqual({
      accessToken:  'access-2',
      refreshToken: 'refresh-2',
      expiresAt:    tokenStore.get('tokenExpiry:v2'),
      login:        'octocat',
    })
  })
})
