import { describe, it, expect, vi } from 'vitest'
import { handleOAuthToken, type Env } from './oauthToken'

const env: Env = { GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET: 'test-secret' }

function formRequest(fields: Record<string, string>): Request {
  return new Request('https://worker.example/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })
}

describe('handleOAuthToken', () => {
  it('exchanges an authorization code, forwarding client credentials and code_verifier', async () => {
    const exchange = vi.fn(async (params: URLSearchParams) => {
      expect(params.get('client_id')).toBe('test-client-id')
      expect(params.get('client_secret')).toBe('test-secret')
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('code')).toBe('abc123')
      expect(params.get('code_verifier')).toBe('verifier123')
      return Response.json({
        access_token: 'gho_xyz',
        refresh_token: 'ghr_xyz',
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
      })
    })

    const res = await handleOAuthToken(
      formRequest({ grant_type: 'authorization_code', code: 'abc123', code_verifier: 'verifier123' }),
      env,
      exchange,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ access_token: 'gho_xyz' })
    expect(exchange).toHaveBeenCalledOnce()
  })

  it('refreshes an access token', async () => {
    const exchange = vi.fn(async (params: URLSearchParams) => {
      expect(params.get('grant_type')).toBe('refresh_token')
      expect(params.get('refresh_token')).toBe('ghr_old')
      return Response.json({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 })
    })

    const res = await handleOAuthToken(formRequest({ grant_type: 'refresh_token', refresh_token: 'ghr_old' }), env, exchange)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ access_token: 'gho_new' })
  })

  it('passes GitHub error responses straight through', async () => {
    const exchange = vi.fn(async () =>
      Response.json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }),
    )

    const res = await handleOAuthToken(
      formRequest({ grant_type: 'authorization_code', code: 'expired', code_verifier: 'v' }),
      env,
      exchange,
    )

    expect(await res.json()).toMatchObject({ error: 'bad_verification_code' })
  })

  it('rejects an unsupported grant_type without calling GitHub', async () => {
    const exchange = vi.fn()
    const res = await handleOAuthToken(formRequest({ grant_type: 'client_credentials' }), env, exchange)

    expect(res.status).toBe(400)
    expect(exchange).not.toHaveBeenCalled()
  })

  it('rejects an authorization_code grant missing code_verifier', async () => {
    const exchange = vi.fn()
    const res = await handleOAuthToken(formRequest({ grant_type: 'authorization_code', code: 'abc' }), env, exchange)

    expect(res.status).toBe(400)
    expect(exchange).not.toHaveBeenCalled()
  })

  it('rejects a refresh_token grant missing refresh_token', async () => {
    const exchange = vi.fn()
    const res = await handleOAuthToken(formRequest({ grant_type: 'refresh_token' }), env, exchange)

    expect(res.status).toBe(400)
    expect(exchange).not.toHaveBeenCalled()
  })
})
