/**
 * The seam between the store and durable storage.
 *
 * This is the layer that decides *what* gets persisted and whether a key is a
 * write or a delete. Both used to happen on the far side of the port: the
 * storage adapter was handed a key and resolved the content itself, so nothing
 * this side of the seam could observe what a save actually carried — or that it
 * carried nothing at all. The tests here assert the content, which is the whole
 * point of the port taking it.
 */
import { describe, it, expect } from 'vitest'
import { setupStore, installFakePersistence, testKey, makeOcc, makeRoots, makeRootMeta, TEST_VAULT } from '@/test-utils'
import { entryKey as makeEntryKey } from '@/fileIO'
import type { StoreData } from '@/model'
import type { Roots } from '@/types'
import { useStore } from '@/store'
import { commitNext, commitDelete, commitMove, persistEntries } from './storeCommit'

setupStore()
const persistence = installFakePersistence()

const KEY = testKey('handy')

/** A store holding one ordinary entry. */
function oneEntry(): StoreData {
  return {
    items: [makeOcc({ id: 'occ-1', entryKey: KEY, date: '2026-08-18', metadata: { vaultId: TEST_VAULT, fileSlug: 'handy', participants: [], title: 'handy', tags: ['errands'], items: [] } })],
    roots: makeRoots('handy', { title: 'handy', tags: ['errands'], body: 'Compare the plans.' }),
  }
}

describe('commitNext', () => {
  it('persists the entry as file content, not merely as a request to save it', () => {
    commitNext(oneEntry(), [KEY])

    expect(persistence.writes).toEqual([KEY])
    const content = persistence.contentByKey.get(KEY)
    expect(content).toContain('title: handy')
    expect(content).toContain('errands')
    expect(content).toContain('Compare the plans.')
  })

  it('serializes what it is committing, not what the store held before', () => {
    // The content is taken from `next`, so it cannot lag the commit — the class
    // of bug that came from re-reading global state on the far side of the port.
    const before = oneEntry()
    commitNext(before, [KEY])
    const renamed: StoreData = {
      items: before.items,
      roots: makeRoots('handy', { title: 'Neues Handy', tags: [], body: '' }),
    }

    commitNext(renamed, [KEY])

    expect(persistence.contentByKey.get(KEY)).toContain('title: Neues Handy')
  })

  it('writes an entry whose root has no occurrences rather than deleting it', () => {
    // Its file-level fields are what is left of it; a delete here would drop a
    // file the store still lists.
    commitNext({ items: [], roots: makeRoots('handy', { title: 'handy' }) }, [KEY])

    expect(persistence.deletes).toEqual([])
    expect(persistence.contentByKey.get(KEY)).toContain('title: handy')
  })

  it('deletes a key the committed data no longer holds at all', () => {
    commitNext({ items: [], roots: new Map() }, [KEY])

    expect(persistence.writes).toEqual([])
    expect(persistence.deletes).toEqual([KEY])
  })
})

describe('commitDelete', () => {
  it('deletes the primary and rewrites the backlink-edited entries with their new content', () => {
    const linker = testKey('linker')
    const roots: Roots = new Map([[linker, makeRootMeta('linker', { title: 'Linker', items: [] })]])
    const data: StoreData = { items: [makeOcc({ id: 'l1', entryKey: linker })], roots }

    commitDelete(data, KEY, [linker])

    expect(persistence.deletes).toEqual([KEY])
    expect(persistence.contentByKey.get(linker)).toContain('title: Linker')
  })
})

describe('commitMove', () => {
  const OTHER = 'other-vault'
  const toKey = makeEntryKey(OTHER, 'handy')

  it('hands the port the entry as it exists at the target key', () => {
    const moved: StoreData = {
      items: [makeOcc({ id: 'occ-1', entryKey: toKey, metadata: { vaultId: OTHER, fileSlug: 'handy', participants: [], title: 'handy', tags: [], items: [] } })],
      roots: new Map([[toKey, { title: 'handy', tags: [], items: [], vaultId: OTHER, fileSlug: 'handy' }]]),
    }

    commitMove(moved, KEY, toKey)

    expect(persistence.moves).toHaveLength(1)
    const [from, to, content] = persistence.moves[0]!
    expect([from, to]).toEqual([KEY, toKey])
    expect(content).toContain('title: handy')
  })

  it('refuses the whole move when the target key holds nothing — including the store commit', () => {
    // Writing an empty file over the target and then tombstoning the source
    // would destroy the entry. The check runs before `setData`, so a caller
    // that built `next` wrong leaves the store untouched rather than re-keyed
    // with nothing durable behind it.
    const seeded = oneEntry()
    commitNext(seeded, [KEY])
    const rootsBefore = useStore.getState().roots

    commitMove({ items: [], roots: new Map() }, KEY, toKey)

    expect(persistence.moves).toEqual([])
    expect(useStore.getState().roots).toBe(rootsBefore)
  })
})

describe('persistEntries', () => {
  it('reads an entry that is gone from the data as the delete it is', () => {
    // How Undo-of-a-create reaches the backend: `restoreEntries` puts the store
    // back to a state with no such entry, and the file the create already wrote
    // has to go with it.
    persistEntries({ items: [], roots: new Map() }, [KEY])

    expect(persistence.deletes).toEqual([KEY])
  })
})
