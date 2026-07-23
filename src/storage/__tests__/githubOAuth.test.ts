/**
 * Unit tests for ensureFreshAccessToken's decision matrix in githubOAuth.ts:
 * PAT- vs OAuth-managed vaults, the expiry-margin check, the `force` override,
 * and how refresh success/failure feed back into the caller.
 *
 * `@/storage/cache` is replaced with an in-memory fake so the test doesn't
 * need Dexie/IndexedDB. `fetch` is stubbed directly since exchangeForTokens
 * talks to the OAuth worker over HTTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { tokenStore } = vi.hoisted(() => ({
  tokenStore: new Map<string, string | number>(),
}))

vi.mock('@/storage/cache', () => ({
  tokenLoad: vi.fn(async (vaultId: string) => {
    const v = tokenStore.get(`token:${vaultId}`)
    return typeof v === 'string' ? v : null
  }),
  tokenSave: vi.fn(async (vaultId: string, token: string) => {
    tokenStore.set(`token:${vaultId}`, token)
  }),
  refreshTokenLoad: vi.fn(async (vaultId: string) => {
    const v = tokenStore.get(`refreshToken:${vaultId}`)
    return typeof v === 'string' ? v : null
  }),
  refreshTokenSave: vi.fn(async (vaultId: string, token: string) => {
    tokenStore.set(`refreshToken:${vaultId}`, token)
  }),
  tokenExpiryLoad: vi.fn(async (vaultId: string) => {
    const v = tokenStore.get(`tokenExpiry:${vaultId}`)
    return typeof v === 'number' ? v : null
  }),
  tokenExpirySave: vi.fn(async (vaultId: string, expiresAt: number) => {
    tokenStore.set(`tokenExpiry:${vaultId}`, expiresAt)
  }),
}))

import { ensureFreshAccessToken } from '@/storage/githubOAuth'

const VAULT_ID = 'vault-1'
const REFRESH_MARGIN_MS = 5 * 60_000

function seed(opts: { token?: string; refreshToken?: string; expiresAt?: number }): void {
  if (opts.token !== undefined) tokenStore.set(`token:${VAULT_ID}`, opts.token)
  if (opts.refreshToken !== undefined) tokenStore.set(`refreshToken:${VAULT_ID}`, opts.refreshToken)
  if (opts.expiresAt !== undefined) tokenStore.set(`tokenExpiry:${VAULT_ID}`, opts.expiresAt)
}

function mockFetchOnce(response: { ok?: boolean; body: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    json: async () => response.body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  tokenStore.clear()
  vi.unstubAllGlobals()
})

describe('ensureFreshAccessToken — no stored token', () => {
  it('returns null without touching the network', async () => {
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ensureFreshAccessToken — PAT-managed vault (no refresh token)', () => {
  it('passes the token through unchanged on a non-forced call', async () => {
    seed({ token: 'pat-token' })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('pat-token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on a forced call instead of handing back the token that just failed', async () => {
    seed({ token: 'pat-token' })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID, { force: true })

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ensureFreshAccessToken — OAuth-managed vault, margin check', () => {
  it('returns the existing token without refreshing when far from expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 60 * 60_000 })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('access-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when within the 5-minute margin of expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + REFRESH_MARGIN_MS - 1000 })
    mockFetchOnce({
      body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
    })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('access-2')
  })

  it('refreshes when no expiry has ever been recorded', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1' })
    const fetchMock = mockFetchOnce({
      body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
    })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('access-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('force bypasses the margin check and refreshes even when far from expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 60 * 60_000 })
    const fetchMock = mockFetchOnce({
      body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
    })

    const result = await ensureFreshAccessToken(VAULT_ID, { force: true })

    expect(result).toBe('access-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ensureFreshAccessToken — refresh success', () => {
  it('persists the new access token, refresh token, and expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    const before = Date.now()
    mockFetchOnce({
      body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
    })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('access-2')
    expect(tokenStore.get(`token:${VAULT_ID}`)).toBe('access-2')
    expect(tokenStore.get(`refreshToken:${VAULT_ID}`)).toBe('refresh-2')
    expect(tokenStore.get(`tokenExpiry:${VAULT_ID}`)).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })
})

describe('ensureFreshAccessToken — refresh failure', () => {
  it('falls back to the stale token on a non-forced call, without persisting anything', async () => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    mockFetchOnce({ body: { error: 'invalid_grant', error_description: 'refresh token revoked' } })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('stale-access')
    expect(tokenStore.get(`token:${VAULT_ID}`)).toBe('stale-access')
  })

  it('returns null on a forced call so the caller knows recovery is impossible', async () => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1' })
    mockFetchOnce({ body: { error: 'invalid_grant', error_description: 'refresh token revoked' } })

    const result = await ensureFreshAccessToken(VAULT_ID, { force: true })

    expect(result).toBeNull()
  })

  it('treats a network rejection the same as a malformed response', async () => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toBe('stale-access')
  })
})
