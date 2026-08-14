import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'
import { keyOf } from './helpers'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-01-31',
    time: null,
    repeat: { type: 'schedule', freq: 'monthly', bymonthday: [31] },
    entryKey: keyOf('note.md'),
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()

describe('expandRange month-end overflow handling', () => {
  it('monthly bymonthday:[31] never lands on a day that is not the 31st', () => {
    const dates = expandRange([series()], roots, new Date(2026, 0, 1), new Date(2026, 5, 30))
      .map(o => o.date)

    expect(dates.every(d => d.endsWith('-31'))).toBe(true)
    expect(dates).not.toContain('2026-05-01')
    expect(dates).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })

  it('monthly with no bymonthday (same day as anchor) skips short months instead of overflowing', () => {
    const dates = expandRange(
      [series({ id: 'series-2', repeat: { type: 'schedule', freq: 'monthly' } })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 5, 30),
    ).map(o => o.date)

    expect(dates.every(d => d.endsWith('-31'))).toBe(true)
    expect(dates).not.toContain('2026-05-01')
  })

  it('yearly Feb 29 anchor skips non-leap years instead of landing on March 1', () => {
    const dates = expandRange(
      [series({ id: 'series-3', date: '2024-02-29', repeat: { type: 'schedule', freq: 'yearly' } })],
      roots,
      new Date(2024, 0, 1),
      new Date(2028, 11, 31),
    ).map(o => o.date)

    expect(dates.every(d => d.endsWith('-02-29'))).toBe(true)
    expect(dates).toEqual(['2024-02-29', '2028-02-29'])
  })
})
