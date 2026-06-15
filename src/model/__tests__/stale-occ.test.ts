/**
 * Regression tests for the stale-occurrence toggle bug — updated for Fix C.
 *
 * The original bug (documented in PR 1):
 *   After a reconcile, parseToStoreItems assigned new UUIDs to every item.
 *   DaySection's memo comparator did not check id/ownerId, so it skipped
 *   re-renders and left OccurrenceRow children with stale occurrences whose
 *   ownerId no longer matched any series in the store. Toggling such a stale
 *   occurrence was a no-op in the model, yet cacheWrite still marked the file
 *   dirty, producing a phantom commit.
 *
 * Fix A (DaySection propsAreEqual) adds id/ownerId to the memo comparator so
 * any identity change forces a re-render and children always close over live
 * occurrences.
 * Fix B (cacheWrite) short-circuits when content is unchanged, eliminating
 * phantom commits from no-op toggles.
 * Fix C (storeItems deterministic IDs, this PR) eliminates ID churn entirely:
 * re-parsing identical content now yields identical IDs, so a "stale" ownerId
 * from a prior parse still matches the freshly-parsed store.
 *
 * These tests assert the correct post-Fix-C behaviour.
 */
import { describe, it, expect } from 'vitest'
import { loadFixture, parseFixture } from './helpers'
import { parseToStoreItems } from '../storeItems'
import { toggleDone } from '../storeOps'
import { expandRange } from '../expansion'
import { isSeries } from '../../types'
import type { StoreData } from '../storeOps'
import type { Roots } from '../../types'

describe('stable IDs across re-parse (Fix C)', () => {
  it('parsing the same fixture twice produces identical series IDs', () => {
    const content = loadFixture('weekly-series')
    const parse1 = parseToStoreItems('weekly-series.md', content)
    const parse2 = parseToStoreItems('weekly-series.md', content)

    const ids1 = parse1.items.filter(isSeries).map(i => i.id)
    const ids2 = parse2.items.filter(isSeries).map(i => i.id)

    expect(ids1).toHaveLength(1)
    expect(ids2).toHaveLength(1)
    expect(ids1[0]).toBe(ids2[0])
  })

  it('override children get identical ownerIds on each parse', () => {
    const content = loadFixture('weekly-series')
    const parse1 = parseToStoreItems('weekly-series.md', content)
    const parse2 = parseToStoreItems('weekly-series.md', content)

    const ownerIds1 = parse1.items.filter(i => !isSeries(i)).map(i => (i as { ownerId?: string }).ownerId).filter(Boolean)
    const ownerIds2 = parse2.items.filter(i => !isSeries(i)).map(i => (i as { ownerId?: string }).ownerId).filter(Boolean)

    expect(ownerIds1.length).toBeGreaterThan(0)
    expect(ownerIds1).toEqual(ownerIds2)
  })
})

describe('toggle works across a simulated reconcile (Fix A + Fix C)', () => {
  it('toggling an occurrence taken from parse1 against a store rebuilt from parse2 flips done', () => {
    const content = loadFixture('weekly-series')
    const roots: Roots = new Map([['weekly-series', parseFixture('weekly-series').root]])

    // parse1: expand to get occurrences (simulates pre-reconcile closure)
    const parse1 = parseToStoreItems('weekly-series.md', content)
    const occs1 = expandRange(parse1.items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    // Pick a generated (not explicitly overridden) occurrence — 2026-04-20 is a Monday
    const occ = occs1.find(o => o.date === '2026-04-20')!
    expect(occ).toBeDefined()
    expect(occ.metadata.done).toBe(false)

    // parse2: reconcile rebuilds the store from the same content
    const parse2 = parseToStoreItems('weekly-series.md', content)
    const freshStore: StoreData = { items: parse2.items, roots }

    // With deterministic IDs, occ.ownerId matches the series in the fresh store
    const freshSeriesIds = new Set(freshStore.items.filter(isSeries).map(i => i.id))
    expect(freshSeriesIds.has(occ.ownerId!)).toBe(true)

    // toggleDone against the fresh store correctly creates an override
    const next = toggleDone(freshStore, occ)
    const nextOccs = expandRange(next.items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    const toggled = nextOccs.find(o => o.date === '2026-04-20')!
    expect(toggled).toBeDefined()
    expect(toggled.metadata.done).toBe(true)
  })
})
