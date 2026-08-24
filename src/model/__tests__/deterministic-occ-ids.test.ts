/**
 * Regression tests for deterministic IDs on series-generated occurrences.
 *
 * Before this fix, stableOccId minted a random UUID per logical key and
 * memoised it in a module-level cache that was cleared on every store
 * commit (setData). Any commit that forced a full re-expansion — e.g.
 * toggling a *generated* occurrence, which appends its first override and
 * changes the item count — handed out fresh UUIDs to every other generated
 * occurrence too. Because occ.id doubles as the React row key (then keyed in
 * DaySection; today it's a component of the AgendaRow key built in
 * agendaSections.ts), this unmounted and remounted every visible recurring
 * row on a single toggle.
 *
 * On top of that, upsertOverride minted its own crypto.randomUUID() for a
 * newly-created override, so even the toggled occurrence's own id changed
 * out from under it.
 *
 * Fix: stableOccId(key) is now a pure function of key (no cache to clear),
 * and upsertOverride reuses occ.id — which for a generated occurrence
 * already equals stableOccId(key) — instead of minting a new one.
 */
import { describe, it, expect } from 'vitest'
import { loadFixture, TEST_VAULT, rootsOf, itemsOf, rootsIn, dataOf } from './helpers'
import { parseToStoreItems } from '@/model/storeItems'
import { expandRange, stableOccId } from '@/model/expansion'
import { toggleDone } from '@/model/storeOps'
import { isSeries } from '@/types'
import type { Roots } from '@/types'

const FROM = new Date('2026-04-01T00:00:00')
const TO = new Date('2026-05-31T23:59:59')

function parseWeeklySeries() {
  const content = loadFixture('weekly-series')
  const { items, root } = parseToStoreItems('weekly-series.md', content, TEST_VAULT)
  const roots: Roots = rootsOf(root)
  return { items, roots }
}

describe('stableOccId', () => {
  it('is a pure function of its key (no memoisation)', () => {
    expect(stableOccId('series-1|2026-04-06|09:00')).toBe(stableOccId('series-1|2026-04-06|09:00'))
    expect(stableOccId('series-1|2026-04-06|09:00')).not.toBe(stableOccId('series-1|2026-04-13|09:00'))
  })
})

describe('generated occurrence IDs stay stable across a done-toggle', () => {
  it('a generated (non-override) occurrence keeps its id after being toggled done', () => {
    const { items, roots } = parseWeeklySeries()
    const seriesId = items.find(isSeries)!.id

    // 2026-04-20 is a Monday with no explicit override in the fixture — a
    // series-generated occurrence.
    const before = expandRange(items, roots, FROM, TO).find(o => o.date === '2026-04-20')!
    expect(before.ownerId).toBe(seriesId)
    expect(before.metadata.done).toBe(false)
    expect(before.id).toBe(stableOccId(`${seriesId}|2026-04-20|09:00`))

    const next = toggleDone(dataOf(items, roots), before)
    const after = expandRange(itemsOf(next), rootsIn(next), FROM, TO).find(o => o.date === '2026-04-20')!

    expect(after.metadata.done).toBe(true)
    expect(after.id).toBe(before.id)
    // Still exactly one occurrence on that date — the override replaced the
    // generated slot rather than duplicating it.
    expect(expandRange(itemsOf(next), rootsIn(next), FROM, TO).filter(o => o.date === '2026-04-20')).toHaveLength(1)
  })

  it('toggling one occurrence does not change the id of any other generated occurrence', () => {
    const { items, roots } = parseWeeklySeries()

    const beforeIds = new Map(
      expandRange(items, roots, FROM, TO).map(o => [o.date, o.id]),
    )

    const toggled = expandRange(items, roots, FROM, TO).find(o => o.date === '2026-04-20')!
    const next = toggleDone(dataOf(items, roots), toggled)
    const afterIds = new Map(
      expandRange(itemsOf(next), rootsIn(next), FROM, TO).map(o => [o.date, o.id]),
    )

    for (const [date, id] of beforeIds) {
      if (date === '2026-04-20') continue  // the toggled occurrence itself, checked above
      expect(afterIds.get(date)).toBe(id)
    }
  })

  it('a second toggle on the now-materialised override still preserves the id', () => {
    const { items, roots } = parseWeeklySeries()
    const first = expandRange(items, roots, FROM, TO).find(o => o.date === '2026-04-20')!
    const afterFirst = toggleDone(dataOf(items, roots), first)

    const second = expandRange(itemsOf(afterFirst), rootsIn(afterFirst), FROM, TO).find(o => o.date === '2026-04-20')!
    const afterSecond = toggleDone(afterFirst, second)
    const third = expandRange(itemsOf(afterSecond), rootsIn(afterSecond), FROM, TO).find(o => o.date === '2026-04-20')!

    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
    expect(third.metadata.done).toBe(false)  // toggled done, then undone
  })
})
