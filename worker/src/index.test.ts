import { describe, it, expect } from 'vitest'
import worker from './index'
import type { Env } from './env'
import { ALLOWED_ORIGIN } from './cors'

const env: Env = {
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  ICAL_RATE_LIMIT: { limit: () => Promise.resolve({ success: true }) },
}

describe('routing + CORS', () => {
  it('returns ok:true on /health', async () => {
    const res = await worker.fetch(new Request('https://worker.example/health'), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('404s on unknown paths', async () => {
    const res = await worker.fetch(new Request('https://worker.example/nope'), env)
    expect(res.status).toBe(404)
  })

  it('allows the Pages origin via CORS', async () => {
    const res = await worker.fetch(new Request('https://worker.example/health', { headers: { Origin: ALLOWED_ORIGIN } }), env)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
  })

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/health', { headers: { Origin: 'https://evil.example' } }),
      env,
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('responds to an OPTIONS preflight for the allowed origin', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/oauth/token', { method: 'OPTIONS', headers: { Origin: ALLOWED_ORIGIN } }),
      env,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN)
  })

  it('routes GET /ical to the calendar proxy, with the rate-limit binding attached', async () => {
    // No Origin header, so the proxy's own gate answers 403 rather than 404 —
    // which is what shows the route matched and `env` reached the handler. A
    // 500 here would mean the binding never got passed through.
    const res = await worker.fetch(new Request('https://worker.example/ical?url=https%3A%2F%2Fcal.example%2Ff.ics'), env)
    expect(res.status).toBe(403)
  })

  it('routes POST /oauth/token to the OAuth handler', async () => {
    const req = new Request('https://worker.example/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token', // missing refresh_token — expect a 400 from the handler, not a 404
    })
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(400)
  })
})
