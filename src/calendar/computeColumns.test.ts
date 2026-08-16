import { describe, it, expect } from 'vitest'
import { computeColumns } from './computeColumns'
import type { Occurrence } from '@/types'
import { testKey, TEST_VAULT } from '@/test-utils'

function makeOcc(overrides: Partial<Occurrence> & { jsTime?: Date; duration?: string } = {}): Occurrence {
  const { jsTime, duration, ...rest } = overrides
  return {
    date: '2026-06-15',
    time: '09:00',
    source: 'explicit',
    entryKey: testKey('note.md'),
    id: 'occ-1',
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: '', tags: [], items: [], jsTime, duration },
    ...rest,
  }
}

describe('computeColumns', () => {
  it('places non-overlapping events in a single column', () => {
    const a = makeOcc({ id: 'a', jsTime: new Date(2026, 5, 15, 9, 0), duration: '1h' })
    const b = makeOcc({ id: 'b', jsTime: new Date(2026, 5, 15, 10, 0), duration: '1h' })

    const cols = computeColumns([a, b])

    expect(cols).toHaveLength(1)
    expect(cols[0]!.map(e => e.occ.id)).toEqual(['a', 'b'])
  })

  it('splits overlapping events into separate columns', () => {
    const a = makeOcc({ id: 'a', jsTime: new Date(2026, 5, 15, 9, 0), duration: '1h' })
    const b = makeOcc({ id: 'b', jsTime: new Date(2026, 5, 15, 9, 30), duration: '1h' })

    const cols = computeColumns([a, b])

    expect(cols).toHaveLength(2)
    expect(cols[0]![0]!.occ.id).toBe('a')
    expect(cols[1]![0]!.occ.id).toBe('b')
  })

  it('reuses a column once its last event has ended', () => {
    const a = makeOcc({ id: 'a', jsTime: new Date(2026, 5, 15, 9, 0), duration: '30m' })
    const b = makeOcc({ id: 'b', jsTime: new Date(2026, 5, 15, 9, 30), duration: '30m' })
    const c = makeOcc({ id: 'c', jsTime: new Date(2026, 5, 15, 9, 15), duration: '30m' })

    const cols = computeColumns([a, b, c])

    expect(cols).toHaveLength(2)
    expect(cols[0]!.map(e => e.occ.id)).toEqual(['a', 'b'])
    expect(cols[1]!.map(e => e.occ.id)).toEqual(['c'])
  })

  it('sorts input events by start time before packing', () => {
    const late = makeOcc({ id: 'late', jsTime: new Date(2026, 5, 15, 11, 0), duration: '30m' })
    const early = makeOcc({ id: 'early', jsTime: new Date(2026, 5, 15, 9, 0), duration: '30m' })

    const cols = computeColumns([late, early])

    expect(cols).toHaveLength(1)
    expect(cols[0]!.map(e => e.occ.id)).toEqual(['early', 'late'])
  })

  it('returns an empty array for no events', () => {
    expect(computeColumns([])).toEqual([])
  })

  it('gives a later event its own full-width cluster instead of the day-wide column count', () => {
    // Two 1-2pm events collide (need 2 columns); an unrelated 3-4pm event
    // collides with neither and should get totalCols=1, not 2.
    const a = makeOcc({ id: 'a', jsTime: new Date(2026, 5, 15, 13, 0), duration: '1h' })
    const b = makeOcc({ id: 'b', jsTime: new Date(2026, 5, 15, 13, 0), duration: '1h' })
    const c = makeOcc({ id: 'c', jsTime: new Date(2026, 5, 15, 15, 0), duration: '1h' })

    const cols = computeColumns([a, b, c])
    const byId = Object.fromEntries(cols.flat().map(ev => [ev.occ.id, ev]))

    expect(byId.a!.totalCols).toBe(2)
    expect(byId.b!.totalCols).toBe(2)
    expect(byId.c!.totalCols).toBe(1)
    expect(byId.c!.colIndex).toBe(0)
  })

  it('reuses column indices across independent clusters, keeping the physical column count minimal', () => {
    const a = makeOcc({ id: 'a', jsTime: new Date(2026, 5, 15, 9, 0), duration: '1h' })
    const b = makeOcc({ id: 'b', jsTime: new Date(2026, 5, 15, 9, 0), duration: '1h' })
    const c = makeOcc({ id: 'c', jsTime: new Date(2026, 5, 15, 11, 0), duration: '1h' })
    const d = makeOcc({ id: 'd', jsTime: new Date(2026, 5, 15, 11, 0), duration: '1h' })

    const cols = computeColumns([a, b, c, d])

    expect(cols).toHaveLength(2)
    expect(cols[0]!.map(e => e.occ.id)).toEqual(['a', 'c'])
    expect(cols[1]!.map(e => e.occ.id)).toEqual(['b', 'd'])
  })
})
