/**
 * Unit tests for ensureFreshAccessToken's decision matrix in githubOAuth.ts:
 * vaults with vs. without a stored refresh token, the expiry-margin check and
 * its clock-jump guard, the `force` override, how the refresh endpoint's
 * answers are classified, and the per-vault single-flight that keeps two
 * callers from spending the same single-use refresh token.
 *
 * `@/storage/cache/credentials` is replaced with an in-memory fake so the test
 * doesn't need Dexie/IndexedDB. `fetch` is stubbed directly since exchangeForTokens
 * talks to the OAuth worker over HTTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransientSyncError } from '@/storage/conflictError'

const { tokenStore } = vi.hoisted(() => ({
  tokenStore: new Map<string, string | number>(),
}))

const { credentialsSaveMock } = vi.hoisted(() => ({
  credentialsSaveMock: vi.fn(),
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
  credentialsSave: credentialsSaveMock.mockImplementation(
    async (vaultId: string, c: { accessToken: string; refreshToken: string; expiresAt: number }) => {
      tokenStore.set(`token:${vaultId}`, c.accessToken)
      tokenStore.set(`refreshToken:${vaultId}`, c.refreshToken)
      tokenStore.set(`tokenExpiry:${vaultId}`, c.expiresAt)
    },
  ),
}))

import { ensureFreshAccessToken, OAuthCredentialError } from '@/storage/githubOAuth'

const REFRESH_MARGIN_MS     = 5 * 60_000
const MAX_TOKEN_LIFETIME_MS = 8 * 60 * 60_000

// Each test gets its own vault id: the single-flight chain and rotation count
// are module-level per-vault state that deliberately outlives a single call,
// so reusing one id across tests would leak a completed rotation into the next.
let nextVaultId = 0
let VAULT_ID = ''

function seed(opts: { token?: string; refreshToken?: string; expiresAt?: number }): void {
  if (opts.token !== undefined) tokenStore.set(`token:${VAULT_ID}`, opts.token)
  if (opts.refreshToken !== undefined) tokenStore.set(`refreshToken:${VAULT_ID}`, opts.refreshToken)
  if (opts.expiresAt !== undefined) tokenStore.set(`tokenExpiry:${VAULT_ID}`, opts.expiresAt)
}

/** A worker response: `status` matters now that 5xx is classified as transient. */
function mockFetchOnce(response: { status?: number; body: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    status: response.status ?? 200,
    json: async () => response.body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const ROTATED = { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }

beforeEach(() => {
  tokenStore.clear()
  credentialsSaveMock.mockClear()
  vi.unstubAllGlobals()
  VAULT_ID = `vault-${++nextVaultId}`
})

describe('ensureFreshAccessToken — no stored token', () => {
  it('reports no-credential without touching the network', async () => {
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'no-credential' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ensureFreshAccessToken — vault with no stored refresh token', () => {
  it('passes the token through unchanged on a non-forced call', async () => {
    seed({ token: 'legacy-token' })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'legacy-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports needs-reauth on a forced call instead of handing back the token that just failed', async () => {
    seed({ token: 'legacy-token' })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID, { force: true })

    expect(result).toEqual({ status: 'needs-reauth', token: 'legacy-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ensureFreshAccessToken — OAuth-managed vault, margin check', () => {
  it('returns the existing token without refreshing when far from expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 60 * 60_000 })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'access-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when within the 5-minute margin of expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + REFRESH_MARGIN_MS - 1000 })
    mockFetchOnce({ body: ROTATED })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'access-2' })
  })

  it('refreshes when no expiry has ever been recorded', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1' })
    const fetchMock = mockFetchOnce({ body: ROTATED })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'access-2' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // The local clock is a hint, not the authority — but a backward clock jump
  // could otherwise park a dead token behind an expiry that never arrives.
  it('disbelieves an expiry further out than a token can possibly live', async () => {
    seed({
      token:        'access-1',
      refreshToken: 'refresh-1',
      expiresAt:    Date.now() + MAX_TOKEN_LIFETIME_MS + 60_000,
    })
    const fetchMock = mockFetchOnce({ body: ROTATED })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'access-2' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('trusts an expiry at the edge of a full token lifetime', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + MAX_TOKEN_LIFETIME_MS - 60_000 })
    const fetchMock = mockFetchOnce({ body: {} })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'access-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('force bypasses the margin check and refreshes even when far from expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 60 * 60_000 })
    const fetchMock = mockFetchOnce({ body: ROTATED })

    const result = await ensureFreshAccessToken(VAULT_ID, { force: true })

    expect(result).toEqual({ status: 'ok', token: 'access-2' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ensureFreshAccessToken — refresh success', () => {
  it('persists the new access token, refresh token, and expiry', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    const before = Date.now()
    mockFetchOnce({ body: ROTATED })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'ok', token: 'access-2' })
    expect(tokenStore.get(`token:${VAULT_ID}`)).toBe('access-2')
    expect(tokenStore.get(`refreshToken:${VAULT_ID}`)).toBe('refresh-2')
    expect(tokenStore.get(`tokenExpiry:${VAULT_ID}`)).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })
})

// The distinction this whole PR exists for: "GitHub refused the grant" is
// definitive and only a fresh sign-in fixes it, while "we could not ask" says
// nothing at all about the credential and must never be reported as if it did.
describe('ensureFreshAccessToken — classifying the refresh endpoint\'s answer', () => {
  const DEAD: { label: string; body: unknown }[] = [
    { label: 'invalid_grant',         body: { error: 'invalid_grant', error_description: 'refresh token revoked' } },
    { label: 'bad_refresh_token',     body: { error: 'bad_refresh_token', error_description: 'The refresh token is incorrect or expired.' } },
    { label: 'expired_token',         body: { error: 'expired_token', error_description: 'expired' } },
    { label: 'access_denied',         body: { error: 'access_denied', error_description: 'revoked by the user' } },
    { label: 'bad_verification_code', body: { error: 'bad_verification_code', error_description: 'already used' } },
  ]

  it.each(DEAD)('reports needs-reauth for $label, keeping the stale token stored', async ({ body }) => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    mockFetchOnce({ body })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'needs-reauth', token: 'stale-access' })
    expect(credentialsSaveMock).not.toHaveBeenCalled()
    expect(tokenStore.get(`token:${VAULT_ID}`)).toBe('stale-access')
  })

  const RETRYABLE: { label: string; mock: () => void }[] = [
    {
      label: 'a rejected fetch (offline, DNS, backgrounded request)',
      mock:  () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))),
    },
    {
      label: 'an iOS Safari network drop',
      mock:  () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The network connection was lost.'))),
    },
    {
      label: 'a non-JSON body from an edge error page',
      mock:  () => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 502,
        json:   async () => { throw new SyntaxError('Unexpected token <') },
      })),
    },
    {
      label: 'the Worker reporting it could not reach GitHub',
      mock:  () => { mockFetchOnce({ status: 502, body: { error: 'server_error', error_description: 'Could not reach GitHub' } }) },
    },
    {
      label: 'a GitHub 500',
      mock:  () => { mockFetchOnce({ status: 500, body: { error: 'server_error' } }) },
    },
    {
      label: 'a 429 from the token endpoint',
      mock:  () => { mockFetchOnce({ status: 429, body: { error: 'too_many_requests' } }) },
    },
  ]

  it.each(RETRYABLE)('reports transient for $label, never blaming the credential', async ({ mock }) => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    mock()

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'transient', token: 'stale-access' })
    expect(tokenStore.get(`refreshToken:${VAULT_ID}`)).toBe('refresh-1')
  })

  // An App-configuration fault is not the user's to fix. It is not transient
  // either, but signing in again would fail identically — so it must not be
  // reported as needs-reauth.
  it('reports transient, not needs-reauth, for an App-configuration fault', async () => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    mockFetchOnce({ status: 400, body: { error: 'incorrect_client_credentials', error_description: 'bad secret' } })

    const result = await ensureFreshAccessToken(VAULT_ID)

    expect(result).toEqual({ status: 'transient', token: 'stale-access' })
  })

  it('reports transient on a forced call too, so a blip is not read as a dead credential', async () => {
    seed({ token: 'stale-access', refreshToken: 'refresh-1', expiresAt: Date.now() + 60 * 60_000 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await ensureFreshAccessToken(VAULT_ID, { force: true })

    expect(result).toEqual({ status: 'transient', token: 'stale-access' })
  })

  it('carries GitHub\'s own code on OAuthCredentialError', () => {
    const e = new OAuthCredentialError('The refresh token is incorrect or expired.', 'bad_refresh_token')
    expect(e.code).toBe('bad_refresh_token')
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(TransientSyncError)
  })
})

