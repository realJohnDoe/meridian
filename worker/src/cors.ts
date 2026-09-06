// The one browser origin allowed to read cross-origin responses from this
// Worker.
//
// For `/oauth/token`, a request from another origin still *executes* — that
// endpoint has no ambient session or cookie to protect, since a caller must
// already possess a real `code`/`code_verifier`/`refresh_token` — and it is
// only the browser that refuses to let disallowed-origin JS read the response
// body without this header.
//
// That reasoning does not carry to `/ical`, which requires no secret at all, so
// `handleIcalFetch` enforces this origin itself before doing any work rather
// than fetching a feed no browser elsewhere could have read anyway. See the
// header comment in `icalFetch.ts`.
export const ALLOWED_ORIGIN = 'https://realjohndoe.github.io'

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
