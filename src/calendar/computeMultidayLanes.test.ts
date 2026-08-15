import { describe, it, expect } from 'vitest'
import { computeMultidayLanes, compactRowLanes, visibleLaneCount } from './computeMultidayLanes'
import type { Occurrence } from '@/types'
import { testKey, TEST_VAULT } from '@/test-utils'

function makeOcc(overrides: Partial<Occurrence> & { date: string; duration: string }): Occurrence {
  const { date, duration, ...rest } = overrides
  return {
    date,
    time: null,
    source: 'explicit',
    entryKey: testKey('note.md'),
    id: 'occ-1',
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: '', tags: [], items: [], duration },
    ...rest,
  }
}

describe('computeMultidayLanes', () => {
  it('assigns non-overlapping events to the same lane', () => {
    const a = makeOcc({ id: 'a', date: '2026-06-01', duration: '3 days' })
    const b = makeOcc({ id: 'b', date: '2026-06-05', duration: '2 days' })

    const lanes = computeMultidayLanes([a, b])

    expect(lanes.find(l => l.occ.id === 'a')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'b')!.lane).toBe(0)
  })

  it('assigns overlapping events to distinct lanes', () => {
    const a = makeOcc({ id: 'a', date: '2026-06-01', duration: '5 days' })
    const b = makeOcc({ id: 'b', date: '2026-06-03', duration: '3 days' })

    const lanes = computeMultidayLanes([a, b])

    expect(lanes.find(l => l.occ.id === 'a')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'b')!.lane).toBe(1)
  })

  it('reuses a lane once its last event has ended', () => {
    const a = makeOcc({ id: 'a', date: '2026-06-01', duration: '2 days' })
    const b = makeOcc({ id: 'b', date: '2026-06-01', duration: '2 days' })
    const c = makeOcc({ id: 'c', date: '2026-06-03', duration: '2 days' })

    const lanes = computeMultidayLanes([a, b, c])

    expect(lanes.find(l => l.occ.id === 'a')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'b')!.lane).toBe(1)
    expect(lanes.find(l => l.occ.id === 'c')!.lane).toBe(0)
  })

  it('keeps the same lane for an event spanning multiple weeks', () => {
    const long = makeOcc({ id: 'long', date: '2026-06-01', duration: '21 days' })
    const short = makeOcc({ id: 'short', date: '2026-06-08', duration: '2 days' })

    const lanes = computeMultidayLanes([long, short])

    expect(lanes.find(l => l.occ.id === 'long')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'short')!.lane).toBe(1)
  })

  it('returns an empty array for no events', () => {
    expect(computeMultidayLanes([])).toEqual([])
  })
})

describe('compactRowLanes', () => {
  it('is a no-op for an already-dense range', () => {
    const map = compactRowLanes([0, 1, 2])
    expect([...map.entries()]).toEqual([[0, 0], [1, 1], [2, 2]])
  })

  it('collapses a sparse set of lanes to a dense range, preserving order', () => {
    // e.g. lane 5 survives alone in a row after lanes 0-4 have all ended.
    const map = compactRowLanes([5])
    expect([...map.entries()]).toEqual([[5, 0]])
  })

  it('preserves relative order across a mixed sparse set', () => {
    const map = compactRowLanes([1, 4, 7])
    expect([...map.entries()]).toEqual([[1, 0], [4, 1], [7, 2]])
  })

  it('de-duplicates repeated lanes (multiple bars sharing a lane in the row)', () => {
    const map = compactRowLanes([3, 3, 0, 3])
    expect([...map.entries()]).toEqual([[0, 0], [3, 1]])
  })

  it('is a no-op for an empty row', () => {
    expect(compactRowLanes([]).size).toBe(0)
  })
})

describe('visibleLaneCount', () => {
  it('shows every lane when they fit within maxVisible', () => {
    expect(visibleLaneCount(3, 4)).toBe(3)
    expect(visibleLaneCount(4, 4)).toBe(4)
  })

  it('reserves one slot for the overflow marker when lanes exceed maxVisible', () => {
    expect(visibleLaneCount(6, 4)).toBe(3)
    expect(visibleLaneCount(5, 4)).toBe(3)
  })

  it('never goes negative when maxVisible is smaller than the reservation', () => {
    expect(visibleLaneCount(3, 1)).toBe(0)
    expect(visibleLaneCount(3, 0)).toBe(0)
  })
})
