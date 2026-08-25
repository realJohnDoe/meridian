/**
 * Regression tests for deterministic IDs in parseToStoreItems.
 *
 * Before this fix, effectiveNodeToStoreItems called crypto.randomUUID() for
 * every item on every parse. Each reconcile (60s tick, tab-focus, online)
 * re-parsed all cached files and issued fresh UUIDs, causing:
 *   - DaySection (since replaced by row-level virtualization) to receive new
 *     items that appeared identical by content but had different ids — when
 *     the memo comparator didn't check identity, the component skipped
 *     re-render and children kept stale pre-reconcile occs.
 *   - stableOccId's cache to grow unboundedly (new series.id → new cache entry
 *     each reconcile, old entries never evicted).
 *
 * Fix: IDs are now derived from intrinsic keys (entryKey + anchor date/time),
 * so re-parsing identical content always yields identical IDs.
 */
import { describe, it, expect } from 'vitest'
import { loadFixture, fixtureNames, TEST_VAULT, keyOf } from './helpers'
import { parseToStoreItems } from '@/model/storeItems'
import { isSeries } from '@/types'

/** Extract all IDs from a parse result in a stable order. */
function allIds(items: ReturnType<typeof parseToStoreItems>['items']): string[] {
  return items.map(i => i.id)
}

/** Extract all ownerIds from override children. */
function ownerIds(items: ReturnType<typeof parseToStoreItems>['items']): (string | undefined)[] {
  return items
    .filter(i => !isSeries(i))
    .map(i => (i as { ownerId?: string }).ownerId)
}

describe('deterministic IDs — re-parse of identical content', () => {
  it.each(fixtureNames())('%s: parsing twice yields identical IDs', (name) => {
    const content = loadFixture(name)
    const parse1 = parseToStoreItems(`${name}.md`, content, TEST_VAULT)
    const parse2 = parseToStoreItems(`${name}.md`, content, TEST_VAULT)
    expect(allIds(parse2.items)).toEqual(allIds(parse1.items))
  })

  it.each(fixtureNames())('%s: parsing twice yields identical ownerIds', (name) => {
    const content = loadFixture(name)
    const parse1 = parseToStoreItems(`${name}.md`, content, TEST_VAULT)
    const parse2 = parseToStoreItems(`${name}.md`, content, TEST_VAULT)
    expect(ownerIds(parse2.items)).toEqual(ownerIds(parse1.items))
  })
})

describe('deterministic ID format', () => {
  it('series ID encodes entryKey and anchor date/time', () => {
    const content = loadFixture('weekly-series')
    const { items } = parseToStoreItems('weekly-series.md', content, TEST_VAULT)
    const series = items.find(isSeries)!
    // The vault half rides along: two vaults may each hold a `weekly-series.md`,
    // and item ids are compared across the whole (now multi-vault) store.
    expect(series.id).toBe(`${keyOf('weekly-series')}|series|2026-04-06|09:00`)
  })

  it('override child ID encodes seriesId and child date', () => {
    const content = loadFixture('weekly-series')
    const { items } = parseToStoreItems('weekly-series.md', content, TEST_VAULT)
    const seriesId = items.find(isSeries)!.id
    const overrides = items.filter(i => !isSeries(i) && (i as { ownerId?: string }).ownerId)
    // weekly-series has two explicit overrides (2026-04-13 and 2026-04-14, no time)
    expect(overrides[0]!.id).toBe(`${seriesId}|inst|2026-04-13|`)
    expect(overrides[1]!.id).toBe(`${seriesId}|inst|2026-04-14|`)
  })

  it('standalone ID encodes entryKey and date', () => {
    const content = loadFixture('single-event')
    const { items } = parseToStoreItems('single-event.md', content, TEST_VAULT)
    expect(items).toHaveLength(1)
    // ID starts with the entryKey|occ| prefix
    expect(items[0].id.startsWith(`${keyOf('single-event')}|occ|`)).toBe(true)
  })

  it('multi-series fixture: two series get distinct IDs', () => {
    const content = loadFixture('mixed-series-standalones')
    const { items } = parseToStoreItems('mixed-series-standalones.md', content, TEST_VAULT)
    const seriesItems = items.filter(isSeries)
    expect(seriesItems.length).toBeGreaterThanOrEqual(2)
    const ids = seriesItems.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)  // all distinct
  })

  it('collision guard: duplicate-date items in same file get #2 suffix', () => {
    // Build a minimal fixture with two standalones on the same date
    const yaml = `---\ninstances:\n  - date: 2026-01-01\n  - date: 2026-01-01\n---\n`
    const { items } = parseToStoreItems('dup.md', yaml, TEST_VAULT)
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe(`${keyOf('dup')}|occ|2026-01-01|`)
    expect(items[1]!.id).toBe(`${keyOf('dup')}|occ|2026-01-01|#2`)
  })
})
