/**
 * An entry whose root survives with no occurrences.
 *
 * Reported symptom: an entry created from the mobile search overlay showed up
 * in the search results as an invisible gap — a reserved row that drew nothing
 * — and was gone entirely after a restart. Both halves come from the same
 * store state: a root with zero items. Nothing renders such an entry, and the
 * write path used to refuse to persist it, so it lived in memory only.
 *
 * These tests pin the two model-level guarantees that make that state
 * survivable: an edit never *produces* it, and serializing it never blanks the
 * file.
 */
import { describe, it, expect } from 'vitest'
import { rootsOf, TEST_VAULT, NEW_TARGET, keyOf, serialize, frontmatterOf, dataOf, itemsOf, rootsIn } from './helpers'
import { applyEdit } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { collapseToYaml } from '@/model/collapse'
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

/** Store state where the entry's root is all that is left. */
function occurrencelessData(): StoreData {
  return dataOf([], rootsOf(root))
}

describe('applyEdit on an entry whose items are gone', () => {
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

describe('serializing an entry that has only a root', () => {
  it('keeps the file-level fields instead of emitting an empty document', () => {
    const yaml = collapseToYaml([], root)

    expect(yaml).toMatchObject({ title: 'handy', tags: ['errands'] })
  })

  it('round-trips back into a single undated occurrence, so the entry heals', () => {
    const content = serialize([], root)
    expect(frontmatterOf(content)).toMatchObject({ title: 'handy' })

    const reparsed = parseToStoreItems('handy.md', content, TEST_VAULT)

    expect(reparsed.root.title).toBe('handy')
    expect(reparsed.items).toHaveLength(1)
    expect(isStandaloneOcc(reparsed.items[0]!)).toBe(true)
  })

  it('still emits an empty document when there is no root either', () => {
    expect(collapseToYaml([], undefined)).toEqual({})
  })
})
