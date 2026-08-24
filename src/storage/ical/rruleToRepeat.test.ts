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

  it('maps a BYSETPOS list to bysetpos as an array', () => {
    expect(repeatOf('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,-1', monday))
      .toEqual({ type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: [1, -1] })
  })

  it('maps a yearly rule whose BY parts restate the anchor', () => {
    expect(repeatOf('FREQ=YEARLY', monday)).toEqual({ type: 'schedule', freq: 'yearly' })
    expect(repeatOf('FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=10', monday)).toEqual({ type: 'schedule', freq: 'yearly' })
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

  it('expands "last day of the month" (negative BYMONTHDAY)', () => {
    const dates = datesOf('FREQ=MONTHLY;BYMONTHDAY=-1', new Date(2026, 7, 31))
    expect(dates.slice(0, 3)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31'])
  })

  it('expands "every Friday of the month" (BYDAY with no position)', () => {
    const dates = datesOf('FREQ=MONTHLY;BYDAY=FR', new Date(2026, 7, 7))
    expect(dates.slice(0, 4)).toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'])
  })

  it('expands a yearly nth-weekday-of-a-named-month rule', () => {
    // US Thanksgiving: fourth Thursday in November.
    const dates = datesOf('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', new Date(2025, 10, 27))
    expect(dates.slice(0, 3)).toEqual(['2025-11-27', '2026-11-26', '2027-11-25'])
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
    expect(datesOf('FREQ=MONTHLY;BYMONTHDAY=-1', wednesday).length).toBeGreaterThan(0)
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
