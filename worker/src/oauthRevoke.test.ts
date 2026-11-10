import { describe, it, expect, vi } from 'vitest'
import { handleOAuthRevoke } from './oauthRevoke'
import type { Env } from './env'

const env: Env = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-secret',
  ALLOWED_ORIGIN: 'https://app.example',
  ICAL_RATE_LIMIT: { limit: () => Promise.reject(new Error('must not consult the iCal rate limit')) },
}

function formRequest(fields: Record<string, string>): Request {
  return new Request('https://worker.example/oauth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })
}

describe('handleOAuthRevoke', () => {
  it('revokes the token with the app credentials', async () => {
    const revoke = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    const res = await handleOAuthRevoke(formRequest({ access_token: 'gho_xyz' }), env, revoke)
    expect(res.status).toBe(204)
    expect(revoke).toHaveBeenCalledWith('test-client-id', 'test-secret', 'gho_xyz')
  })

  it('treats an already-invalid token (404) as revoked', async () => {
    const res = await handleOAuthRevoke(formRequest({ access_token: 'gho_old' }), env, () => Promise.resolve(new Response('{}', { status: 404 })))
    expect(res.status).toBe(204)
  })

  it('rejects a missing access_token', async () => {
    const revoke = vi.fn()
    const res = await handleOAuthRevoke(formRequest({}), env, revoke)
    expect(res.status).toBe(400)
    expect(revoke).not.toHaveBeenCalled()
  })

  it('answers 502 when GitHub is unreachable or refuses', async () => {
    const down = await handleOAuthRevoke(formRequest({ access_token: 't' }), env, () => Promise.reject(new Error('down')))
    expect(down.status).toBe(502)
    const refused = await handleOAuthRevoke(formRequest({ access_token: 't' }), env, () => Promise.resolve(new Response('{}', { status: 403 })))
    expect(refused.status).toBe(502)
  })
})
