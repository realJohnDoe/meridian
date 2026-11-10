import { handleOAuthToken } from './oauthToken'
import { handleOAuthRevoke } from './oauthRevoke'
import type { Env } from './env'
import { handleIcalFetch } from './icalFetch'
import { corsHeadersFor } from './cors'

function withCors(response: Response, cors: HeadersInit): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of new Headers(cors)) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const cors = corsHeadersFor(request.headers.get('Origin'), env.ALLOWED_ORIGIN)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (url.pathname === '/health') {
      return withCors(Response.json({ ok: true }), cors)
    }

    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      return withCors(await handleOAuthToken(request, env), cors)
    }

    if (url.pathname === '/oauth/revoke' && request.method === 'POST') {
      return withCors(await handleOAuthRevoke(request, env), cors)
    }

    if (url.pathname === '/ical' && request.method === 'GET') {
      return withCors(await handleIcalFetch(request, env), cors)
    }

    return withCors(new Response('Not found', { status: 404 }), cors)
  },
}

export type { Env }
