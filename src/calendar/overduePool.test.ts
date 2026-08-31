import { describe, it, expect } from 'vitest'
import type { StoreItem, StoreOcc, StoreSeries, Roots, Occurrence } from '@/types'
import { computeOverduePool } from './overduePool'
import type { FilterOccs } from './agendaSections'
import { testKey, makeRootMeta, TEST_VAULT } from '@/test-utils'

const TODAY = new Date(2026, 5, 15) // a Monday
const KEY = testKey('note.md')
const ROOTS: Roots = new Map([[KEY, makeRootMeta('note.md')]])

const noFilter: FilterOccs = occs => occs

/** A standalone store occurrence — `done` present makes it a tracked task. */
function occ(id: string, date: string, over: Partial<StoreOcc> = {}): StoreOcc {
  return {
    date, time: null, source: 'explicit', entryKey: KEY, id,
    metadata: { participants: [], done: false },
    ...over,
  }
}

/** A recurring series. `metadata.done: false` is what makes it a tracked task. */
function series(id: string, date: string, over: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date, time: null, entryKey: KEY, id,
    repeat: { type: 'schedule', freq: 'weekly' },
    metadata: { participants: [], done: false },
    ...over,
  }
}

/** An override child of `ownerId` on `date`. */
function override(id: string, ownerId: string, date: string, over: Partial<StoreOcc> = {}): StoreOcc {
  return { ...occ(id, date), source: 'generated', ownerId, ...over }
}

const pool = (items: StoreItem[], filter: FilterOccs = noFilter) =>
  computeOverduePool(null, items, ROOTS, TODAY, filter).groups