// The refresh token is single-use: GitHub invalidates the one presented on
// every exchange. Two concurrent rotations race to spend it and the loser is
// permanently dead — the failure this suite exists to make impossible.
describe('ensureFreshAccessToken — single-flight per vault', () => {
  it('spends the refresh token once when two callers race', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    const fetchMock = mockFetchOnce({ body: ROTATED })

    const [a, b] = await Promise.all([
      ensureFreshAccessToken(VAULT_ID),
      ensureFreshAccessToken(VAULT_ID),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ status: 'ok', token: 'access-2' })
    expect(b).toEqual({ status: 'ok', token: 'access-2' })
  })

  it('lets a forced call ride a rotation that completed while it waited', async () => {
    // Far from expiry, so the non-forced caller ahead of it would have skipped
    // the rotation entirely had a second one not been due.
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    const fetchMock = mockFetchOnce({ body: ROTATED })

    const [first, forced] = await Promise.all([
      ensureFreshAccessToken(VAULT_ID),
      ensureFreshAccessToken(VAULT_ID, { force: true }),
    ])

    expect(first).toEqual({ status: 'ok', token: 'access-2' })
    expect(forced).toEqual({ status: 'ok', token: 'access-2' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // The other half of the join rule: a forced call must not be handed the
  // very token it already watched 401 just because a non-forced call was
  // in flight and decided nothing needed doing.
  it('still rotates when the call it queued behind decided no refresh was due', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 60 * 60_000 })
    const fetchMock = mockFetchOnce({ body: ROTATED })

    const [passthrough, forced] = await Promise.all([
      ensureFreshAccessToken(VAULT_ID),
      ensureFreshAccessToken(VAULT_ID, { force: true }),
    ])

    expect(passthrough).toEqual({ status: 'ok', token: 'access-1' })
    expect(forced).toEqual({ status: 'ok', token: 'access-2' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not let one caller\'s failure reject the calls queued behind it', async () => {
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const results = await Promise.all([
      ensureFreshAccessToken(VAULT_ID),
      ensureFreshAccessToken(VAULT_ID, { force: true }),
      ensureFreshAccessToken(VAULT_ID),
    ])

    for (const r of results) expect(r.status).toBe('transient')
  })

  it('does not serialize across different vaults', async () => {
    const other = `vault-${++nextVaultId}`
    seed({ token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 })
    tokenStore.set(`token:${other}`, 'other-access-1')
    tokenStore.set(`refreshToken:${other}`, 'other-refresh-1')
    tokenStore.set(`tokenExpiry:${other}`, Date.now() - 1000)
    const fetchMock = mockFetchOnce({ body: ROTATED })

    await Promise.all([ensureFreshAccessToken(VAULT_ID), ensureFreshAccessToken(other)])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
