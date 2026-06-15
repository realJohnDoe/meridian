/**
 * Regression tests for the stale-occurrence toggle bug.
 *
 * After a reconcile, parseToStoreItems assigns new UUIDs to every item
 * (ID churn). If DaySection's memo comparator doesn't check id/ownerId,
 * it considers the re-rendered props equal and skips the re-render, leaving
 * OccurrenceRow children with pre-reconcile occurrences whose id/ownerId no
 * longer exist in the store. Toggling such a stale occurrence is a no-op.
 *
 * Fix A (DaySection propsAreEqual) ensures id/ownerId changes trigger a
 * re-render so children always close over live occurrences.
 * Fix B (cacheWrite) ensures a no-op toggle produces no phantom commit.
 *
 * These tests cover the model-layer side of the bug: that re-parsing the
 * same content yields different IDs, and that toggling a stale occurrence
 * (one whose ownerId no longer matches any series in the store) leaves the
 * store unchanged.
 */
import { describe, it, expect } from 'vitest'
import { loadFixture, parseFixture } from './helpers'
import { parseToStoreItems } from '../storeItems'
import { toggleDone } from '../storeOps'
import { expandRange } from '../expansion'
import { isSeries } from '../../types'
import type { StoreData } from '../storeOps'
import type { Roots } from '../../types'

describe('ID churn on re-parse', () => {
  it('parsing the same fixture twice produces different series IDs', () => {
    const content = loadFixture('weekly-series')
    const parse1 = parseToStoreItems('weekly-series.md', content)
    const parse2 = parseToStoreItems('weekly-series.md', content)

    const ids1 = parse1.items.filter(isSeries).map(i => i.id)
    const ids2 = parse2.items.filter(isSeries).map(i => i.id)

    expect(ids1).toHaveLength(1)
    expect(ids2).toHaveLength(1)
    // Same file, same content — but different UUIDs each time
    expect(ids1[0]).not.toBe(ids2[0])
  })

  it('override children get a new ownerId on each parse', () => {
    const content = loadFixture('weekly-series')
    const parse1 = parseToStoreItems('weekly-series.md', content)
    const parse2 = parseToStoreItems('weekly-series.md', content)

    const ownerIds1 = parse1.items.filter(i => !isSeries(i)).map(i => (i as { ownerId?: string }).ownerId).filter(Boolean)
    const ownerIds2 = parse2.items.filter(i => !isSeries(i)).map(i => (i as { ownerId?: string }).ownerId).filter(Boolean)

    expect(ownerIds1.length).toBeGreaterThan(0)
    // Each parse produces fresh UUIDs — ownerIds point to the new series ID
    expect(ownerIds1).not.toEqual(ownerIds2)
  })
})

describe('toggle with stale occurrence is a no-op in the store', () => {
  it('toggling a generated occurrence whose ownerId is from a prior parse leaves done unchanged', () => {
    const content = loadFixture('weekly-series')
    const roots: Roots = new Map([['weekly-series', parseFixture('weekly-series').root]])

    // parse1: expand to get occurrences (simulates pre-reconcile closure)
    const parse1 = parseToStoreItems('weekly-series.md', content)
    const occs1 = expandRange(parse1.items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    // Pick a generated (not explicitly overridden) occurrence — 2026-04-20 is a Monday
    const staleOcc = occs1.find(o => o.date === '2026-04-20')!
    expect(staleOcc).toBeDefined()
    expect(staleOcc.metadata.done).toBe(false)

    // parse2: reconcile produces fresh IDs (simulates post-reconcile store)
    const parse2 = parseToStoreItems('weekly-series.md', content)
    const freshStore: StoreData = { items: parse2.items, roots }

    // The stale occ's ownerId no longer matches any series in freshStore
    const freshSeriesIds = new Set(freshStore.items.filter(isSeries).map(i => i.id))
    expect(freshSeriesIds.has(staleOcc.ownerId!)).toBe(false)

    // toggleDone with a stale ownerId creates an orphaned override —
    // expansion never surfaces it, so done stays false
    const next = toggleDone(freshStore, staleOcc)
    const nextOccs = expandRange(next.items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    const toggledOcc = nextOccs.find(o => o.date === '2026-04-20')!
    expect(toggledOcc).toBeDefined()
    expect(toggledOcc.metadata.done).toBe(false)  // no-op: stale ownerId → orphaned override
  })
})
