import { describe, it, expect } from 'vitest'
import { rruleToRepeat, parseRRule } from './rruleToRepeat'
import type { Repeat } from '@/types'

/** Anchors and "now" are fixed so the bounded window is deterministic. */
const NOW = new Date(2026, 7, 15) // 2026-08-15, a Saturday

/** The mapped `Repeat`, or a failure naming what came back instead. */
function repeatOf(rrule: string, anchor: Date): Repeat {
  const mapped = rruleToRepeat(rrule, anchor, NOW)
  if (mapped.kind !== 'repeat') throw new Error(`expected a repeat, got dates: ${mapped.dates.join(', ')}`)
  return mapped.repeat
}

function datesOf(rrule: string, anchor: Date): string[] {
  const mapped = rruleToRepeat(rrule, anchor, NOW)
  if (mapped.kind !== 'dates') throw new Error(`expected dates, got a repeat: ${JSON.stringify(mapped.repeat)}`)
  return mapped.dates
}

describe('parseRRule', () => {
  it('splits parts and upper-cases keys', () => {
    expect(parseRRule('freq=WEEKLY;interval=2;BYDAY=MO,WE'))
      .toEqual({ FREQ: 'WEEKLY', INTERVAL: '2', BYDAY: 'MO,WE' })
  })

  it('ignores chunks with no equals sign', () => {
    expect(parseRRule('FREQ=DAILY;;GARBAGE')).toEqual({ FREQ: 'DAILY' })
  })
})

