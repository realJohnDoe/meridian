import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'
import { keyOf } from './helpers'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-01-02', // a Friday
    time: null,
    repeat: { type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: 1 },
    entryKey: keyOf('note.md'),
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()

describe('expandRange monthly bysetpos as a list', () => {
  it('a scalar bysetpos still selects one date per month', () => {
    const dates = expandRange([series()], roots, new Date(2026, 0, 1), new Date(2026, 3, 30)).map(o => o.date)
    expect(dates).toEqual(['2026-01-02', '2026-02-06', '2026-03-06', '2026-04-03'])
  })

  it('a bysetpos list selects every named position, deduped and sorted', () => {
    // First and third Friday of each month.
    const dates = expandRange(
      [series({ repeat: { type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: [1, 3] } })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 1, 28),
    ).map(o => o.date)
    expect(dates).toEqual(['2026-01-02', '2026-01-16', '2026-02-06', '2026-02-20'])
  })

  it('a negative position beyond -1 resolves from the end of the candidate list', () => {
    // Second-to-last weekday of the month.
    const dates = expandRange(
      [series({
        date: '2026-01-29',
        repeat: { type: 'schedule', freq: 'monthly', byweekday: ['mo', 'tu', 'we', 'th', 'fr'], bysetpos: -2 },
      })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 2, 31),
    ).map(o => o.date)
    expect(dates).toEqual(['2026-01-29', '2026-02-26', '2026-03-30'])
  })

  it('duplicate positions in the list collapse to one date', () => {
    const dates = expandRange(
      [series({ repeat: { type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: [1, 1, -5] } })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 0, 31),
    ).map(o => o.date)
    // January 2026 has five Fridays; position 1 and position -5 are the same day.
    expect(dates).toEqual(['2026-01-02'])
  })

  it('an out-of-range position in a list is dropped rather than throwing', () => {
    const dates = expandRange(
      [series({ repeat: { type: 'schedule', freq: 'monthly', byweekday: ['fr'], bysetpos: [1, 10] } })],
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 0, 31),
    ).map(o => o.date)
    expect(dates).toEqual(['2026-01-02'])
  })
})
