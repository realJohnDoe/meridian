import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-04-02', // Thursday
    time: null,
    repeat: { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['su'] },
    fileSlug: 'note.md',
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()

describe('expandRange week-start handling for biweekly schedules', () => {
  it('groups byweekday days into a Monday-started week by default', () => {
    const dates = expandRange([series()], roots, new Date('2026-04-01'), new Date('2026-05-31'))
      .map(o => o.date)
    expect(dates).toEqual(['2026-04-02', '2026-04-05', '2026-04-19', '2026-05-03', '2026-05-17', '2026-05-31'])
  })

  it('groups byweekday days into a Sunday-started week when weekStart=0', () => {
    const dates = expandRange([series()], roots, new Date('2026-04-01'), new Date('2026-05-31'), 0)
      .map(o => o.date)
    expect(dates).toEqual(['2026-04-02', '2026-04-12', '2026-04-26', '2026-05-10', '2026-05-24'])
  })
})
