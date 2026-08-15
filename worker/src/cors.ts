// The one browser origin allowed to read cross-origin responses from this
// Worker. Requests from other origins still execute (this endpoint has no
// ambient session/cookie to protect — callers must already possess a real
// `code`/`code_verifier`/`refresh_token`), but the browser will refuse to let
// disallowed-origin JS read the response body without this header.
const ALLOWED_ORIGIN = 'https://realjohndoe.github.io'

export function corsHeadersFor(origin: string | null): HeadersInit {
  const headers: HeadersInit = {
    // GET for /ical, POST for /oauth/token. `If-None-Match` is what makes the
    // calendar proxy's conditional refresh work, and `ETag` has to be exposed
    // explicitly — it is not one of the CORS-safelisted response headers, so
    // without this the browser hands the page a response whose ETag it cannot
    // read, and every refresh would re-download the whole feed.
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    Vary: 'Origin',
  }
  if (origin === ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN
  }
  return headers
}
