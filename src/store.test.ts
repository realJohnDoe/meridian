/**
 * The store's derived views, and the reference identity the caches downstream
 * depend on.
 *
 * `entries` is the store's single stored form; `items` and `roots` are derived
 * from it once per commit. Four independent caches memoize on the identity of
 * those two containers rather than on their contents — `setData` reuses the
 * backlink index when `roots === prevRoots`, `fileOccurrenceMap` memoizes on
 * `items`/`roots` identity, `computeExpansionCache` overlays only items failing
 * `item === prev.items[i]`, and `useAgendaSections` caches on top of that. A
 * derivation that rebuilt a fresh array or Map every time would satisfy every
 * type and every value-equality assertion while turning all four into full
 * rebuilds on every keystroke.
 *
 * The storeOps half of the contract — that an edit to one entry leaves every
 * other entry's object untouched — is pinned in
 * `model/__tests__/memo-identity.test.ts`. This is the half that turns those
 * object-level guarantees into container-level ones.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems, toggleDone, excludeOccurrence, expandRange } from '@/model'
import type { StoreData } from '@/model'
import { entryKey } from '@/fileIO'
import type { Entries, Occurrence, Roots, StoreItem } from '@/types'
import { deriveViews } from '@/store'

const VAULT = 'test-vault'

const YAML_ALPHA = `---
title: Alpha
date: "2026-05-01"
---
`
// Two occurrences on purpose: excluding one of them must leave the entry
// standing, so the assertions below are about the root being untouched rather
// than about the entry disappearing (removing the last occurrence removes the
// entry — see `excludeOccurrence`).
const YAML_BETA = `---
title: Beta
done: false
instances:
  - date: "2026-05-02"
  - date: "2026-05-09"
---
`

function snapshot(): StoreData {
  const entries: Entries = new Map()
  for (const [slug, yaml] of [['alpha', YAML_ALPHA], ['beta', YAML_BETA]] as const) {
    entries.set(entryKey(VAULT, slug), parseToStoreItems(`${slug}.md`, yaml, VAULT))
  }
  return { entries }
}

function occOn(items: StoreItem[], roots: Roots, dateISO: string): Occurrence {
  const occ = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    .find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO}`)
  return occ
}

describe('deriveViews', () => {
  it('reuses both containers when nothing changed', () => {
    const { entries } = snapshot()
    const first  = deriveViews(entries, null)
    const second = deriveViews(entries, first)
    expect(second.items).toBe(first.items)
    expect(second.roots).toBe(first.roots)
  })

  it.each(['toggleDone', 'excludeOccurrence'] as const)(
    'keeps roots reference-stable across %s, which changes no file-level field',
    (opName) => {
      const before = snapshot()
      const prev = deriveViews(before.entries, null)
      const occ = occOn(prev.items, prev.roots, '2026-05-02')
      const op = opName === 'toggleDone' ? toggleDone : excludeOccurrence
      const after = op(before, occ)

      const next = deriveViews(after.entries, prev)
      expect(next.roots).toBe(prev.roots)
      // …and `items` genuinely did move, so this is not passing by the
      // derivation being inert.
      expect(next.items).not.toBe(prev.items)
    },
  )

  it('gives an untouched entry back the very same item and root objects', () => {
    const before = snapshot()
    const prev = deriveViews(before.entries, null)
    const occ = occOn(prev.items, prev.roots, '2026-05-02')
    const after = toggleDone(before, occ)
    const next = deriveViews(after.entries, prev)

    const alphaKey = entryKey(VAULT, 'alpha')
    expect(next.roots.get(alphaKey)).toBe(prev.roots.get(alphaKey))
    const alphaItems = next.items.filter(i => i.entryKey === alphaKey)
    const alphaBefore = prev.items.filter(i => i.entryKey === alphaKey)
    expect(alphaItems).toHaveLength(alphaBefore.length)
    alphaBefore.forEach((item, i) => expect(alphaItems[i]).toBe(item))
  })
})
