import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { icsToEntries, type SynthesizedEntry } from './icsToEntries'
import { parseToStoreItems, roundTripLoss } from '@/model'
import { isSeries } from '@/types'

const NOW = new Date(2026, 7, 15) // 2026-08-15

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8')
}

/** The parsed YAML frontmatter of a synthesized entry. */
function frontmatter(entry: SynthesizedEntry): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(entry.content)
  if (!m?.[1]) throw new Error(`no frontmatter in:\n${entry.content}`)
  return parse(m[1]) as Record<string, unknown>
}

function bodyOf(entry: SynthesizedEntry): string {
  return entry.content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

/** The local `HH:mm` a known UTC instant renders as — independent of the runner's zone. */
function localTimeOf(utcMs: number): string {
  const d = new Date(utcMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`
const event = (lines: string[]) => wrap(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'))

/** The single entry a one-event feed produces. */
function only(ics: string): SynthesizedEntry {
  const result = icsToEntries(ics, NOW)
  if (!result) throw new Error('not a calendar')
  const [entry] = result.entries
  if (!entry) throw new Error(`no entries produced from:\n${ics}`)
  return entry
}

describe('icsToEntries — basics', () => {
  it('returns null when the text is not a calendar', () => {
    expect(icsToEntries('<html>Please sign in</html>', NOW)).toBeNull()
  })

  it('reads the calendar name', () => {
    expect(icsToEntries(wrap('X-WR-CALNAME:Family'), NOW)?.calendarName).toBe('Family')
    expect(icsToEntries(wrap('VERSION:2.0'), NOW)?.calendarName).toBeUndefined()
  })

  it('maps SUMMARY, DESCRIPTION, LOCATION and URL', () => {
    const entry = only(event([
      'UID:a@example', 'DTSTART:20260817T090000', 'DTEND:20260817T100000',
      'SUMMARY:Lunch\\, then talk', 'DESCRIPTION:First line\\nSecond line',
      'LOCATION:Cafe\\; corner table', 'URL:https://example.com/e',
    ]))
    const fm = frontmatter(entry)

    expect(fm['title']).toBe('Lunch, then talk')
    expect(fm['location']).toBe('Cafe; corner table')
    expect(fm['url']).toBe('https://example.com/e')
    expect(fm['uid']).toBe('a@example')
    expect(bodyOf(entry)).toBe('First line\nSecond line')
  })

  it('falls back to a placeholder title', () => {
    expect(frontmatter(only(event(['UID:a@example', 'DTSTART:20260817T090000'])))['title']).toBe('Untitled event')
  })

  it('skips a cancelled event', () => {
    const result = icsToEntries(event([
      'UID:a@example', 'DTSTART:20260817T090000', 'SUMMARY:Gone', 'STATUS:CANCELLED',
    ]), NOW)!
    expect(result.entries).toEqual([])
  })

  it('skips an event with no usable DTSTART', () => {
    expect(icsToEntries(event(['UID:a@example', 'SUMMARY:No date']), NOW)!.entries).toEqual([])
  })

  it('collects attendees as an extra field, with and without CN', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260817T090000',
      'ATTENDEE;CN=Alice Adams:mailto:alice@example.com',
      'ATTENDEE:mailto:bob@example.com',
      'ATTENDEE;CN=Alice Adams:mailto:alice@example.com',
    ])))
    expect(fm['attendees']).toEqual(['Alice Adams', 'bob@example.com'])
    expect(fm).not.toHaveProperty('participants')
  })

  it('omits attendees entirely when there are none, and never writes participants', () => {
    const fm = frontmatter(only(event(['UID:a@example', 'DTSTART:20260817T090000'])))
    expect(fm).not.toHaveProperty('attendees')
    expect(fm).not.toHaveProperty('participants')
  })
})

describe('icsToEntries — dates and durations', () => {
  it('writes an all-day event as a bare date with no time', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART;VALUE=DATE:20260901', 'DTEND;VALUE=DATE:20260904', 'SUMMARY:Trip',
    ])))
    expect(fm['date']).toBe('2026-09-01')
    expect(fm).not.toHaveProperty('time')
    expect(fm['duration']).toBe('3d') // DTEND is exclusive
  })

  it('converts a TZID wall clock to the viewer local wall clock', () => {
    const fm = frontmatter(only(event([
      'UID:a@example',
      'DTSTART;TZID=Europe/Berlin:20260817T090000',
      'DTEND;TZID=Europe/Berlin:20260817T093000',
      'SUMMARY:Standup',
    ])))
    // 09:00 Berlin in August is 07:00 UTC.
    expect(fm['time']).toBe(localTimeOf(Date.UTC(2026, 7, 17, 7, 0)))
    expect(fm['duration']).toBe('30m')
    expect(fm['sourceTimezone']).toBe('Europe/Berlin')
  })

  it('leaves a floating time alone and records no source zone', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260825T100000', 'DURATION:PT90M', 'SUMMARY:Workshop',
    ])))
    expect(fm['time']).toBe('10:00')
    expect(fm['duration']).toBe('90m')
    expect(fm).not.toHaveProperty('sourceTimezone')
  })

  it('honours DURATION when there is no DTEND', () => {
    expect(frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260825T100000', 'DURATION:PT2H', 'SUMMARY:X',
    ])))['duration']).toBe('2h')
  })
})

describe('icsToEntries — recurrence', () => {
  it('maps a representable RRULE to a repeat block', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260817T090000', 'SUMMARY:Standup',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
    ])))
    expect(fm['repeat']).toEqual({ type: 'schedule', freq: 'weekly', byweekday: ['mo', 'we', 'fr'] })
  })

  it('turns EXDATE into excluded instances', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260817T090000', 'SUMMARY:Standup',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'EXDATE:20260819T090000,20260821T090000',
    ])))
    expect(fm['instances']).toEqual([
      { date: '2026-08-19', excluded: true },
      { date: '2026-08-21', excluded: true },
    ])
  })

  it('emits explicit dates for an unrepresentable RRULE, with no repeat block', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260807T090000', 'SUMMARY:First and third Friday',
      'RRULE:FREQ=MONTHLY;BYDAY=1FR,3FR',
    ])))
    expect(fm).not.toHaveProperty('repeat')
    expect(fm['date']).toBe('2026-08-07')
    const instances = fm['instances'] as Array<{ date: string; time?: string }>
    expect(instances[0]).toEqual({ date: '2026-08-21', time: '09:00' })
    expect(instances.length).toBeGreaterThan(10)
  })

  it('stays a single occurrence when the RRULE is unusable', () => {
    const fm = frontmatter(only(event([
      'UID:a@example', 'DTSTART:20260817T090000', 'SUMMARY:X', 'RRULE:FREQ=FORTNIGHTLY',
    ])))
    expect(fm).not.toHaveProperty('repeat')
    expect(fm).not.toHaveProperty('instances')
  })
})

describe('icsToEntries — RECURRENCE-ID overrides', () => {
  const master = [
    'BEGIN:VEVENT', 'UID:a@example', 'DTSTART:20260803T090000', 'DTEND:20260803T093000',
    'SUMMARY:Weekly', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'END:VEVENT',
  ]

  it('folds an in-place override into the master entry', () => {
    const result = icsToEntries(wrap([...master,
      'BEGIN:VEVENT', 'UID:a@example', 'RECURRENCE-ID:20260810T090000',
      'DTSTART:20260810T110000', 'DTEND:20260810T113000', 'SUMMARY:Weekly', 'END:VEVENT',
    ].join('\r\n')), NOW)!

    expect(result.entries).toHaveLength(1) // one entry, not two
    expect(frontmatter(result.entries[0]!)['instances']).toEqual([{ date: '2026-08-10', time: '11:00', duration: '30m' }])
  })

  it('excludes the original day and adds the new one when an occurrence moves', () => {
    const result = icsToEntries(wrap([...master,
      'BEGIN:VEVENT', 'UID:a@example', 'RECURRENCE-ID:20260810T090000',
      'DTSTART:20260812T140000', 'DTEND:20260812T150000', 'SUMMARY:Weekly', 'END:VEVENT',
    ].join('\r\n')), NOW)!

    expect(frontmatter(result.entries[0]!)['instances']).toEqual([
      { date: '2026-08-10', excluded: true },
      { date: '2026-08-12', time: '14:00', duration: '1h' },
    ])
  })

  it('folds in an override that appears before its master', () => {
    const result = icsToEntries(wrap([
      'BEGIN:VEVENT', 'UID:a@example', 'RECURRENCE-ID:20260810T090000',
      'DTSTART:20260810T110000', 'SUMMARY:Weekly', 'END:VEVENT',
      ...master,
    ].join('\r\n')), NOW)!

    expect(result.entries).toHaveLength(1)
    expect(frontmatter(result.entries[0]!)['instances']).toEqual([{ date: '2026-08-10', time: '11:00' }])
  })
})

describe('icsToEntries — slugs', () => {
  const feed = event(['UID:standup-abc123@google.com', 'DTSTART:20260817T090000', 'SUMMARY:Standup'])

  it('derives a flat, URL-safe slug from the UID', () => {
    expect(only(feed).slug).toMatch(/^ical-[0-9a-f]{8}$/)
  })

  it('re-parsing an unchanged feed yields byte-identical slugs and content', () => {
    // The deterministic-id guarantee: a refresh that changed nothing must
    // produce the same bytes, so reconcile sees no change at all.
    expect(icsToEntries(feed, NOW)).toEqual(icsToEntries(feed, NOW))
  })

  it('gives different UIDs different slugs', () => {
    const other = event(['UID:other@google.com', 'DTSTART:20260817T090000', 'SUMMARY:Standup'])
    expect(only(feed).slug).not.toBe(only(other).slug)
  })

  it('disambiguates a repeated UID deterministically', () => {
    const twice = wrap([
      'BEGIN:VEVENT', 'UID:dup@example', 'DTSTART:20260817T090000', 'SUMMARY:One', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:dup@example', 'DTSTART:20260818T090000', 'SUMMARY:Two', 'END:VEVENT',
    ].join('\r\n'))
    // Same UID with no RECURRENCE-ID is one entry — the second is a duplicate,
    // not a second event, and the first one listed wins.
    expect(icsToEntries(twice, NOW)!.entries).toHaveLength(1)
  })

  it('stays deterministic for an event with no UID', () => {
    const noUid = event(['DTSTART:20260817T090000', 'SUMMARY:Anonymous'])
    expect(only(noUid).slug).toBe(only(noUid).slug)
    expect(only(noUid).slug).toMatch(/^ical-[0-9a-f]{8}$/)
  })

  it('sorts instances so a reordered feed still produces identical bytes', () => {
    const withOrder = (a: string, b: string) => only(event([
      'UID:a@example', 'DTSTART:20260803T090000', 'SUMMARY:Weekly',
      'RRULE:FREQ=WEEKLY;BYDAY=MO', `EXDATE:${a}`, `EXDATE:${b}`,
    ])).content
    expect(withOrder('20260810T090000', '20260817T090000'))
      .toBe(withOrder('20260817T090000', '20260810T090000'))
  })
})

// ── Golden: real exports through the real parse path ────────────────────────

describe('golden fixtures', () => {
  it('parses a Google export into the store with no round-trip loss', () => {
    const result = icsToEntries(fixture('google.ics'), NOW)!
    expect(result.calendarName).toBe('Family')
    expect(result.entries).toHaveLength(2) // the cancelled event is skipped

    for (const entry of result.entries) {
      const path = `${entry.slug}.md`
      const parsed = parseToStoreItems(path, entry.content, 'family-cal')
      expect(parsed.items.length).toBeGreaterThan(0)
      // The synthesized markdown must survive Meridian's own save path
      // untouched — this is what "no parallel parse path" actually buys.
      expect(roundTripLoss(path, entry.content, parsed)).toEqual([])
    }
  })

  it('maps the Google standup to a series with its exclusion', () => {
    const [standup] = icsToEntries(fixture('google.ics'), NOW)!.entries
    const fm = frontmatter(standup!)

    expect(fm['title']).toBe('Team standup: morning')
    expect(fm['attendees']).toEqual(['Alice Adams', 'bob@example.com'])
    expect(fm).not.toHaveProperty('participants')
    expect(fm['organizer']).toBe('Alice Adams')
    expect(fm['location']).toBe('Meeting room 2, second floor')
    expect(fm['repeat']).toEqual({ type: 'schedule', freq: 'weekly', byweekday: ['mo', 'we', 'fr'] })
    expect(fm['instances']).toEqual([{ date: '2026-08-19', excluded: true }])
    expect(bodyOf(standup!)).toBe('Daily sync.\n\nBring your notes, and be brief.')

    const parsed = parseToStoreItems('x.md', standup!.content, 'family-cal')
    expect(parsed.items.some(isSeries)).toBe(true)
  })

  it('parses an Outlook export into the store with no round-trip loss', () => {
    const result = icsToEntries(fixture('outlook.ics'), NOW)!
    expect(result.calendarName).toBe('Work calendar')
    // The RECURRENCE-ID override folds into its master, so three VEVENTs
    // become two entries.
    expect(result.entries).toHaveLength(2)

    for (const entry of result.entries) {
      const path = `${entry.slug}.md`
      const parsed = parseToStoreItems(path, entry.content, 'work-cal')
      expect(roundTripLoss(path, entry.content, parsed)).toEqual([])
    }
  })

  it('degrades an unrecognised Windows timezone to floating local time', () => {
    const [review] = icsToEntries(fixture('outlook.ics'), NOW)!.entries
    const fm = frontmatter(review!)

    // `W. Europe Standard Time` is not an IANA id, so the wall clock is kept
    // as written rather than the event being dropped.
    expect(fm['time']).toBe('13:00')
    expect(fm['sourceTimezone']).toBe('W. Europe Standard Time')
    expect(fm['title']).toBe('Monthly review — planning, budget; and headcount')
    expect(fm['repeat']).toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: 2 })
    expect(fm['instances']).toEqual([
      { date: '2026-09-11', excluded: true },
      { date: '2026-09-12', time: '10:00', duration: '90m' },
    ])
  })
})
