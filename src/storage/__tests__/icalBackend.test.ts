import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IcalBackend, previewIcalFeed, IcalFetchError } from '@/storage/icalBackend'

const FEED = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Family',
  'BEGIN:VEVENT', 'UID:a@example', 'DTSTART:20260817T090000', 'SUMMARY:Standup', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@example', 'DTSTART:20260818T090000', 'SUMMARY:Review', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const FEED_URL = 'https://calendar.example/secret.ics'

/** Calls the stub recorded, so a test can assert what actually hit the network. */
let calls: Array<{ url: string; headers: Record<string, string> }> = []

function stubFetch(responder: (call: { url: string; headers: Record<string, string> }) => Response): void {
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const call = { url: input.toString(), headers }
    calls.push(call)
    return Promise.resolve(responder(call))
  })
}

const okFeed = (body = FEED, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers })

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('IcalBackend', () => {
  it('declares itself read-only but remote-backed', () => {
    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)
    expect(backend.readOnly).toBe(true)
    // The distinction the whole read-only-pull path rests on: no pushes, but
    // there IS something to poll.
    expect(backend.hasRemote).toBe(true)
    expect(backend.kind).toBe('ical')
  })

  it('fetches through the Worker proxy with the feed URL encoded', async () => {
    stubFetch(() => okFeed())
    await new IcalBackend('family-cal', 'Family', FEED_URL).statAll()

    expect(calls[0]?.url).toContain('/ical?url=')
    expect(calls[0]?.url).toContain(encodeURIComponent(FEED_URL))
  })

  it('lists one path per event, versioned by content hash', async () => {
    stubFetch(() => okFeed())
    const tokens = await new IcalBackend('family-cal', 'Family', FEED_URL).statAll()

    expect([...tokens.keys()].every(p => /^ical-[0-9a-f]{8}\.md$/.test(p))).toBe(true)
    expect(tokens.size).toBe(2)
    expect([...tokens.values()].every(v => /^[0-9a-f]{8}$/.test(v))).toBe(true)
  })

  it('reads within one cycle without going back to the network', async () => {
    stubFetch(() => okFeed())
    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)

    const tokens = await backend.statAll()
    const files  = await backend.readFiles([...tokens.keys()])

    // statAll starts the cycle; readFiles must see exactly what it listed, so
    // the versions still match the content.
    expect(calls).toHaveLength(1)
    expect(files).toHaveLength(2)
    for (const f of files) expect(tokens.get(f.path)).toBe(f.version)
  })

  it('re-checks the server on the next statAll', async () => {
    stubFetch(() => okFeed())
    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)

    await backend.statAll()
    await backend.statAll()

    expect(calls).toHaveLength(2)
  })

  it('sends If-None-Match and keeps its entries on a 304', async () => {
    stubFetch(call =>
      call.headers['if-none-match']
        ? new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } })
        : okFeed(FEED, { ETag: 'W/"v1"' }))

    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)
    const first = await backend.statAll()
    const second = await backend.statAll()

    expect(calls[1]?.headers['if-none-match']).toBe('W/"v1"')
    // An unchanged feed produces byte-identical entries, so reconcile sees no
    // change at all — the point of the whole conditional-request path.
    expect(second).toEqual(first)
  })

  it('picks up a changed feed', async () => {
    let body = FEED
    stubFetch(() => okFeed(body))
    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)

    const before = await backend.statAll()
    body = FEED.replace('SUMMARY:Standup', 'SUMMARY:Standup (moved)')
    const after = await backend.statAll()

    expect(after).not.toEqual(before)
    expect(after.size).toBe(before.size) // same events, one changed version
  })

  it('reads only the paths asked for', async () => {
    stubFetch(() => okFeed())
    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)
    const [first] = [...(await backend.statAll()).keys()]

    expect(await backend.readFiles([first!])).toHaveLength(1)
    expect(await backend.readAll()).toHaveLength(2)
  })

  it('surfaces the Worker error description', async () => {
    stubFetch(() => Response.json(
      { error: 'invalid_request', error_description: 'Calendar URL must point at a public host' },
      { status: 400 },
    ))
    await expect(new IcalBackend('x', 'X', FEED_URL).statAll())
      .rejects.toThrow('Calendar URL must point at a public host')
  })

  it('rejects a response that is not a calendar', async () => {
    stubFetch(() => okFeed('<html>Sign in</html>'))
    await expect(new IcalBackend('x', 'X', FEED_URL).statAll()).rejects.toThrow(/did not return a calendar/)
  })

  it('refuses writes and deletes rather than silently no-opping', async () => {
    stubFetch(() => okFeed())
    const backend = new IcalBackend('family-cal', 'Family', FEED_URL)

    await expect(backend.write()).rejects.toThrow(/cannot be edited/)
    await expect(backend.delete()).rejects.toThrow(/cannot be edited/)
  })

  it('reports an unreachable feed as unreachable, never denied', async () => {
    stubFetch(() => { throw new Error('network down') })
    // 'unreachable' is what keeps the vault mounted and its cached events on
    // screen while offline; 'denied' would unmount it.
    expect(await new IcalBackend('x', 'X', FEED_URL).ensurePermission(false)).toBe('unreachable')
  })

  it('reports a readable feed as granted', async () => {
    stubFetch(() => okFeed())
    expect(await new IcalBackend('x', 'X', FEED_URL).ensurePermission(true)).toBe('granted')
  })
})

describe('previewIcalFeed', () => {
  it('reports the calendar name and event count without registering anything', async () => {
    stubFetch(() => okFeed())
    expect(await previewIcalFeed(FEED_URL)).toEqual({ name: 'Family', eventCount: 2 })
  })

  it('omits the name when the feed sets none', async () => {
    stubFetch(() => okFeed(FEED.replace('X-WR-CALNAME:Family\r\n', '')))
    expect(await previewIcalFeed(FEED_URL)).toEqual({ eventCount: 2 })
  })

  it('explains a URL that returns a web page instead of a feed', async () => {
    stubFetch(() => okFeed('<html>Sign in</html>'))
    await expect(previewIcalFeed(FEED_URL)).rejects.toBeInstanceOf(IcalFetchError)
    await expect(previewIcalFeed(FEED_URL)).rejects.toThrow(/iCal\/ICS address/)
  })

  it('passes the Worker rejection straight through', async () => {
    stubFetch(() => Response.json(
      { error: 'invalid_request', error_description: 'Calendar URL must start with https:// or webcal://' },
      { status: 400 },
    ))
    await expect(previewIcalFeed('http://cal.example/f.ics')).rejects.toThrow(/must start with https/)
  })

  it('falls back to a status message when the Worker sends no JSON body', async () => {
    stubFetch(() => new Response('gateway timeout', { status: 504 }))
    await expect(previewIcalFeed(FEED_URL)).rejects.toThrow('Calendar server returned 504')
  })
})
