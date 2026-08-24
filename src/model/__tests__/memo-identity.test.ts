/**
 * Reference-identity guarantees storeOps must keep across an edit.
 *
 * Several caches downstream memoize on object identity rather than value
 * equality — `setData` reuses the backlink index when `roots === prevRoots`,
 * `fileOccurrenceMap` and `computeExpansionCache` overlay only items that fail
 * `item === prev.items[i]` (see the "Why the split is the problem" and PR 3's
 * hazard note in plans/entry-aggregate.md). A helper that rebuilds a fresh
 * array or Map on every call satisfies every type and every value-equality
 * assertion while turning all of those into full rebuilds on every keystroke.
 *
 * `toEqual` cannot catch that regression — it passes against a full rebuild
 * just as happily as against a reused reference. These assertions are
 * `toBe`/reference checks on purpose.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { applyEdit, toggleDone, excludeOccurrence } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { expandRange } from '@/model/expansion'
import { entryKey } from '@/fileIO'
import type { Roots, StoreItem, Occurrence } from '@/types'
import { TEST_VAULT, NEW_TARGET } from './helpers'

const YAML_ALPHA = `---
title: Alpha
date: "2026-05-01"
---
`
const YAML_BETA = `---
title: Beta
done: false
date: "2026-05-02"
---
`
const YAML_GAMMA = `---
title: Gamma
date: "2026-05-03"
---
`

/** Parse `yaml` into a slug, appending to a growing snapshot — same shape as move-entry.test.ts's `add`. */
function add(data: StoreData, slug: string, yaml: string): StoreData {
  const parsed = parseToStoreItems(`${slug}.md`, yaml, TEST_VAULT)
  const roots: Roots = new Map(data.roots)
  roots.set(entryKey(TEST_VAULT, slug), parsed.root)
  return { items: [...data.items, ...parsed.items], roots }
}

function snapshot(): StoreData {
  let d: StoreData = { items: [], roots: new Map() }
  d = add(d, 'alpha', YAML_ALPHA)
  d = add(d, 'beta', YAML_BETA)
  d = add(d, 'gamma', YAML_GAMMA)
  return d
}

function occOn(items: StoreItem[], roots: Roots, dateISO: string): Occurrence {
  const occs = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
  const occ = occs.find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO}`)
  return occ
}

function editFields(occ: Occurrence, over: Partial<EditFields> = {}): EditFields {
  const m = occ.metadata
  return {
    title: m.title, tags: m.tags, items: m.items,
    participants: m.participants, body: m.body ?? '',
    tracked: m.done !== undefined, done: m.done ?? false,
    priority: m.priority ?? null,
    scheduled: occ.date ? { date: occ.date, time: occ.time ?? '' } : null,
    duration: m.duration ?? '', repeat: null,
    ...over,
  }
}

describe('memo identity', () => {
  it('an edit to one entry leaves every other entry\'s root and item references untouched', () => {
    const before = snapshot()
    const occ = occOn(before.items, before.roots, '2026-05-01')
    const after = applyEdit(before, occ, 'single', editFields(occ, { priority: 'high' }), NEW_TARGET)

    const untouchedKeys = [...before.roots.keys()].filter(k => k !== occ.entryKey)
    expect(untouchedKeys).toHaveLength(2)
    for (const key of untouchedKeys) {
      expect(after.roots.get(key)).toBe(before.roots.get(key))
    }

    const otherBefore = before.items.filter(i => i.entryKey !== occ.entryKey)
    const otherAfter = after.items.filter(i => i.entryKey !== occ.entryKey)
    expect(otherAfter).toHaveLength(otherBefore.length)
    otherBefore.forEach((item, i) => expect(otherAfter[i]).toBe(item))
  })

  it.each(['toggleDone', 'excludeOccurrence'] as const)(
    'leaves roots reference-identical when %s changes only an occurrence, not a file-level field',
    (opName) => {
      const before = snapshot()
      const occ = occOn(before.items, before.roots, '2026-05-02')
      const op = opName === 'toggleDone' ? toggleDone : excludeOccurrence
      const after = op(before, occ)
      expect(after.roots).toBe(before.roots)
    },
  )
})
