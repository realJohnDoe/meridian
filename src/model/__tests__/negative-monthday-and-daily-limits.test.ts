import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'
import { keyOf } from './helpers'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-01-31',
    time: null,
    repeat: { type: 'schedule', freq: 'monthly', bymonthday: [-1] },
    entryKey: keyOf('note.md'),
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()

describe('expandRange negative bymonthday', () => {
  it('monthly bymonthday: [-1] lands on the last day of each month, not the anchor-day-of-month offset', () => {
    const dates = expandRange([series()], roots, new Date(2026, 0, 1), new Date(2026, 2, 31, 23, 59))
      .map(o => o.date)

    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('a day-of-month that falls outside every month for the given negative (e.g. -32) is skipped, not overflowed', () => {
    const dates = expandRange(
      [series({ id: 'series-2', repeat: { type: 'schedule', freq: 'monthly', bymonthday: [-32] } })],
      roots,
      // Window excludes the anchor's own month so only generated (not
      // anchor-forced) occurrences are under test.
      new Date(2026, 1, 1),
      new Date(2026, 3, 30, 23, 59),
    ).map(o => o.date)

    expect(dates).toEqual([])
  })
})

describe('expandRange daily BY* limits', () => {
  it('daily + byweekday only emits the named weekdays, not every day', () => {
    const dates = expandRange(
      [series({
        id: 'series-3',
        date: '2026-01-05', // a Monday
        repeat: { type: 'schedule', freq: 'daily', byweekday: ['mo', 'tu', 'we', 'th', 'fr'] },
      })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 0, 18, 23, 59),
    ).map(o => o.date)

    expect(dates).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
      '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16',
    ])
  })

  it('daily + bymonthday only emits the named days-of-month', () => {
    const dates = expandRange(
      [series({
        id: 'series-4',
        date: '2026-01-01',
        repeat: { type: 'schedule', freq: 'daily', bymonthday: [1, 15] },
      })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 1, 28, 23, 59),
    ).map(o => o.date)

    expect(dates).toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15'])
  })

  it('daily + negative bymonthday resolves against each month\'s own length', () => {
    const dates = expandRange(
      [series({
        id: 'series-5',
        date: '2026-01-31', // last day of Jan, so the anchor itself satisfies bymonthday: [-1]
        repeat: { type: 'schedule', freq: 'daily', bymonthday: [-1] },
      })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 1, 28, 23, 59),
    ).map(o => o.date)

    expect(dates).toEqual(['2026-01-31', '2026-02-28'])
  })
})
