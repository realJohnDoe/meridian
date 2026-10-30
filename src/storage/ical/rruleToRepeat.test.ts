import { describe, it, expect } from 'vitest'
import { rruleToRepeat, parseRRule } from './rruleToRepeat'
import type { Repeat } from '@/types'

/** The mapped `Repeat`, or a failure naming what came back instead. */
function repeatOf(rrule: string, anchor: Date): Repeat {
  const mapped = rruleToRepeat(rrule, anchor)
  if (mapped.kind !== 'repeat') throw new Error(`expected a repeat, got ${mapped.kind}`)
  return mapped.repeat
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
    expect(rruleToRepeat('FREQ=MONTHLY;BYMONTHDAY=0', monday).kind).toBe('unsupported')
    expect(rruleToRepeat('FREQ=MONTHLY;BYMONTHDAY=-32', monday).kind).toBe('unsupported')
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
    // after the anchor's weekday inside the RFC week, so the two agree. No
    // `wkst` is written: it could not change a date, and the plainer spelling
    // is the better thing to put in someone's file.
    expect(repeatOf('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO', monday))
      .toEqual({ type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo', 'we'] })
  })

  it('states wkst when the windows disagree, rather than giving up on the rule', () => {
    // Anchor Wednesday but BYDAY names Monday too: the RFC picks up that Monday
    // in the *next* fortnight, and anchor-opened windows would count it forward
    // into this one. `wkst` moves the engine's window origin onto the RFC's, so
    // the rule can be carried instead of expanded. `repeatToRrule.test.ts`
    // holds the resulting dates against the RFC walk's, case for case.
    expect(repeatOf('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO', new Date(2026, 7, 12)))
      .toEqual({ type: 'schedule', freq: 'weekly', interval: 2, wkst: 'mo', byweekday: ['mo', 'we'] })
  })

  it('maps DAILY restricted to weekdays — BYDAY is a limit there, and the engine applies it', () => {
    expect(repeatOf('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', monday))
      .toEqual({ type: 'schedule', freq: 'daily', byweekday: ['mo', 'tu', 'we', 'th', 'fr'] })
    expect(repeatOf('FREQ=DAILY;BYMONTHDAY=1,15', monday))
      .toEqual({ type: 'schedule', freq: 'daily', bymonthday: [1, 15] })
  })

  it('maps "every Friday of the month" to the weekly rule it is identical to', () => {
    // The engine's monthly arm cannot read a weekday without a position, but at
    // INTERVAL=1 it does not need to: every Friday of every month is every
    // Friday. BYMONTH rides along as the same limit in both readings.
    expect(repeatOf('FREQ=MONTHLY;BYDAY=FR', new Date(2026, 7, 7)))
      .toEqual({ type: 'schedule', freq: 'weekly', byweekday: ['fr'] })
    expect(repeatOf('FREQ=MONTHLY;BYDAY=WE;BYMONTH=3,6', new Date(2026, 2, 4)))
      .toEqual({ type: 'schedule', freq: 'weekly', bymonth: [3, 6], byweekday: ['we'] })
  })
})

describe('rruleToRepeat — unsupported rules', () => {
  const wednesday = new Date(2026, 7, 12) // 2026-08-12

  it.each([
    'FREQ=MONTHLY;BYDAY=1FR,3FR',
    'FREQ=WEEKLY;BYWEEKNO=1',
    'FREQ=HOURLY;INTERVAL=6;COUNT=9',
    'FREQ=FORTNIGHTLY',
    'INTERVAL=2',
    'FREQ=WEEKLY;COUNT=abc',
    'FREQ=WEEKLY;UNTIL=notadate',
  ])('reports %s as unsupported', rrule => {
    expect(rruleToRepeat(rrule, wednesday).kind).toBe('unsupported')
  })
})
