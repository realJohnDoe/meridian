// ── iCal subscription proxy ──────────────────────────────────────────────────
// `GET /ical?url=<encoded>` fetches a calendar feed on the browser's behalf.
//
// The proxy exists because calendar providers (Google, Outlook, Fastmail, …)
// serve their "secret address" feeds without CORS headers, so the page cannot
// read them directly. That makes this endpoint an open fetcher pointed at a
// URL the caller chooses, which is the classic SSRF shape — hence the host
// validation below, applied to the original URL *and* to every redirect hop.
//
// The privacy trade-off is real and stated in the wizard's copy: the calendar
// URL and its contents pass through Meridian's Worker. Nothing is logged or
// stored here; the response is streamed back and the Worker forgets it.

/** Injectable so tests can stand in for the network — same pattern as `GitHubTokenExchanger`. */
export type CalendarFetcher = (url: string, init: RequestInit) => Promise<Response>

const defaultFetcher: CalendarFetcher = (url, init) => fetch(url, init)

/** Feeds are text; 5 MB is already a many-thousand-event calendar. */
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5

// ── Host validation (SSRF) ───────────────────────────────────────────────────

/**
 * Expand an IPv6 literal (without brackets) into its eight 16-bit groups, or
 * `null` if it isn't one.
 *
 * Written out rather than pattern-matched on the text because the compressed
 * (`::`) and IPv4-embedded (`::ffff:127.0.0.1`) forms make textual prefix
 * checks wrong in both directions: the WHATWG URL parser re-serializes
 * `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`, so a check for the dotted-quad
 * tail never fires on a URL that has been through `new URL()`.
 */
function ipv6Groups(host: string): number[] | null {
  if (host.includes('%')) return null // zone ids never reach us via `new URL`
  let text = host

  // A trailing dotted-quad — `::ffff:127.0.0.1`, `::127.0.0.1` — is rewritten
  // into the two hex groups it stands for, so the compression handling below
  // sees one uniform shape.
  const tail = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text)
  if (tail?.[1]) {
    const octets = tail[1].split('.').map(Number)
    if (octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)
    const lo = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)
    text = `${text.slice(0, tail.index)}:${hi}:${lo}`
  }

  const parseSide = (side: string): number[] | null => {
    if (side === '') return []
    const out: number[] = []
    for (const part of side.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
      out.push(parseInt(part, 16))
    }
    return out
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = parseSide(halves[0] ?? '')
  if (!head) return null
  if (halves.length === 1) return head.length === 8 ? head : null

  const rest = parseSide(halves[1] ?? '')
  if (!rest) return null
  if (head.length + rest.length > 8) return null
  return [...head, ...new Array<number>(8 - head.length - rest.length).fill(0), ...rest]
}

/**
 * Address ranges that must never be reachable through this proxy: loopback,
 * RFC1918 private space, carrier-grade NAT, link-local — which includes
 * 169.254.169.254, the cloud instance-metadata address — and multicast /
 * reserved space.
 */
function isBlockedIpv4(a: number, b: number): boolean {
  if (a === 0) return true                          // 0.0.0.0/8 "this network"
  if (a === 10) return true                         // RFC1918
  if (a === 127) return true                        // loopback
  if (a === 169 && b === 254) return true           // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true  // RFC1918
  if (a === 192 && b === 168) return true           // RFC1918
  if (a === 192 && b === 0) return true             // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  return a >= 224                                   // multicast, reserved, broadcast
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()

  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = ipv6Groups(host.slice(1, -1))
    if (!groups) return true // an IPv6 literal we cannot reason about
    const g0 = groups[0] ?? 0, g5 = groups[5] ?? 0, g6 = groups[6] ?? 0, g7 = groups[7] ?? 0
    if (groups.every(g => g === 0)) return true                         // ::
    if (groups.slice(0, 7).every(g => g === 0) && g7 === 1) return true // ::1
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) both carry a
    // v4 address in the last two groups — judge them by that address.
    const v4Embedded = groups.slice(0, 5).every(g => g === 0) && (g5 === 0xffff || g5 === 0)
    if (v4Embedded && isBlockedIpv4(g6 >> 8, g6 & 0xff)) return true
    if ((g0 & 0xfe00) === 0xfc00) return true  // fc00::/7 unique local
    if ((g0 & 0xffc0) === 0xfe80) return true  // fe80::/10 link-local
    if ((g0 & 0xff00) === 0xff00) return true  // ff00::/8 multicast
    return false
  }

  // `new URL()` normalizes every legacy IPv4 spelling — decimal (2130706433),
  // hex (0x7f000001), octal, short forms — into dotted-quad, so this one check
  // covers all of them.
  const parts = host.split('.')
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    return isBlockedIpv4(Number(parts[0]), Number(parts[1]))
  }

  // A hostname with no dot resolves through the resolver's own search domains,
  // which is exactly how `localhost` and intranet names like `wiki` or
  // `metadata` get reached. A published calendar feed always has a dotted
  // public hostname, so requiring one costs nothing and closes that door.
  if (!host.includes('.')) return true
  return /\.(local|localhost|internal|home\.arpa)$/.test(host)
}

