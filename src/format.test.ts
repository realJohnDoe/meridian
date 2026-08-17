import { describe, it, expect } from 'vitest'
import { durationToEndDate, endDateToDuration, formatDurationChip, fmtDuration, fmtEndDate, fmtTopBarWeek } from '@/format'
import type { Scheduled } from '@/types'

describe('durationToEndDate', () => {
  it('returns start date unchanged for a minutes duration', () => {
    expect(durationToEndDate('2026-06-01', '30 minutes')).toBe('2026-06-01')
  })

  it('adds whole days for an hours duration, floored', () => {
    // 30 hours -> floor(30/24) = 1 day
    expect(durationToEndDate('2026-06-01', '30 hours')).toBe('2026-06-02')
  })

  it('adds n-1 days for a days duration', () => {
    expect(durationToEndDate('2026-06-01', '3 days')).toBe('2026-06-03')
  })

  it('adds n*7-1 days for a weeks duration', () => {
    expect(durationToEndDate('2026-06-01', '2 weeks')).toBe('2026-06-14')
  })

  it('adds n*30-1 days for a months duration', () => {
    expect(durationToEndDate('2026-06-01', '1 month')).toBe('2026-06-30')
  })

  it('adds n*365-1 days for a years duration', () => {
    expect(durationToEndDate('2026-01-01', '1 year')).toBe('2026-12-31')
  })

  it('falls back to start+1 day for an unparseable duration', () => {
    expect(durationToEndDate('2026-06-01', 'nonsense')).toBe('2026-06-02')
  })

  it('uses calendar-correct month arithmetic across a short month', () => {
    // Jan 31 + 1 month should land on Feb 28, not roll into March
    expect(durationToEndDate('2026-01-31', '1 month')).toBe('2026-02-28')
  })
})

describe('endDateToDuration', () => {
  it('round-trips days and weeks', () => {
    expect(endDateToDuration('2026-06-01', '2026-06-03')).toBe('3 days')
    expect(endDateToDuration('2026-06-01', '2026-06-14')).toBe('2 weeks')
  })

  it('round-trips months and years using calendar arithmetic, not a fixed day count', () => {
    expect(endDateToDuration('2026-01-31', '2026-02-28')).toBe('1 month')
    expect(endDateToDuration('2026-02-01', '2026-02-28')).toBe('1 month')
    expect(endDateToDuration('2024-01-01', '2024-12-31')).toBe('1 year')
    expect(endDateToDuration('2026-06-01', '2026-08-31')).toBe('3 months')
    expect(endDateToDuration('2026-06-01', '2028-05-31')).toBe('2 years')
  })

  it('returns null for a non-positive range', () => {
    expect(endDateToDuration('2026-06-01', '2026-05-31')).toBeNull()
  })
})

describe('fmtDuration', () => {
  it('renders minutes under an hour as-is', () => {
    expect(fmtDuration('45 minutes')).toBe('45 minutes')
  })

  it('renders an exact hour boundary in minutes without a minutes remainder', () => {
    expect(fmtDuration('60 minutes')).toBe('1 hour')
  })

  it('renders minutes over an hour as hours + minutes', () => {
    expect(fmtDuration('90 minutes')).toBe('1 hour, 30 minutes')
  })

  it('renders an exact day boundary in hours without an hours remainder', () => {
    expect(fmtDuration('24 hours')).toBe('1 day')
  })

  it('renders hours over a day as days + hours', () => {
    expect(fmtDuration('30 hours')).toBe('1 day, 6 hours')
  })

  it('renders units it does not special-case unchanged when already long-form', () => {
    expect(fmtDuration('3 days')).toBe('3 days')
  })

  it('normalizes short-form units to long form', () => {
    expect(fmtDuration('3d')).toBe('3 days')
    expect(fmtDuration('2w')).toBe('2 weeks')
    expect(fmtDuration('1mo')).toBe('1 month')
    expect(fmtDuration('1y')).toBe('1 year')
  })
})

describe('formatDurationChip', () => {
  it('shows an end time for a timed occurrence', () => {
    const scheduled: Scheduled = { date: '2026-06-01', time: '09:00' }
    expect(formatDurationChip('1 hour', scheduled)).toBe('until 10:00 (1 hour)')
  })

  it('shows only the duration for a whole-day event with a sub-day duration', () => {
    const scheduled: Scheduled = { date: '2026-06-01', time: '' }
    expect(formatDurationChip('45 minutes', scheduled)).toBe('45 minutes')
  })

  it('shows an end date for a whole-day multi-day event', () => {
    const scheduled: Scheduled = { date: '2026-06-01', time: '' }
    const expectedEnd = fmtEndDate(durationToEndDate(scheduled.date, '3 days'))
    expect(formatDurationChip('3 days', scheduled)).toBe(`until ${expectedEnd} (3 days)`)
  })
})

describe('fmtTopBarWeek', () => {
  const today = new Date(2026, 7, 12) // within the same-month week below

  it('shows the month once for a week within a single month', () => {
    expect(fmtTopBarWeek(new Date(2026, 7, 10), new Date(2026, 7, 16), today)).toBe('Aug 10 – 16')
  })

  it('shows both months for a week spanning a month boundary', () => {
    expect(fmtTopBarWeek(new Date(2026, 7, 31), new Date(2026, 8, 6), today)).toBe('Aug 31 – Sep 6')
  })

  it('shows both years for a week spanning a year boundary', () => {
    expect(fmtTopBarWeek(new Date(2025, 11, 29), new Date(2026, 0, 4), today)).toBe('Dec 29, 2025 – Jan 4, 2026')
  })

  it('omits the year for a same-month week in the current year', () => {
    expect(fmtTopBarWeek(new Date(2026, 7, 10), new Date(2026, 7, 16), today)).not.toMatch(/2026/)
  })

  it('shows the year once, on the end, for a same-month week in a different year than today', () => {
    expect(fmtTopBarWeek(new Date(2025, 7, 10), new Date(2025, 7, 16), today)).toBe('Aug 10 – Aug 16, 2025')
  })

  it('adds the year to a cross-month week outside the current year, even without crossing years itself', () => {
    expect(fmtTopBarWeek(new Date(2025, 7, 31), new Date(2025, 8, 6), today)).toBe('Aug 31, 2025 – Sep 6, 2025')
  })
})
