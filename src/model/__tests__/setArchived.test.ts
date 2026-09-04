/**
 * The store op behind archiving — plans/archived-entries.md PR 2.
 *
 * Persistence (what gets written to the file) and the editor/dialog wiring
 * are covered where they live, in src/editor/save.test.ts — this file is the
 * pure domain half: only the root changes, no other entry is touched, and
 * clearing the flag drops the key rather than writing `archived: false`.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { setArchived } from '@/model/storeOps'
import type { StoreData } from '@/model/storeOps'
import { dataOf, itemsOf, rootsIn } from './helpers'
import { entryKey } from '@/fileIO'
import type { Roots } from '@/types'

const VAULT = 'work'
const k = (slug: string) => entryKey(VAULT, slug)

/** Parse `yaml` into `slug`, appending to a growing snapshot — same shape as move-entry.test.ts's `add`. */
function add(data: StoreData, slug: string, yaml: string): StoreData {
  const parsed = parseToStoreItems(`${slug}.md`, yaml, VAULT)
  const roots: Roots = new Map(rootsIn(data))
  roots.set(k(slug), parsed.root)
  return dataOf([...itemsOf(data), ...parsed.items], roots)
}

const ALPHA_YAML = `---
title: Project Alpha
tags: [work]
date: "2026-05-01"
items:
  - "[[beta-notes]]"
---
`

const BETA_YAML = `---
title: Beta Notes
date: "2026-05-04"
---
`

describe('setArchived', () => {
  it('sets archived: true on the entry\'s root', () => {
    const data = add(dataOf([]), 'project-alpha', ALPHA_YAML)
    const next = setArchived(data, k('project-alpha'), true)
    expect(next.entries.get(k('project-alpha'))?.root.archived).toBe(true)
  })

  // The trap: an absent key and archived: false are not the same on save
  // (inlineFieldEmpty only treats undefined as empty), so unarchiving has to
  // drop the key entirely — never leave `false` sitting there.
  it('clearing drops the key entirely rather than setting archived: false', () => {
    let data = add(dataOf([]), 'project-alpha', ALPHA_YAML)
    data = setArchived(data, k('project-alpha'), true)

    const next = setArchived(data, k('project-alpha'), false)

    expect(next.entries.get(k('project-alpha'))?.root).not.toHaveProperty('archived')
  })

  it('touches only the target entry — its items stay the same object, and other entries are untouched', () => {
    let data = add(dataOf([]), 'project-alpha', ALPHA_YAML)
    data = add(data, 'beta-notes', BETA_YAML)
    const beforeItems = data.entries.get(k('project-alpha'))!.items
    const beforeBeta   = data.entries.get(k('beta-notes'))

    const next = setArchived(data, k('project-alpha'), true)

    expect(next.entries.get(k('project-alpha'))?.items).toBe(beforeItems)
    expect(next.entries.get(k('beta-notes'))).toBe(beforeBeta)
  })

  it('carries every other root field over verbatim — archiving is not an edit of the file\'s contents', () => {
    const data = add(dataOf([]), 'project-alpha', ALPHA_YAML)
    const next = setArchived(data, k('project-alpha'), true)
    const root = next.entries.get(k('project-alpha'))!.root
    expect(root.title).toBe('Project Alpha')
    expect(root.tags).toEqual(['work'])
    expect(root.items).toEqual(['[[beta-notes]]'])
  })

  it('is a no-op for an entry that is not there', () => {
    const data = dataOf([])
    expect(setArchived(data, k('missing'), true)).toBe(data)
  })
})
