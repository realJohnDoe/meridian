/**
 * The domain half of a cross-vault move: re-keying an entry, the free-slug
 * allocation that keeps it from landing on a file the target vault already
 * has, and the link breakage the confirm dialog reports.
 *
 * The durable half — the target's content written before the source's
 * tombstone — lives in `storage/__tests__/moveEntry.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { freeEntryKey, moveEntryKey, moveLinkBreakage } from '@/model/storeOps'
import type { StoreData } from '@/model/storeOps'
import { dataOf, itemsOf, rootsIn } from './helpers'
import { entryKey, keySlug } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { Roots, StoreItem } from '@/types'
import { isSeries } from '@/types'

const WORK = 'work'
const HOME = 'home'

const k = (vaultId: string, slug: string): EntryKey => entryKey(vaultId, slug)

/** Parse `yaml` into `vaultId` under `slug`, appending to a growing snapshot. */
function add(data: StoreData, vaultId: string, slug: string, yaml: string): StoreData {
  const parsed = parseToStoreItems(`${slug}.md`, yaml, vaultId)
  const roots: Roots = new Map(rootsIn(data))
  roots.set(k(vaultId, slug), parsed.root)
  return dataOf([...itemsOf(data), ...parsed.items], roots)
}

const EMPTY: StoreData = dataOf([])

const MEETING_YAML = `---
title: Meeting notes
tags: [work]
date: "2026-05-01"
items:
  - "[[project-alpha]]"
owner: alice
---

Follow up on [[project-alpha]] and [[beta-notes]] before Friday.
`

const PLAIN_YAML = `---
title: Project Alpha
date: "2026-05-04"
---
`

const LINKS_BACK_YAML = `---
title: Weekly review
date: "2026-05-08"
items:
  - "[[meeting-notes]]"
---
`

/** Container-rooted: the unknown key sits on the file root, not on an item. */
const CONTAINER_YAML = `---
title: Trip planning
owner: alice
instances:
  - date: "2026-05-01"
  - date: "2026-05-02"
---

Book the train.
`

function snapshot(): StoreData {
  let d = add(EMPTY, WORK, 'meeting-notes', MEETING_YAML)
  d = add(d, WORK, 'project-alpha', PLAIN_YAML)
  d = add(d, WORK, 'beta-notes', PLAIN_YAML)
  d = add(d, WORK, 'weekly-review', LINKS_BACK_YAML)
  return d
}

// ── freeEntryKey ─────────────────────────────────────────────────────────────

describe('freeEntryKey', () => {
  it('keeps the slug when the target vault has nothing on it', () => {
    expect(freeEntryKey(snapshot(), HOME, 'meeting-notes')).toBe(k(HOME, 'meeting-notes'))
  })

  it('uniquifies against a file the target vault already has', () => {
    const d = add(snapshot(), HOME, 'meeting-notes', PLAIN_YAML)
    expect(freeEntryKey(d, HOME, 'meeting-notes')).toBe(k(HOME, 'meeting-notes-2'))
  })

  it('keeps counting past an occupied -2', () => {
    let d = add(snapshot(), HOME, 'meeting-notes', PLAIN_YAML)
    d = add(d, HOME, 'meeting-notes-2', PLAIN_YAML)
    expect(freeEntryKey(d, HOME, 'meeting-notes')).toBe(k(HOME, 'meeting-notes-3'))
  })

  it('treats a file that failed to parse as occupying its slug', () => {
    const d = { ...snapshot(), unreadableKeys: new Set([k(HOME, 'meeting-notes')]) }
    expect(freeEntryKey(d, HOME, 'meeting-notes')).toBe(k(HOME, 'meeting-notes-2'))
  })

  it('collides per vault, not globally — the source vault\'s copy is irrelevant', () => {
    // `meeting-notes` exists in WORK; moving it to HOME must not uniquify.
    expect(keySlug(freeEntryKey(snapshot(), HOME, 'meeting-notes'))).toBe('meeting-notes')
  })
})

// ── moveEntryKey ─────────────────────────────────────────────────────────────

