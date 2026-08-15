import { describe, it, expect } from 'vitest'
import { handleIcalFetch, validateFeedUrl, type CalendarFetcher } from './icalFetch'

const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.example/ical?url=${encodeURIComponent(url)}`, { headers })
}

/** A fetcher that records what it was asked for and replays canned responses. */
function stubFetcher(responses: Response[]): CalendarFetcher & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected fetch of ${url}`)
    return Promise.resolve(next)
  }
  return Object.assign(fn, { calls })
}

const ok = (body = FEED, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers })

describe('validateFeedUrl', () => {
  it('accepts an https feed', () => {
    expect(validateFeedUrl('https://calendar.google.com/calendar/ical/x/basic.ics'))
      .toEqual({ url: 'https://calendar.google.com/calendar/ical/x/basic.ics' })
  })

  it('rewrites webcal: to https:', () => {
    expect(validateFeedUrl('webcal://p01.calendar.example/feed.ics'))
      .toEqual({ url: 'https://p01.calendar.example/feed.ics' })
  })

  it('rejects http and other schemes', () => {
    for (const url of ['http://cal.example/f.ics', 'file:///etc/passwd', 'ftp://cal.example/f.ics']) {
      expect(validateFeedUrl(url)).toHaveProperty('error')
    }
  })

  it('rejects a URL with embedded credentials', () => {
    expect(validateFeedUrl('https://user:pass@cal.example/f.ics')).toHaveProperty('error')
  })

  it('rejects a non-default port', () => {
    expect(validateFeedUrl('https://cal.example:8080/f.ics')).toHaveProperty('error')
    expect(validateFeedUrl('https://cal.example:443/f.ics')).toEqual({ url: 'https://cal.example/f.ics' })
  })

  it('rejects garbage', () => {
    expect(validateFeedUrl('not a url')).toHaveProperty('error')
  })

  // ── SSRF ──────────────────────────────────────────────────────────────────

  it('rejects loopback, private, link-local and CGNAT IPv4', () => {
    const blocked = [
      'https://127.0.0.1/f.ics',
      'https://127.1.2.3/f.ics',
      'https://10.0.0.5/f.ics',
      'https://172.16.0.1/f.ics',
      'https://172.31.255.254/f.ics',
      'https://192.168.1.1/f.ics',
      'https://169.254.169.254/latest/meta-data', // cloud instance metadata
      'https://100.64.0.1/f.ics',
      'https://0.0.0.0/f.ics',
      'https://255.255.255.255/f.ics',
      'https://224.0.0.1/f.ics',
    ]
    for (const url of blocked) expect(validateFeedUrl(url), url).toHaveProperty('error')
  })

  it('rejects legacy IPv4 spellings of loopback', () => {
    // `new URL` normalizes all of these to 127.0.0.1 before we ever see them.
    for (const url of ['https://2130706433/f.ics', 'https://0x7f000001/f.ics', 'https://017700000001/f.ics', 'https://127.1/f.ics']) {
      expect(validateFeedUrl(url), url).toHaveProperty('error')
    }
  })

  it('rejects loopback, ULA, link-local and IPv4-mapped IPv6', () => {
    const blocked = [
      'https://[::1]/f.ics',
      'https://[::]/f.ics',
      'https://[fc00::1]/f.ics',
      'https://[fd12:3456::1]/f.ics',
      'https://[fe80::1]/f.ics',
      'https://[ff02::1]/f.ics',
      'https://[::ffff:127.0.0.1]/f.ics',
      'https://[::ffff:10.0.0.1]/f.ics',
      'https://[::ffff:169.254.169.254]/f.ics',
    ]
    for (const url of blocked) expect(validateFeedUrl(url), url).toHaveProperty('error')
  })

  it('allows a public IPv6 literal', () => {
    expect(validateFeedUrl('https://[2606:4700:4700::1111]/f.ics')).not.toHaveProperty('error')
  })

  it('allows a public IPv4 literal', () => {
    expect(validateFeedUrl('https://93.184.216.34/f.ics')).not.toHaveProperty('error')
  })

  it('rejects single-label and internal-suffix hostnames', () => {
    for (const url of ['https://localhost/f.ics', 'https://metadata/f.ics', 'https://nas.local/f.ics', 'https://api.internal/f.ics', 'https://x.home.arpa/f.ics']) {
      expect(validateFeedUrl(url), url).toHaveProperty('error')
    }
  })
})

