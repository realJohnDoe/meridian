import { describe, it, expect } from 'vitest'
import { durationToEndDate, formatDurationChip, fmtDuration, fmtEndDate } from '@/format'
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

  it('passes through units it does not special-case', () => {
    expect(fmtDuration('3 days')).toBe('3 days')
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