describe('moveEntryKey', () => {
  const from = k(WORK, 'meeting-notes')
  const to   = k(HOME, 'meeting-notes')

  it('re-keys every item of the entry and nothing else', () => {
    const before = snapshot()
    const after  = moveEntryKey(before, from, to)

    expect(itemsOf(after).filter(i => i.entryKey === from)).toHaveLength(0)
    expect(itemsOf(after).filter(i => i.entryKey === to))
      .toHaveLength(itemsOf(before).filter((i: StoreItem) => i.entryKey === from).length)
    // Every other file's items keep their keys.
    expect(itemsOf(after).filter(i => i.entryKey === k(WORK, 'weekly-review'))).toHaveLength(
      itemsOf(before).filter(i => i.entryKey === k(WORK, 'weekly-review')).length,
    )
  })

  it('moves the root to the new key and re-derives its provenance', () => {
    const after = moveEntryKey(snapshot(), from, to)
    expect(rootsIn(after).has(from)).toBe(false)
    const root = rootsIn(after).get(to)
    expect(root?.vaultId).toBe(HOME)
    expect(root?.fileSlug).toBe('meeting-notes')
  })

  it('carries the root\'s body, title and items over verbatim', () => {
    const before = snapshot()
    const after  = moveEntryKey(before, from, to)
    const prev   = rootsIn(before).get(from)
    const next   = rootsIn(after).get(to)
    expect(next?.body).toBe(prev?.body)
    expect(next?.title).toBe('Meeting notes')
    expect(next?.items).toEqual(prev?.items)
  })

  // A move is not an edit, so the bag of frontmatter keys the model has no name
  // for must survive it untouched — the root owns that bag on a container-rooted
  // file, which is where a rebuild would drop it.
  it('carries a container root\'s unknown keys over', () => {
    const d      = add(EMPTY, WORK, 'trip', CONTAINER_YAML)
    const after  = moveEntryKey(d, k(WORK, 'trip'), k(HOME, 'trip'))
    expect(rootsIn(after).get(k(HOME, 'trip'))?.extra).toEqual(rootsIn(d).get(k(WORK, 'trip'))?.extra)
    expect(rootsIn(after).get(k(HOME, 'trip'))?.extra?.owner).toBe('alice')
  })

  it('lands on the allocated slug when the target vault already owns the old one', () => {
    const d      = add(snapshot(), HOME, 'meeting-notes', PLAIN_YAML)
    const toKey  = freeEntryKey(d, HOME, 'meeting-notes')
    const after  = moveEntryKey(d, from, toKey)
    // The target vault's own file is untouched — the move sat down beside it.
    expect(rootsIn(after).get(k(HOME, 'meeting-notes'))?.title).toBe('Project Alpha')
    expect(rootsIn(after).get(k(HOME, 'meeting-notes-2'))?.title).toBe('Meeting notes')
  })

  it('leaves the entries that linked to it alone — the links break, they are not rewritten', () => {
    const after = moveEntryKey(snapshot(), from, to)
    expect(rootsIn(after).get(k(WORK, 'weekly-review'))?.items).toEqual(['[[meeting-notes]]'])
  })

  it('is a no-op on items and roots for an entry that is not there', () => {
    const before = snapshot()
    const after  = moveEntryKey(before, k(WORK, 'nothing-here'), k(HOME, 'nothing-here'))
    expect(rootsIn(after).size).toBe(rootsIn(before).size)
    expect(itemsOf(after)).toHaveLength(itemsOf(before).length)
  })

  it('keeps series items intact apart from their key', () => {
    const d = add(EMPTY, WORK, 'standup', `---
title: Standup
date: "2026-04-06"
repeat:
  type: schedule
  freq: weekly
---
`)
    const after = moveEntryKey(d, k(WORK, 'standup'), k(HOME, 'standup'))
    const series = itemsOf(after).find(isSeries)
    expect(series?.entryKey).toBe(k(HOME, 'standup'))
    expect(series?.repeat).toEqual(itemsOf(d).find(isSeries)?.repeat)
  })
})

// ── moveLinkBreakage ─────────────────────────────────────────────────────────

describe('moveLinkBreakage', () => {
  const from = k(WORK, 'meeting-notes')

  it('counts the entries in the source vault that link here', () => {
    const { inbound } = moveLinkBreakage(snapshot(), from, HOME)
    expect(inbound).toEqual([k(WORK, 'weekly-review')])
  })

  it('counts the entry\'s own links — from its items list and its body', () => {
    const { outbound } = moveLinkBreakage(snapshot(), from, HOME)
    expect([...outbound].sort()).toEqual(['beta-notes', 'project-alpha'])
  })

  it('does not count a link the target vault can resolve too', () => {
    const d = add(snapshot(), HOME, 'project-alpha', PLAIN_YAML)
    const { outbound } = moveLinkBreakage(d, from, HOME)
    expect(outbound).toEqual(['beta-notes'])
  })

  it('does not count a link that already resolves to nothing', () => {
    const d = add(EMPTY, WORK, 'orphan', `---
title: Orphan
items:
  - "[[nowhere]]"
---
`)
    expect(moveLinkBreakage(d, k(WORK, 'orphan'), HOME).outbound).toEqual([])
  })

  it('does not count a self-link — it follows the entry into the new vault', () => {
    const d = add(EMPTY, WORK, 'selfie', `---
title: Selfie
items:
  - "[[selfie]]"
---
`)
    expect(moveLinkBreakage(d, k(WORK, 'selfie'), HOME).outbound).toEqual([])
  })

  it('never reaches across a vault boundary for inbound links', () => {
    // A same-slug file in another vault linking to `[[meeting-notes]]` means
    // *its own* vault's meeting-notes, so it is not affected by this move.
    const d = add(snapshot(), HOME, 'weekly-review', LINKS_BACK_YAML)
    const { inbound } = moveLinkBreakage(d, from, HOME)
    expect(inbound).toEqual([k(WORK, 'weekly-review')])
  })

  it('reports nothing for an entry nobody links to and that links nowhere', () => {
    const d = add(EMPTY, WORK, 'lonely', PLAIN_YAML)
    expect(moveLinkBreakage(d, k(WORK, 'lonely'), HOME)).toEqual({ inbound: [], outbound: [] })
  })
})