describe('handleIcalFetch', () => {
  it('400s without a url parameter', async () => {
    const res = await handleIcalFetch(new Request('https://worker.example/ical'), stubFetcher([]))
    expect(res.status).toBe(400)
  })

  it('returns the feed as text/calendar', async () => {
    const fetcher = stubFetcher([ok()])
    const res = await handleIcalFetch(req('https://cal.example/f.ics'), fetcher)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(await res.text()).toBe(FEED)
    expect(fetcher.calls[0]?.url).toBe('https://cal.example/f.ics')
  })

  it('fetches the https rewrite of a webcal url', async () => {
    const fetcher = stubFetcher([ok()])
    await handleIcalFetch(req('webcal://cal.example/f.ics'), fetcher)
    expect(fetcher.calls[0]?.url).toBe('https://cal.example/f.ics')
  })

  it('never fetches a blocked host', async () => {
    const fetcher = stubFetcher([ok()])
    const res = await handleIcalFetch(req('https://169.254.169.254/latest/meta-data'), fetcher)

    expect(res.status).toBe(400)
    expect(fetcher.calls).toHaveLength(0)
  })

  it('passes If-None-Match through and returns 304 with the ETag', async () => {
    const fetcher = stubFetcher([new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } })])
    const res = await handleIcalFetch(req('https://cal.example/f.ics', { 'If-None-Match': 'W/"v1"' }), fetcher)

    expect((fetcher.calls[0]?.init.headers as Record<string, string>)['If-None-Match']).toBe('W/"v1"')
    expect(res.status).toBe(304)
    expect(res.headers.get('ETag')).toBe('W/"v1"')
  })

  it('returns the upstream ETag on a 200', async () => {
    const res = await handleIcalFetch(req('https://cal.example/f.ics'), stubFetcher([ok(FEED, { ETag: '"abc"' })]))
    expect(res.headers.get('ETag')).toBe('"abc"')
  })

  it('follows a redirect to another public host', async () => {
    const fetcher = stubFetcher([
      new Response(null, { status: 302, headers: { Location: 'https://cdn.example/f.ics' } }),
      ok(),
    ])
    const res = await handleIcalFetch(req('https://cal.example/f.ics'), fetcher)

    expect(res.status).toBe(200)
    expect(fetcher.calls.map(c => c.url)).toEqual(['https://cal.example/f.ics', 'https://cdn.example/f.ics'])
  })

  it('refuses a redirect into private space', async () => {
    const fetcher = stubFetcher([
      new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data' } }),
      ok(),
    ])
    const res = await handleIcalFetch(req('https://cal.example/f.ics'), fetcher)

    expect(res.status).toBe(400)
    expect(fetcher.calls).toHaveLength(1) // the second hop never happened
  })

  it('gives up on a redirect loop', async () => {
    const hop = () => new Response(null, { status: 302, headers: { Location: 'https://cal.example/f.ics' } })
    const res = await handleIcalFetch(
      req('https://cal.example/f.ics'),
      stubFetcher([hop(), hop(), hop(), hop(), hop(), hop(), hop()]),
    )
    expect(res.status).toBe(502)
  })

  it('rejects a feed whose Content-Length exceeds the cap', async () => {
    const res = await handleIcalFetch(
      req('https://cal.example/f.ics'),
      stubFetcher([ok(FEED, { 'Content-Length': String(6 * 1024 * 1024) })]),
    )
    expect(res.status).toBe(413)
  })

  it('rejects a feed that streams past the cap without declaring its size', async () => {
    const chunk = new Uint8Array(1024 * 1024) // 1 MB
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 8) { controller.close(); return }
        controller.enqueue(chunk)
      },
    })
    const res = await handleIcalFetch(
      req('https://cal.example/f.ics'),
      stubFetcher([new Response(body, { status: 200 })]),
    )
    expect(res.status).toBe(413)
  })

  it('502s when the calendar server errors', async () => {
    const res = await handleIcalFetch(req('https://cal.example/f.ics'), stubFetcher([new Response('nope', { status: 403 })]))
    expect(res.status).toBe(502)
  })

  it('504s when the fetch times out', async () => {
    const timeout: CalendarFetcher = () => {
      const e = new Error('timed out')
      e.name = 'TimeoutError'
      return Promise.reject(e)
    }
    const res = await handleIcalFetch(req('https://cal.example/f.ics'), timeout)
    expect(res.status).toBe(504)
  })
})
