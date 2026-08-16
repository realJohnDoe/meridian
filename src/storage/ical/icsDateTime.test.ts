import { describe, it, expect } from 'vitest'
import { parseIcsDateTime, localDate, localTime, durationBetween, parseIsoDuration } from './icsDateTime'

describe('parseIcsDateTime', () => {
  it('reads a VALUE=DATE as an all-day value at local midnight', () => {
    const got = parseIcsDateTime('20260815')!
    expect(got.allDay).toBe(true)
    expect(localDate(got.when)).toBe('2026-08-15')
    expect(got.when.getHours()).toBe(0)
  })

  it('reads a floating date-time as local wall clock, unchanged', () => {
    const got = parseIcsDateTime('20260815T093000')!
    expect(got.allDay).toBe(false)
    expect(localDate(got.when)).toBe('2026-08-15')
    expect(localTime(got.when)).toBe('09:30')
  })

  it('reads a Z timestamp as the UTC instant it names', () => {
    const got = parseIcsDateTime('20260815T093000Z')!
    expect(got.when.toISOString()).toBe('2026-08-15T09:30:00.000Z')
  })

  it('resolves a TZID wall clock to the right instant', () => {
    // 09:30 in Berlin on an August day is 07:30 UTC (CEST, UTC+2).
    const got = parseIcsDateTime('20260815T093000', 'Europe/Berlin')!
    expect(got.when.toISOString()).toBe('2026-08-15T07:30:00.000Z')
    expect(got.tzid).toBe('Europe/Berlin')
  })

  it('resolves a TZID wall clock on the winter side of DST', () => {
    // 09:30 in Berlin in January is 08:30 UTC (CET, UTC+1).
    expect(parseIcsDateTime('20260115T093000', 'Europe/Berlin')!.when.toISOString())
      .toBe('2026-01-15T08:30:00.000Z')
  })

  it('resolves a TZID wall clock west of Greenwich', () => {
    // 09:30 in New York in August is 13:30 UTC (EDT, UTC-4).
    expect(parseIcsDateTime('20260815T093000', 'America/New_York')!.when.toISOString())
      .toBe('2026-08-15T13:30:00.000Z')
  })

  it('gets the hour right on both sides of a DST transition', () => {
    // Europe/Berlin springs forward 2026-03-29 02:00 → 03:00.
    expect(parseIcsDateTime('20260328T120000', 'Europe/Berlin')!.when.toISOString())
      .toBe('2026-03-28T11:00:00.000Z') // CET, UTC+1
    expect(parseIcsDateTime('20260330T120000', 'Europe/Berlin')!.when.toISOString())
      .toBe('2026-03-30T10:00:00.000Z') // CEST, UTC+2
  })

  it('falls back to floating local time for an unknown TZID', () => {
    const got = parseIcsDateTime('20260815T093000', 'Mars/Olympus')!
    expect(localTime(got.when)).toBe('09:30')
    expect(got.tzid).toBe('Mars/Olympus') // still reported, for `extra`
  })

  it('accepts a date-time with no seconds', () => {
    expect(localTime(parseIcsDateTime('20260815T0930')!.when)).toBe('09:30')
  })

  it('returns null for a value that is not a date at all', () => {
    expect(parseIcsDateTime('')).toBeNull()
    expect(parseIcsDateTime('tomorrow')).toBeNull()
    expect(parseIcsDateTime('2026-08-15')).toBeNull()
  })
})

describe('durationBetween', () => {
  const at = (h: number, m = 0) => new Date(2026, 7, 15, h, m)

  it('prefers whole hours, falls back to minutes', () => {
    expect(durationBetween(at(9), at(9, 30), false)).toBe('30 minutes')
    expect(durationBetween(at(9), at(10), false)).toBe('1 hour')
    expect(durationBetween(at(9), at(11), false)).toBe('2 hours')
    expect(durationBetween(at(9), at(10, 30), false)).toBe('90 minutes')
  })

  it('uses days for whole-day timed spans', () => {
    expect(durationBetween(new Date(2026, 7, 15, 9), new Date(2026, 7, 17, 9), false)).toBe('2 days')
  })

  it('counts all-day spans in days, and omits a single day', () => {
    // DTEND is exclusive for all-day values.
    expect(durationBetween(new Date(2026, 7, 15), new Date(2026, 7, 16), true)).toBeUndefined()
    expect(durationBetween(new Date(2026, 7, 15), new Date(2026, 7, 18), true)).toBe('3 days')
  })

  it('returns undefined for a zero or negative span', () => {
    expect(durationBetween(at(9), at(9), false)).toBeUndefined()
    expect(durationBetween(at(10), at(9), false)).toBeUndefined()
  })
})

describe('parseIsoDuration', () => {
  it('parses the forms feeds actually use', () => {
    expect(parseIsoDuration('PT30M')).toBe(30 * 60_000)
    expect(parseIsoDuration('PT1H30M')).toBe(90 * 60_000)
    expect(parseIsoDuration('P1D')).toBe(86_400_000)
    expect(parseIsoDuration('P1W')).toBe(7 * 86_400_000)
    expect(parseIsoDuration('PT45S')).toBe(45_000)
  })

  it('parses a negative duration', () => {
    expect(parseIsoDuration('-PT15M')).toBe(-15 * 60_000)
  })

  it('returns null for junk and for an empty duration', () => {
    expect(parseIsoDuration('P')).toBeNull()
    expect(parseIsoDuration('30m')).toBeNull()
    expect(parseIsoDuration('')).toBeNull()
  })
})
