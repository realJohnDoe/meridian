import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-01-01',
    time: '08:00',
    repeat: { type: 'schedule', freq: 'daily' },
    fileSlug: 'meds.md',
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()

describe('expandRange far from the anchor', () => {
  it('a daily series still expands more than 500 days beyond its anchor', () => {
    const dates = expandRange([series()], roots, new Date(2029, 6, 1), new Date(2029, 6, 31, 23, 59))
      .map(o => o.date)
    expect(dates).toHaveLength(31)
  })

  it('a weekly series still expands more than 500 weeks beyond its anchor', () => {
    const dates = expandRange(
      [series({ id: 'series-2', repeat: { type: 'schedule', freq: 'weekly' } })],
      roots,
      new Date(2040, 0, 1),
      new Date(2040, 0, 31, 23, 59),
    ).map(o => o.date)
    expect(dates.length).toBeGreaterThan(0)
  })

  it('an until-bounded daily series still respects the end date once skipped far forward', () => {
    const dates = expandRange(
      [series({
        id: 'series-3',
        repeat: { type: 'schedule', freq: 'daily', end: { type: 'until', date: '2026-01-10' } },
      })],
      roots,
      new Date(2029, 6, 1),
      new Date(2029, 6, 31, 23, 59),
    ).map(o => o.date)
    expect(dates).toHaveLength(0)
  })

  it('a count-bounded series far from the anchor is unaffected by the seek-forward optimization', () => {
    const dates = expandRange(
      [series({
        id: 'series-4',
        repeat: { type: 'schedule', freq: 'daily', end: { type: 'count', occurrences: 5 } },
      })],
      roots,
      new Date(2029, 6, 1),
      new Date(2029, 6, 31, 23, 59),
    ).map(o => o.date)
    expect(dates).toHaveLength(0)
  })
})