/**
 * Validate and normalize a user-supplied feed URL.
 *
 * `webcal:` is the scheme calendar apps advertise; it is plain HTTPS with a
 * different name, so it is rewritten rather than rejected. Everything else —
 * `http:` included, since a feed carries a secret address that must not travel
 * in clear text — is refused.
 *
 * Returns the URL to fetch, or an error string naming what was wrong.
 *
 * Not closed by this check: DNS rebinding, where a public hostname resolves to
 * a private address. A Worker cannot resolve a name before fetching it, so the
 * literal-address checks above cannot see it. The remaining exposure is bounded
 * by the runtime — Workers' `fetch` egresses to the public internet and has no
 * private network behind it to pivot into.
 */
export function validateFeedUrl(raw: string): { url: string } | { error: string } {
  // Swapped textually, before parsing: `webcal:` is a non-special scheme, so
  // the URL parser neither applies host normalization to it (the legacy IPv4
  // spellings would sail straight past the checks below) nor permits the
  // `protocol` setter to promote it to a special one.
  const text = /^webcal:\/\//i.test(raw) ? `https://${raw.slice('webcal://'.length)}` : raw

  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return { error: 'Not a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { error: 'Calendar URL must start with https:// or webcal://' }
  }
  if (parsed.username || parsed.password) {
    return { error: 'Calendar URL must not contain credentials' }
  }
  // Only the default port. Feeds are published on 443; allowing arbitrary ports
  // would turn this into an internal port scanner for any host that passes the
  // address checks.
  if (parsed.port !== '' && parsed.port !== '443') {
    return { error: 'Calendar URL must use the default HTTPS port' }
  }
  if (isBlockedHost(parsed.hostname)) {
    return { error: 'Calendar URL must point at a public host' }
  }
  return { url: parsed.toString() }
}

// ── Fetching ─────────────────────────────────────────────────────────────────

function errorResponse(status: number, description: string): Response {
  return Response.json({ error: 'invalid_request', error_description: description }, { status })
}

/**
 * Read the body with a hard byte cap, cancelling the stream the moment it is
 * exceeded. A declared `Content-Length` short-circuits it, but the streaming
 * count is what actually enforces the limit — the header is advisory and a
 * hostile server simply omits it.
 */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null

  // Typed explicitly: the Workers runtime types stream chunks as `any`, which
  // would leave the byte accounting below — the actual size enforcement —
  // unchecked.
  const body = response.body as ReadableStream<Uint8Array> | null
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(joined)
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * `GET /ical?url=<encoded>` — fetch a calendar feed and return it as
 * `text/calendar`.
 *
 * Redirects are followed by hand (`redirect: 'manual'`) rather than by the
 * runtime, because each hop is a fresh caller-influenced URL and has to clear
 * the same host checks as the first one. A feed provider that redirects to an
 * internal address is the whole point of validating hop N+1.
 *
 * `If-None-Match` is passed through and `ETag` returned, so a refresh of an
 * unchanged feed costs a 304 and no body — the mechanism `IcalBackend` uses to
 * make its 15-minute poll nearly free.
 */
export async function handleIcalFetch(
  request: Request,
  fetcher: CalendarFetcher = defaultFetcher,
): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('url')
  if (!raw) return errorResponse(400, 'Missing url parameter')

  const validated = validateFeedUrl(raw)
  if ('error' in validated) return errorResponse(400, validated.error)

  const headers: Record<string, string> = {
    Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
    'User-Agent': 'Meridian-Calendar-Proxy',
  }
  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch

  let target = validated.url
  let response: Response
  try {
    for (let hop = 0; ; hop++) {
      response = await fetcher(target, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const location = response.headers.get('Location')
      if (!REDIRECT_STATUSES.has(response.status) || !location) break
      if (hop >= MAX_REDIRECTS) return errorResponse(502, 'Calendar URL redirected too many times')
      const next = validateFeedUrl(new URL(location, target).toString())
      if ('error' in next) return errorResponse(400, `Calendar URL redirected somewhere it may not: ${next.error}`)
      target = next.url
    }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return errorResponse(504, timedOut ? 'Calendar server took too long to respond' : 'Could not reach the calendar server')
  }

  const etag = response.headers.get('ETag')
  const passthrough = new Headers({ 'Cache-Control': 'no-store' })
  if (etag) passthrough.set('ETag', etag)

  // Unchanged since the caller's ETag — no body to read or cap.
  if (response.status === 304) return new Response(null, { status: 304, headers: passthrough })

  if (!response.ok) {
    return errorResponse(502, `Calendar server returned ${response.status}`)
  }

  const text = await readCapped(response)
  if (text === null) return errorResponse(413, 'Calendar is too large (over 5 MB)')

  passthrough.set('Content-Type', 'text/calendar; charset=utf-8')
  return new Response(text, { status: 200, headers: passthrough })
}