describe('computeOverduePool', () => {
  it('collapses a year of an undone weekly task into one group with its count and oldest date', () => {
    // Anchored on the first Monday inside the lookback, so every weekly slot
    // from there to last Monday is overdue: 52 of them, one row.
    const groups = pool([series('s1', '2025-06-16')])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('s1')
    expect(groups[0]!.count).toBe(52)
    expect(groups[0]!.oldest).toEqual(new Date(2025, 5, 16))
    expect(groups[0]!.occ.ownerId).toBe('s1')
  })

  it('stops at yesterday — nothing dated today is overdue', () => {
    expect(pool([occ('t', '2026-06-15')])).toHaveLength(0)
    expect(pool([occ('t', '2026-06-14')])).toHaveLength(1)
  })

  it('does not resurrect a done override inside an otherwise-undone series', () => {
    // The hazard the candidate filter exists for: drop the `done: true` child
    // and its parent series generates a plain, undone-looking occurrence on
    // that date instead — a completed task reappearing as overdue.
    const withDone = pool([
      series('s1', '2026-06-01'),
      override('o1', 's1', '2026-06-08', { metadata: { participants: [], done: true } }),
    ])
    const withoutOverride = pool([series('s1', '2026-06-01')])

    expect(withoutOverride[0]!.count).toBe(2)  // Jun 1 and Jun 8
    expect(withDone[0]!.count).toBe(1)         // Jun 8 is done, so only Jun 1
    expect(withDone[0]!.oldest).toEqual(new Date(2026, 5, 1))
  })

  it('produces no occurrence for an excluded date inside an undone series', () => {
    const groups = pool([
      series('s1', '2026-06-01'),
      override('o1', 's1', '2026-06-08', { excluded: true }),
    ])

    expect(groups[0]!.count).toBe(1)
    expect(groups[0]!.oldest).toEqual(new Date(2026, 5, 1))
  })

  it('keeps a series whose own root is done but which has an undone override', () => {
    // seriesMeta forces a tracked series root to `done: false`, so a `done: true`
    // root only reaches us from hand-edited YAML — but an undone override of one
    // is still genuinely overdue, and dropping the series would lose it silently.
    const groups = pool([
      series('s1', '2026-06-01', { metadata: { participants: [], done: true } }),
      override('o1', 's1', '2026-06-08', { metadata: { participants: [], done: false } }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.count).toBe(1)
    expect(groups[0]!.oldest).toEqual(new Date(2026, 5, 8))
  })

  it('keeps two series in one file as two groups', () => {
    const groups = pool([series('s1', '2026-06-01'), series('s2', '2026-06-02')])

    expect(groups.map(g => g.key).sort()).toEqual(['s1', 's2'])
    expect(groups.every(g => g.count === 2)).toBe(true)
  })

  it('groups a standalone dated task alone, under its own id', () => {
    const groups = pool([occ('a', '2026-06-10'), occ('b', '2026-06-11')])

    expect(groups.map(g => g.key)).toEqual(['a', 'b'])
    expect(groups.every(g => g.count === 1)).toBe(true)
  })

  it('ignores done tasks, events and notes', () => {
    const groups = pool([
      occ('done', '2026-06-10', { metadata: { participants: [], done: true } }),
      occ('event', '2026-06-10', { metadata: { participants: [] } }),   // no `done` → not tracked
      occ('open', '2026-06-10'),
    ])

    expect(groups.map(g => g.key)).toEqual(['open'])
  })

  it('collapses every covered day of an undone multiday task into one group', () => {
    const groups = pool([occ('trip', '2026-06-10', { metadata: { participants: [], done: false, duration: '3d' } })])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.count).toBe(3)
    expect(groups[0]!.oldest).toEqual(new Date(2026, 5, 10))
  })

  it('applies the calendar filter', () => {
    const items = [
      occ('mine', '2026-06-10', { metadata: { participants: ['alice'], done: false } }),
      occ('theirs', '2026-06-10', { metadata: { participants: ['bob'], done: false } }),
    ]
    const onlyAlice: FilterOccs = occs => occs.filter(o => o.metadata.participants.includes('alice'))

    expect(pool(items).map(g => g.key)).toEqual(['mine', 'theirs'])
    expect(pool(items, onlyAlice).map(g => g.key)).toEqual(['mine'])
  })

  it('orders groups by priority, then by oldest instant', () => {
    const groups = pool([
      occ('low', '2026-06-01', { metadata: { participants: [], done: false, priority: 'low' } }),
      occ('high-late', '2026-06-12', { metadata: { participants: [], done: false, priority: 'high' } }),
      occ('high-early', '2026-06-10', { metadata: { participants: [], done: false, priority: 'high' } }),
    ])

    expect(groups.map(g => g.key)).toEqual(['high-early', 'high-late', 'low'])
  })

  it('reaches back exactly one year and no further', () => {
    expect(pool([occ('edge', '2025-06-15')])).toHaveLength(1)
    expect(pool([occ('older', '2025-06-14')])).toHaveLength(0)
  })

  it('returns the identical cache when every input keeps its identity', () => {
    const items = [occ('a', '2026-06-10')]
    const first = computeOverduePool(null, items, ROOTS, TODAY, noFilter)
    const second = computeOverduePool(first, items, ROOTS, new Date(2026, 5, 15), noFilter)

    expect(second).toBe(first)
  })

  it('recomputes when items change', () => {
    const items = [occ('a', '2026-06-10')]
    const first = computeOverduePool(null, items, ROOTS, TODAY, noFilter)
    const second = computeOverduePool(first, [...items, occ('b', '2026-06-11')], ROOTS, TODAY, noFilter)

    expect(second).not.toBe(first)
    expect(second.groups.map(g => g.key)).toEqual(['a', 'b'])
  })

  it('carries the file-level title onto the representative occurrence', () => {
    const roots: Roots = new Map([[KEY, makeRootMeta('note.md', { title: 'Pay the invoice' })]])
    const { groups } = computeOverduePool(null, [occ('a', '2026-06-10')], roots, TODAY, noFilter)

    const rep: Occurrence = groups[0]!.occ
    expect(rep.metadata.title).toBe('Pay the invoice')
    expect(rep.metadata.vaultId).toBe(TEST_VAULT)
  })
})
