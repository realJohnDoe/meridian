// The one browser origin allowed to read cross-origin responses from this
// Worker. Requests from other origins still execute (this endpoint has no
// ambient session/cookie to protect — callers must already possess a real
// `code`/`code_verifier`/`refresh_token`), but the browser will refuse to let
// disallowed-origin JS read the response body without this header.
const ALLOWED_ORIGIN = 'https://realjohndoe.github.io'

export function corsHeadersFor(origin: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin === ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN
  }
  return headers
}
