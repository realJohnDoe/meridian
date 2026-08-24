/**
 * Entry identity is `(vault, slug)`, carried as a branded `EntryKey`.
 *
 * These pin the three things that make that safe: the same slug in two vaults
 * stays two entries, an edit never loses which vault a file came from, and the
 * two runtime-only provenance fields never reach the file on disk.
 */
import { describe, it, expect } from 'vitest'
import { entryKey, keySlug, keyVaultId } from '@/fileIO'
import { parseToStoreItems } from '@/model/storeItems'
import { collapseToYaml } from '@/model/collapse'
import { applyEdit, newEntryKey, deleteByEntryKey } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { itemsOf, rootsIn } from './helpers'
import { expandRange } from '@/model/expansion'
import { roundTripLoss } from '@/model/roundTripCheck'
import type { Roots, Entries, StoreItem } from '@/types'

const WORK = 'work'
const PERSONAL = 'personal'

const NOTE_YAML = `---
title: Weekly review
tags: [ops]
date: "2026-05-04"
owner: alice
---

Body text.
`

function fields(overrides: Partial<EditFields> = {}): EditFields {
  return {
    title: 'Weekly review', tags: ['ops'], items: [], participants: [], body: '',
    tracked: false, done: false, priority: null,
    scheduled: { date: '2026-05-04', time: '' }, duration: '', repeat: null,
    ...overrides,
  }
}

/** The same file content parsed into two vaults. */
function twoVaults(): StoreData {
  const entries: Entries = new Map()
  for (const vault of [WORK, PERSONAL]) {
    entries.set(entryKey(vault, 'weekly-review'),
      parseToStoreItems('weekly-review.md', NOTE_YAML, vault))
  }
  return { entries }
}

/** The same two vaults as the flat `items`/`roots` pair `expandRange` and `collapseToYaml` take. */
function twoVaultsFlat(): { items: StoreItem[]; roots: Roots } {
  const data = twoVaults()
  return { items: itemsOf(data), roots: rootsIn(data) }
}

describe('vault-qualified entry identity', () => {
  it('keeps the same slug in two vaults as two distinct entries', () => {
    const { items, roots } = twoVaultsFlat()
    expect(roots.size).toBe(2)
    expect(new Set(items.map(i => i.entryKey)).size).toBe(2)
    // Item ids must differ too — they are compared across the whole store, and
    // both files derive theirs from the same slug, date and time.
    expect(new Set(items.map(i => i.id)).size).toBe(items.length)
  })

  it('stamps each root with the vault it was read from, and the bare slug', () => {
    const { roots } = twoVaultsFlat()
    const work = roots.get(entryKey(WORK, 'weekly-review'))!
    expect(work.vaultId).toBe(WORK)
    expect(work.fileSlug).toBe('weekly-review')
    expect(roots.get(entryKey(PERSONAL, 'weekly-review'))!.vaultId).toBe(PERSONAL)
  })

  it('hands every expanded occurrence its vault and bare slug for free', () => {
    const { items, roots } = twoVaultsFlat()
    const occs = expandRange(items, roots, new Date('2026-05-01'), new Date('2026-05-31'))
    expect(occs).toHaveLength(2)
    for (const occ of occs) {
      expect(occ.metadata.vaultId).toBe(keyVaultId(occ.entryKey))
      expect(occ.metadata.fileSlug).toBe(keySlug(occ.entryKey))
    }
  })

  it('edits one vault\'s copy without touching the other\'s', () => {
    const data = twoVaults()
    const occ = expandRange(itemsOf(data), rootsIn(data), new Date('2026-05-01'), new Date('2026-05-31'))
      .find(o => keyVaultId(o.entryKey) === WORK)!
    const next = applyEdit(data, occ, 'all', fields({ title: 'Renamed in Work' }), { vaultId: WORK })

    expect(rootsIn(next).get(entryKey(WORK, 'weekly-review'))!.title).toBe('Renamed in Work')
    expect(rootsIn(next).get(entryKey(PERSONAL, 'weekly-review'))!.title).toBe('Weekly review')
  })

  it('deletes one vault\'s copy without touching the other\'s', () => {
    const { data, affectedKeys } = deleteByEntryKey(twoVaults(), entryKey(WORK, 'weekly-review'))
    expect(rootsIn(data).has(entryKey(WORK, 'weekly-review'))).toBe(false)
    expect(rootsIn(data).has(entryKey(PERSONAL, 'weekly-review'))).toBe(true)
    expect(itemsOf(data).every(i => keyVaultId(i.entryKey) === PERSONAL)).toBe(true)
    expect(affectedKeys).toEqual([])
  })

  // Regression guard for the whole point of the carry-forward in `updateRoot`:
  // rebuilding FileMetadata from EditFields would otherwise leave the root with
  // no vault, and wikilink resolution and routing would fall back to the wrong one.
  it('an edit preserves vaultId/fileSlug on the root it rewrites', () => {
    const data = twoVaults()
    const occ = expandRange(itemsOf(data), rootsIn(data), new Date('2026-05-01'), new Date('2026-05-31'))
      .find(o => keyVaultId(o.entryKey) === PERSONAL)!
    const next = applyEdit(data, occ, 'all', fields({ title: 'Edited' }), { vaultId: PERSONAL })

    const root = rootsIn(next).get(entryKey(PERSONAL, 'weekly-review'))!
    expect(root.vaultId).toBe(PERSONAL)
    expect(root.fileSlug).toBe('weekly-review')
    // ...and everything else `updateRoot` carries forward still rides along.
    expect(root.fileConvention).toEqual(rootsIn(data).get(entryKey(PERSONAL, 'weekly-review'))!.fileConvention)
  })

  it('gives a brand-new entry the target vault, and allocates slugs per vault', () => {
    const data = twoVaults()
    // `weekly-review` is taken in both vaults, so each gets its own -2.
    expect(newEntryKey(data, WORK, 'Weekly review')).toBe(entryKey(WORK, 'weekly-review-2'))
    expect(newEntryKey(data, PERSONAL, 'Weekly review')).toBe(entryKey(PERSONAL, 'weekly-review-2'))
    // A vault with nothing in it is free to use the natural slug.
    expect(newEntryKey(data, 'archive', 'Weekly review')).toBe(entryKey('archive', 'weekly-review'))
  })

  it('never writes vaultId or fileSlug back to the file', () => {
    const { items, roots } = twoVaultsFlat()
    const key = entryKey(WORK, 'weekly-review')
    const yaml = collapseToYaml(items.filter(i => i.entryKey === key), roots.get(key))
    expect(yaml).not.toHaveProperty('vaultId')
    expect(yaml).not.toHaveProperty('fileSlug')
    // Belt and braces: nothing nested carries them either.
    expect(JSON.stringify(yaml)).not.toContain('vaultId')
    expect(JSON.stringify(yaml)).not.toContain('fileSlug')
  })

  it('round-trips a file with no loss now that roots carry provenance', () => {
    const parsed = parseToStoreItems('weekly-review.md', NOTE_YAML, WORK)
    expect(roundTripLoss('weekly-review.md', NOTE_YAML, parsed)).toEqual([])
  })

  it('re-parsing the same file into the same vault is byte-identical', () => {
    const a = parseToStoreItems('weekly-review.md', NOTE_YAML, WORK)
    const b = parseToStoreItems('weekly-review.md', NOTE_YAML, WORK)
    expect(b.items.map(i => i.id)).toEqual(a.items.map(i => i.id))
    expect(b.items.map(i => i.entryKey)).toEqual(a.items.map(i => i.entryKey))
  })
})
