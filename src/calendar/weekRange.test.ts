import { describe, it, expect } from 'vitest'
import { weekStartFor, weekDays, weekContains, weekNumberFor } from './weekRange'

// 2026-08-12 is a Wednesday.
const WED = new Date(2026, 7, 12)

describe('weekStartFor', () => {
  it('finds the preceding Monday for a Monday-start week', () => {
    expect(weekStartFor(WED, 1)).toEqual(new Date(2026, 7, 10))
  })

  it('finds the preceding Sunday for a Sunday-start week', () => {
    expect(weekStartFor(WED, 0)).toEqual(new Date(2026, 7, 9))
  })

  it('finds the preceding Saturday for a Saturday-start week', () => {
    expect(weekStartFor(WED, 6)).toEqual(new Date(2026, 7, 8))
  })

  it('is a no-op when the date is already the week start', () => {
    const monday = new Date(2026, 7, 10)
    expect(weekStartFor(monday, 1)).toEqual(monday)
  })

  it('normalizes time-of-day to midnight', () => {
    const withTime = new Date(2026, 7, 12, 14, 30)
    expect(weekStartFor(withTime, 1)).toEqual(new Date(2026, 7, 10))
  })
})

describe('weekDays', () => {
  it('returns 7 consecutive calendar days starting at weekStart', () => {
    const start = new Date(2026, 7, 10)
    const days = weekDays(start)
    expect(days).toHaveLength(7)
    expect(days.map(d => d.getDate())).toEqual([10, 11, 12, 13, 14, 15, 16])
  })

  it('rolls correctly across a month boundary', () => {
    // Monday-start week containing Jan 29 2026 (Thu) runs Jan 26 - Feb 1.
    const start = weekStartFor(new Date(2026, 0, 29), 1)
    const days = weekDays(start)
    expect(days.map(d => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual([
      '1-26', '1-27', '1-28', '1-29', '1-30', '1-31', '2-1',
    ])
  })

  it('rolls correctly across a year boundary', () => {
    // Dec 29 2025 is already a Monday, so the Monday-start week runs Dec 29 - Jan 4.
    const start = weekStartFor(new Date(2025, 11, 29), 1)
    const days = weekDays(start)
    expect(days.map(d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)).toEqual([
      '2025-12-29', '2025-12-30', '2025-12-31', '2026-1-1', '2026-1-2', '2026-1-3', '2026-1-4',
    ])
  })
})

describe('weekNumberFor', () => {
  it('returns the ISO week number for a mid-year date', () => {
    // 2026-08-10 is a Monday; ISO week 33 of 2026.
    expect(weekNumberFor(new Date(2026, 7, 10))).toBe(33)
  })

  it('is stable across the days of the same ISO week', () => {
    const weekStart = new Date(2026, 7, 10) // Monday
    const days = weekDays(weekStart)
    for (const d of days) expect(weekNumberFor(d)).toBe(weekNumberFor(weekStart))
  })

  it('rolls over at a year boundary per ISO 8601 (week 1 contains the first Thursday)', () => {
    // 2025-12-29 (Mon) - 2026-01-04 (Sun) is ISO week 1 of 2026, since its
    // Thursday (Jan 1) falls in 2026.
    expect(weekNumberFor(new Date(2025, 11, 29))).toBe(1)
    expect(weekNumberFor(new Date(2026, 0, 1))).toBe(1)
  })
})

describe('weekContains', () => {
  const weekStart = new Date(2026, 7, 10) // Monday

  it('is true for the start and end days (inclusive boundaries)', () => {
    expect(weekContains(weekStart, weekStart)).toBe(true)
    expect(weekContains(weekStart, new Date(2026, 7, 16))).toBe(true)
  })

  it('is true for a day in the middle of the week', () => {
    expect(weekContains(weekStart, new Date(2026, 7, 13))).toBe(true)
  })

  it('is false for the day just before or just after the week', () => {
    expect(weekContains(weekStart, new Date(2026, 7, 9))).toBe(false)
    expect(weekContains(weekStart, new Date(2026, 7, 17))).toBe(false)
  })

  it('ignores time-of-day on either argument', () => {
    const lateInWeek = new Date(2026, 7, 16, 23, 59)
    expect(weekContains(weekStart, lateInWeek)).toBe(true)
  })
})
