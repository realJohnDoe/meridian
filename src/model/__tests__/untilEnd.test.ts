import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-05-26', // Tuesday
    time: '15:30',
    repeat: {
      type: 'schedule',
      freq: 'weekly',
      interval: 1,
      byweekday: ['tu'],
      end: { type: 'until', date: '2026-07-14' }, // also a Tuesday
    },
    fileSlug: 'abc.md',
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()

describe('expandRange "until" end date', () => {
  it('includes an occurrence that falls exactly on the until date, even though the occurrence has a time-of-day later than midnight', () => {
    const dates = expandRange([series()], roots, new Date('2026-05-01'), new Date('2026-08-01'))
      .map(o => o.date)
    expect(dates).toContain('2026-07-14')
  })

  it('still excludes occurrences the day after the until date', () => {
    const dates = expandRange([series()], roots, new Date('2026-05-01'), new Date('2026-08-01'))
      .map(o => o.date)
    expect(dates).not.toContain('2026-07-21')
  })
})
