import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { expandRange } from '@/model/expansion'
import { toggleDone, excludeOccurrence } from '@/model/storeOps'
import { collapseToYaml } from '@/model/collapse'
import { saveFile } from '@/model/inheritance'
import { isSeries } from '@/types'
import type { Occurrence, Roots, StoreItem } from '@/types'

// A daily recurring series that has ended up with TWO override instances on the
// same date — one completed, one not. This is the shape produced by e.g.
// rescheduling an occurrence onto a day that already carried a completed one, or
// by the "add another occurrence" scope. Historically the second override
// silently shadowed the first (only one showed) and toggling the visible one
// hit the wrong child (the toggle appeared to do nothing), because expansion
// picked a same-date winner one way (last-by-minute) while the edit path picked
// another (first-by-date). Expansion is now the single source of truth: each
// override child expands into its own occurrence carrying that child's id, and
// edits target the exact child by id.
const SERIES_DUPE = `---
title: Recurring task
participants: []
defaults:
  done: false
date: 2026-07-01
repeat:
  type: schedule
  freq: daily
instances:
  - date: 2026-07-08
    done: true
  - date: 2026-07-08
---
`

const FROM = new Date('2026-07-01T00:00:00')
const TO = new Date('2026-07-31T23:59:59')

function occsOn(items: StoreItem[], roots: Roots, date: string): Occurrence[] {
  return expandRange(items, roots, FROM, TO).filter(o => o.date === date)
}

describe('two override instances on the same date (recurring series)', () => {
  it('parses into a series plus two distinct override children on that date', () => {
    const parsed = parseToStoreItems('rec.md', SERIES_DUPE)
    const overrides = parsed.items.filter(i => !isSeries(i) && i.date === '2026-07-08')
    expect(overrides).toHaveLength(2)
    // Ids are unique via the parse-time collision guard (#2 suffix).
    expect(new Set(overrides.map(o => o.id)).size).toBe(2)
    expect(overrides.map(o => o.metadata.done).sort()).toEqual([false, true])
  })

  it('expands BOTH overrides into separate occurrences (neither is shadowed)', () => {
    const parsed = parseToStoreItems('rec.md', SERIES_DUPE)
    const roots = new Map([['rec', parsed.root]])
    const on08 = occsOn(parsed.items, roots, '2026-07-08')
    expect(on08).toHaveLength(2)
    expect(new Set(on08.map(o => o.id)).size).toBe(2)
    expect(on08.map(o => o.metadata.done).sort()).toEqual([false, true])
  })

  it('toggling the undone occurrence marks that specific instance done', () => {
    const parsed = parseToStoreItems('rec.md', SERIES_DUPE)
    const roots = new Map([['rec', parsed.root]])
    const undone = occsOn(parsed.items, roots, '2026-07-08').find(o => !o.metadata.done)!
    expect(undone).toBeTruthy()

    const next = toggleDone({ items: parsed.items, roots }, undone)
    const after = occsOn(next.items, next.roots, '2026-07-08')
    // Both instances are now done — the toggle hit the undone one, not the
    // already-completed sibling.
    expect(after).toHaveLength(2)
    expect(after.every(o => o.metadata.done === true)).toBe(true)
  })

  it('toggling one instance leaves the other untouched', () => {
    const parsed = parseToStoreItems('rec.md', SERIES_DUPE)
    const roots = new Map([['rec', parsed.root]])
    const done = occsOn(parsed.items, roots, '2026-07-08').find(o => o.metadata.done)!

    // Un-complete the done one → the other stays undone.
    const next = toggleDone({ items: parsed.items, roots }, done)
    const after = occsOn(next.items, next.roots, '2026-07-08')
    expect(after.every(o => o.metadata.done === false)).toBe(true)
  })

  it('excluding one instance removes only that one', () => {
    const parsed = parseToStoreItems('rec.md', SERIES_DUPE)
    const roots = new Map([['rec', parsed.root]])
    const undone = occsOn(parsed.items, roots, '2026-07-08').find(o => !o.metadata.done)!

    const next = excludeOccurrence({ items: parsed.items, roots }, undone)
    const after = occsOn(next.items, next.roots, '2026-07-08')
    expect(after).toHaveLength(1)
    expect(after[0].metadata.done).toBe(true)  // the completed one survives
  })

  it('round-trips: two same-date overrides survive collapse + reparse', () => {
    const parsed = parseToStoreItems('rec.md', SERIES_DUPE)
    const yaml = saveFile(collapseToYaml(parsed.items, parsed.root), parsed.root.body ?? '')
    const reparsed = parseToStoreItems('rec.md', yaml)
    const overrides = reparsed.items.filter(i => !isSeries(i) && i.date === '2026-07-08')
    expect(overrides).toHaveLength(2)
    expect(overrides.map(o => o.metadata.done).sort()).toEqual([false, true])
  })
})