describe('rruleToRepeat — representable rules', () => {
  const monday = new Date(2026, 7, 10) // 2026-08-10

  it('maps a plain daily rule', () => {
    expect(repeatOf('FREQ=DAILY', monday)).toEqual({ type: 'schedule', freq: 'daily' })
  })

  it('carries INTERVAL, and omits it when 1', () => {
    expect(repeatOf('FREQ=DAILY;INTERVAL=3', monday)).toEqual({ type: 'schedule', freq: 'daily', interval: 3 })
    expect(repeatOf('FREQ=DAILY;INTERVAL=1', monday)).toEqual({ type: 'schedule', freq: 'daily' })
  })

  it('maps weekly with BYDAY', () => {
    expect(repeatOf('FREQ=WEEKLY;BYDAY=MO,WE,FR', monday))
      .toEqual({ type: 'schedule', freq: 'weekly', byweekday: ['mo', 'we', 'fr'] })
  })

  it('maps monthly by day-of-month', () => {
    expect(repeatOf('FREQ=MONTHLY;BYMONTHDAY=15', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', bymonthday: [15] })
  })

  it('maps monthly with no BY part at all', () => {
    expect(repeatOf('FREQ=MONTHLY', monday)).toEqual({ type: 'schedule', freq: 'monthly' })
  })

  it('maps an ordinal BYDAY to byweekday + bysetpos', () => {
    expect(repeatOf('FREQ=MONTHLY;BYDAY=2FR', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: 2 })
    expect(repeatOf('FREQ=MONTHLY;BYDAY=-1SU', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['su'], bysetpos: -1 })
  })

  it('maps "last weekday of the month" (BYDAY set + BYSETPOS)', () => {
    expect(repeatOf('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['mo', 'tu', 'we', 'th', 'fr'], bysetpos: -1 })
  })

  it('maps a BYSETPOS beyond -1 — the engine resolves it correctly', () => {
    expect(repeatOf('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['mo', 'tu', 'we', 'th', 'fr'], bysetpos: -2 })
  })

  it('maps a negative BYMONTHDAY, which both engines count back from month end', () => {
    expect(repeatOf('FREQ=MONTHLY;BYMONTHDAY=-1', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', bymonthday: [-1] })
    expect(repeatOf('FREQ=MONTHLY;BYMONTHDAY=1,-1', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', bymonthday: [1, -1] })
    // Day 0 names nothing, and no month has a 32nd-from-last day.
    expect(rruleToRepeat('FREQ=MONTHLY;BYMONTHDAY=0', monday).kind).toBe('dates')
    expect(rruleToRepeat('FREQ=MONTHLY;BYMONTHDAY=-32', monday).kind).toBe('dates')
  })

  it('maps a BYSETPOS list to bysetpos as an array', () => {
    expect(repeatOf('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,-1', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: [1, -1] })
  })

  it('maps a bare yearly rule to the anchor\'s own month and day', () => {
    expect(repeatOf('FREQ=YEARLY', monday)).toEqual({ type: 'schedule', freq: 'yearly' })
  })

  it('maps the yearly BY* parts to the months and days they name', () => {
    // The anchor is 2026-08-10, so these no longer have to restate it.
    expect(repeatOf('FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=10', monday))
      .toEqual({ type: 'schedule', freq: 'yearly', bymonth: [8], bymonthday: [10] })
    expect(repeatOf('FREQ=YEARLY;BYMONTH=3,9', monday))
      .toEqual({ type: 'schedule', freq: 'yearly', bymonth: [3, 9] })
    // US Thanksgiving, in both spellings the RFC allows for one month.
    expect(repeatOf('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', monday))
      .toEqual({ type: 'schedule', freq: 'yearly', bymonth: [11], byweekday: ['th'], bysetpos: 4 })
    expect(repeatOf('FREQ=YEARLY;BYMONTH=11;BYDAY=TH;BYSETPOS=4', monday))
      .toEqual({ type: 'schedule', freq: 'yearly', bymonth: [11], byweekday: ['th'], bysetpos: 4 })
    // Several months: only the ordinal spelling, which the RFC resolves within
    // each of them.
    expect(repeatOf('FREQ=YEARLY;BYMONTH=1,4,7,10;BYDAY=1MO', monday))
      .toEqual({ type: 'schedule', freq: 'yearly', bymonth: [1, 4, 7, 10], byweekday: ['mo'], bysetpos: 1 })
  })

  it('normalises a BYMONTH list to a sorted set', () => {
    expect(repeatOf('FREQ=YEARLY;BYMONTH=9,3,9', monday))
      .toEqual({ type: 'schedule', freq: 'yearly', bymonth: [3, 9] })
  })

  it('states all twelve months for a yearly day rule that names none', () => {
    // `FREQ=YEARLY;BYMONTHDAY=15` is the 15th of every month to RFC 5545
    // §3.3.10, not the 15th of the anchor's month once a year.
    expect(repeatOf('FREQ=YEARLY;BYMONTHDAY=15', monday)).toEqual({
      type: 'schedule', freq: 'yearly', bymonth: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], bymonthday: [15],
    })
  })

  it('maps BYMONTH as a plain limit at the finer frequencies', () => {
    expect(repeatOf('FREQ=DAILY;BYMONTH=2', monday))
      .toEqual({ type: 'schedule', freq: 'daily', bymonth: [2] })
    expect(repeatOf('FREQ=WEEKLY;BYDAY=MO;BYMONTH=1,2', monday))
      .toEqual({ type: 'schedule', freq: 'weekly', byweekday: ['mo'], bymonth: [1, 2] })
    expect(repeatOf('FREQ=MONTHLY;BYMONTHDAY=15;BYMONTH=3,6,9,12', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', bymonth: [3, 6, 9, 12], bymonthday: [15] })
  })

  it('maps COUNT and UNTIL to an end condition', () => {
    expect(repeatOf('FREQ=WEEKLY;COUNT=10', monday).end).toEqual({ type: 'count', occurrences: 10 })
    expect(repeatOf('FREQ=WEEKLY;UNTIL=20261231', monday).end).toEqual({ type: 'until', date: '2026-12-31' })
  })

  it('keeps the clock time from a datetime UNTIL', () => {
    // The test environment runs in UTC, so the Z timestamp needs no conversion.
    expect(repeatOf('FREQ=DAILY;UNTIL=20260601T120000Z', monday).end)
      .toEqual({ type: 'until', date: '2026-06-01', time: '12:00' })
  })

  it('maps biweekly BYDAY when the RFC and Meridian windows agree', () => {
    // Anchor Monday, WKST Monday, BYDAY=MO,WE — both listed days fall on or
    // after the anchor's weekday inside the RFC week, so the two agree.
    expect(repeatOf('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO', monday))
      .toEqual({ type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo', 'we'] })
  })
})

describe('rruleToRepeat — bounded expansion fallback', () => {
  const wednesday = new Date(2026, 7, 12) // 2026-08-12

  it('expands biweekly BYDAY when the windows disagree', () => {
    // Anchor Wednesday but BYDAY names Monday too: the RFC picks up the Monday
    // of the *next* fortnight, Meridian would count it forward into this one.
    const dates = datesOf('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO', wednesday)
    expect(dates.slice(0, 4)).toEqual(['2026-08-12', '2026-08-24', '2026-08-26', '2026-09-07'])
  })

  it('expands DAILY restricted to weekdays', () => {
    const dates = datesOf('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', wednesday)
    expect(dates.slice(0, 5)).toEqual(['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-17', '2026-08-18'])
    expect(dates).not.toContain('2026-08-15') // a Saturday
  })

  it('expands "first and third Friday" (mixed ordinals)', () => {
    const dates = datesOf('FREQ=MONTHLY;BYDAY=1FR,3FR', new Date(2026, 7, 7))
    expect(dates.slice(0, 4)).toEqual(['2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18'])
  })

  it('expands "every Friday of the month" (BYDAY with no position)', () => {
    const dates = datesOf('FREQ=MONTHLY;BYDAY=FR', new Date(2026, 7, 7))
    expect(dates.slice(0, 4)).toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'])
  })

  it('expands a yearly rule whose BYSETPOS spans the whole year', () => {
    // The engine reads a position per month, the RFC once per period, and a
    // yearly period is every month the rule names — so this is the first
    // Monday of March and nothing in September.
    const dates = datesOf('FREQ=YEARLY;BYMONTH=3,9;BYDAY=MO;BYSETPOS=1', new Date(2026, 2, 2))
    expect(dates.slice(0, 3)).toEqual(['2026-03-02', '2027-03-01', '2028-03-06'])
  })

  it('expands an ordinal BYDAY that names several weekdays', () => {
    // `1MO,1FR` is the first Monday *and* the first Friday; one `bysetpos`
    // over their combined candidates would pick only whichever came first.
    const dates = datesOf('FREQ=MONTHLY;BYDAY=1MO,1FR', new Date(2026, 0, 2))
    expect(dates.slice(0, 4)).toEqual(['2026-01-02', '2026-01-05', '2026-02-02', '2026-02-06'])
  })

  it('stops at UNTIL', () => {
    const dates = datesOf('FREQ=MONTHLY;BYDAY=FR;UNTIL=20260930', new Date(2026, 7, 7))
    expect(dates.at(-1)).toBe('2026-09-25')
  })

  it('counts COUNT from the anchor, not from the window', () => {
    // Ten weekdays from the anchor — all inside the window, so all ten appear.
    const dates = datesOf('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=10', wednesday)
    expect(dates).toHaveLength(10)
    expect(dates.at(-1)).toBe('2026-08-25')
  })

  it('returns nothing for a series that ran out before the window', () => {
    // COUNT=5 starting a decade ago: every occurrence predates the window.
    expect(datesOf('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=5', new Date(2010, 0, 4))).toEqual([])
  })

  it('reaches the window for an old open-ended series', () => {
    const dates = datesOf('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', new Date(2010, 0, 4))
    expect(dates.length).toBeGreaterThan(500)
    expect(dates[0]?.startsWith('2025-08')).toBe(true)
  })

  it('collapses a sub-daily rule to the days it touches', () => {
    const dates = datesOf('FREQ=HOURLY;INTERVAL=6;COUNT=9', wednesday)
    expect(dates).toEqual(['2026-08-12', '2026-08-13', '2026-08-14'])
  })

  it('falls back for parts it cannot express', () => {
    expect(datesOf('FREQ=MONTHLY;BYDAY=1FR,3FR', wednesday).length).toBeGreaterThan(0)
    expect(datesOf('FREQ=WEEKLY;BYWEEKNO=1', wednesday)).toBeDefined()
  })

  it('returns no dates at all for an unusable FREQ', () => {
    expect(datesOf('FREQ=FORTNIGHTLY', wednesday)).toEqual([])
    expect(datesOf('INTERVAL=2', wednesday)).toEqual([])
  })

  it('never claims a rule whose COUNT or UNTIL it could not read', () => {
    expect(rruleToRepeat('FREQ=WEEKLY;COUNT=abc', wednesday).kind).toBe('dates')
    expect(rruleToRepeat('FREQ=WEEKLY;UNTIL=notadate', wednesday).kind).toBe('dates')
  })

  it('caps a runaway rule rather than expanding forever', () => {
    const dates = datesOf('FREQ=HOURLY', wednesday)
    expect(dates.length).toBeLessThanOrEqual(750)
  })
})
