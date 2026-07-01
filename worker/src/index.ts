import { handleOAuthToken, type Env } from './oauthToken'
import { corsHeadersFor } from './cors'

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of new Headers(corsHeadersFor(origin))) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/health') {
      return withCors(Response.json({ ok: true }), origin)
    }

    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      return withCors(await handleOAuthToken(request, env), origin)
    }

    return withCors(new Response('Not found', { status: 404 }), origin)
  },
}

export type { Env }
