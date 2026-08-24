/**
 * An entry whose root survives with no occurrences.
 *
 * Reported symptom: an entry created from the mobile search overlay showed up
 * in the search results as an invisible gap — a reserved row that drew nothing
 * — and was gone entirely after a restart. Both halves come from the same
 * store state: a root with zero items. Nothing renders such an entry, and the
 * write path used to refuse to persist it, so it lived in memory only.
 *
 * **That state is now unrepresentable.** `Entry['items']` is a non-empty tuple,
 * so `{ root, items: [] }` does not compile — the store cannot hold the thing
 * these tests were written to survive. What is pinned here is therefore no
 * longer "the state is survivable" but the two things that keep it from
 * arising in the first place, which is where the guarantee moved rather than
 * where it went away:
 *
 *  - an editor holding an occurrence whose entry has vanished rebuilds the
 *    entry whole, root and occurrence together, rather than writing a root
 *    that matches no item;
 *  - a file on disk that carries only file-level fields parses into one undated
 *    occurrence, so the entry arrives whole and its `title`/`tags`/`items:`
 *    survive the round trip. This is the parse boundary's totality — the same
 *    clause of `nodeIsItem` that makes the non-empty tuple safe to assert.
 */
import { describe, it, expect } from 'vitest'
import { rootsOf, TEST_VAULT, NEW_TARGET, keyOf, serialize, frontmatterOf, dataOf, itemsOf, rootsIn } from './helpers'
import { applyEdit } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { parseToStoreItems } from '@/model/storeItems'
import { isSeries, isStandaloneOcc } from '@/types'
import type { FileMetadata, Occurrence } from '@/types'

const root: FileMetadata = {
  title: 'handy', tags: ['errands'], items: [], body: 'Compare the plans.',
  vaultId: TEST_VAULT, fileSlug: 'handy',
}

/** The entry as the editor still holds it, after its items have gone. */
const occ: Occurrence = {
  date: '2026-08-18', time: null, source: 'explicit', entryKey: keyOf('handy'), id: 'occ-1',
  metadata: { participants: [], title: 'handy', tags: ['errands'], items: [], done: false, vaultId: TEST_VAULT, fileSlug: 'handy' },
}

const fields: EditFields = {
  title: 'handy', tags: ['errands'], items: [], participants: [], body: 'Compare the plans.',
  tracked: true, done: false, priority: 'high',
  scheduled: { date: '2026-08-18', time: '' }, duration: '', repeat: null,
}

/**
 * Store state where the entry is gone but the editor is still holding one of
 * its occurrences. `dataOf` drops a root with no items on purpose: there is no
 * `Entry` for it to become, so "the entry's items are gone" and "the entry is
 * gone" are now the same state — which is the point.
 */
function occurrencelessData(): StoreData {
  return dataOf([], rootsOf(root))
}

describe('applyEdit on an entry that is no longer in the store', () => {
  it.each(['all', 'single', 'future', 'add'] as const)(
    'rebuilds the occurrence instead of updating the root alone (scope %s)',
    scope => {
      const next = applyEdit(occurrencelessData(), occ, scope, fields, NEW_TARGET)

      const items = itemsOf(next).filter(i => i.entryKey === keyOf('handy'))
      expect(items).toHaveLength(1)
      expect(rootsIn(next).get(keyOf('handy'))?.title).toBe('handy')
      expect(items[0]!.metadata.priority).toBe('high')
    },
  )

  it('upserts on the next save rather than appending a second occurrence', () => {
    // The rebuilt item keeps the occurrence's own id, so the editor's very next
    // commit — a debounced autosave, the flush on close — lands on it through
    // the ordinary scope path instead of rebuilding again.
    const first  = applyEdit(occurrencelessData(), occ, 'all', fields, NEW_TARGET)
    const second = applyEdit(first, occ, 'all', { ...fields, priority: 'low' }, NEW_TARGET)

    const items = itemsOf(second).filter(i => i.entryKey === keyOf('handy'))
    expect(items).toHaveLength(1)
    expect(items[0]!.metadata.priority).toBe('low')
  })

  it('rebuilds a series when the edit carries a repeat', () => {
    const next = applyEdit(
      occurrencelessData(), occ, 'all',
      { ...fields, repeat: { type: 'schedule', freq: 'weekly' } },
      NEW_TARGET,
    )

    const items = itemsOf(next).filter(i => i.entryKey === keyOf('handy'))
    expect(items).toHaveLength(1)
    expect(isSeries(items[0]!)).toBe(true)
  })

  it('leaves an entry that still has items on its ordinary scope path', () => {
    // The guard must be narrow: it fires only when the entry has NO items at
    // all, never for a series occurrence whose siblings are simply out of range.
    const existing = { ...occ, metadata: { ...occ.metadata, participants: [] } }
    const data: StoreData = dataOf(
      [{ date: '2026-08-18', time: null, source: 'explicit', entryKey: keyOf('handy'), id: 'occ-1', metadata: { participants: [], done: false } }],
      rootsOf(root),
    )

    const next = applyEdit(data, existing, 'all', fields, NEW_TARGET)

    expect(itemsOf(next).filter(i => i.entryKey === keyOf('handy'))).toHaveLength(1)
    expect(itemsOf(next)[0]!.id).toBe('occ-1') // upserted in place, not appended alongside
  })
})

describe('a file that carries only file-level fields', () => {
  it('parses into one undated occurrence, so the entry arrives whole', () => {
    // The clause that makes `Entry['items']` safe to assert as non-empty:
    // `nodeIsItem` treats a leaf root as an item. Without it a root-only file
    // would load as a root with no occurrences — the state this file is named
    // for — and the parse boundary's narrowing would have to invent an item or
    // throw on a file the user legitimately wrote.
    const content = ['---', 'title: handy', 'tags: [errands]', '---', '', 'Compare the plans.'].join('\n')

    const parsed = parseToStoreItems('handy.md', content, TEST_VAULT)

    expect(parsed.items).toHaveLength(1)
    expect(isStandaloneOcc(parsed.items[0])).toBe(true)
    expect(parsed.root.title).toBe('handy')
  })

  it('keeps its file-level fields across a save, rather than blanking them', () => {
    // The original regression: a save that emitted an empty document would
    // wipe title, tags and the `items:` list. Serializing goes through the
    // entry, so the root always rides along with the occurrence it belongs to.
    const parsed = parseToStoreItems('handy.md', ['---', 'title: handy', 'tags: [errands]', '---'].join('\n'), TEST_VAULT)

    const saved = serialize(parsed.items, parsed.root)

    expect(frontmatterOf(saved)).toMatchObject({ title: 'handy', tags: ['errands'] })
    // …and it survives a second trip, so the shape is stable rather than
    // merely non-empty once.
    const reparsed = parseToStoreItems('handy.md', saved, TEST_VAULT)
    expect(reparsed.root.title).toBe('handy')
    expect(reparsed.items).toHaveLength(1)
  })

  it('routes a file that describes no occurrence to the caller\'s catch', () => {
    // The one input that yields nothing yields it by throwing, which is what
    // `parseFiles` records in `unreadableFiles` — holding neither a root nor
    // items, and so consistent with the non-empty invariant rather than a hole
    // in it. `collapseToYaml`'s old `items.length === 0` branch is gone with
    // the state it existed for.
    expect(() => parseToStoreItems('empty.md', '---\n---\n', TEST_VAULT)).toThrow()
  })
})
