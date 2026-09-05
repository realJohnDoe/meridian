import { describe, it, expect, vi } from 'vitest'
import { applyScope, entryFromOccurrence, saveNode, deleteNode, archiveEntry } from './save'
import type { SeriesSheetConfig } from './save'
import { makeOcc, makeSeries, setupStore, installFakePersistence, seedStore, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { useStore } from '@/store'
import { entryKey } from '@/fileIO'
import { setUnreadableFiles, setVaultListedKeys } from '@/storeBridge'
import { ENTRY_DEFAULT } from './state'
import type { StoreItem } from '@/types'
import { parseToStoreItems, expandRange } from '@/model'

describe('entryFromOccurrence', () => {
  it('derives a note when the item is untracked and unscheduled', () => {
    const occ = makeOcc({ time: null, date: '' })
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('note')
    expect(entry.tracked).toBe(false)
    expect(entry.scheduled).toBeNull()
  })

  it('derives an event when the item is scheduled but not tracked', () => {
    const occ = makeOcc()
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('event')
    expect(entry.tracked).toBe(false)
    expect(entry.scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
  })

  it('derives a task when `done` is defined, regardless of scheduling', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: false } })
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('task')
    expect(entry.tracked).toBe(true)
    expect(entry.done).toBe(false)
  })

  it('resets done to false for "add" scope even when the source occurrence is done', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: true } })
    const entry = entryFromOccurrence(occ, 'add')
    expect(entry.done).toBe(false)
  })

  it('copies array-valued metadata fields instead of aliasing them', () => {
    const tags = ['work']
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['alice'], title: 'T', tags, items: [], done: true } })
    const entry = entryFromOccurrence(occ, 'single')
    entry.tags.push('mutated')
    expect(tags).toEqual(['work'])
  })
})

describe('applyScope', () => {
  it('single scope keeps only this occurrence\'s date/time and drops repeat', () => {
    const occ = makeOcc({ ownerId: 'series-1' })
    const series = makeSeries()
    const { scheduled, repeat } = applyScope(occ, 'single', [series, occ])
    expect(scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
    expect(repeat).toBeNull()
  })

  it('future scope keeps this occurrence\'s date but carries the series repeat', () => {
    const occ = makeOcc({ ownerId: 'series-1' })
    const series = makeSeries()
    const { scheduled, repeat } = applyScope(occ, 'future', [series, occ])
    expect(scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
    expect(repeat).toEqual(series.repeat)
  })

  it('all scope rolls back to the series root date/time', () => {
    const occ = makeOcc({ ownerId: 'series-1' })
    const series = makeSeries()
    const { scheduled, repeat } = applyScope(occ, 'all', [series, occ])
    expect(scheduled).toEqual({ date: '2026-06-01', time: '09:00' })
    expect(repeat).toEqual(series.repeat)
  })

  it('add scope schedules a fresh occurrence for today, with no repeat', () => {
    const occ = makeOcc()
    const { scheduled, repeat } = applyScope(occ, 'add', [occ])
    expect(scheduled?.time).toBe('09:00')
    expect(repeat).toBeNull()
  })

  it('single scope on a standalone (non-recurring) item has no series to fall back to', () => {
    const occ = makeOcc()
    const { scheduled, repeat } = applyScope(occ, 'all', [occ])
    expect(scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
    expect(repeat).toBeNull()
  })
})

describe('saveNode — reserved (unreadable) slugs', () => {
  setupStore()
  const persistence = installFakePersistence()

  it('places a new entry on a free slug instead of overwriting a file that failed to parse', () => {
    setUnreadableFiles(new Map([
      [testKey('buy-groceries'), { path: 'buy-groceries.md', message: 'bad indentation, line 3' }],
    ]))

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT,
      title: 'Buy groceries',
      body: 'totally different note',
    })

    // Never adopts the reserved slug — the unreadable file's path stays untouched.
    expect(result).toBe(testKey('buy-groceries-2'))
    expect(useStore.getState().roots.has(testKey('buy-groceries'))).toBe(false)
    expect(useStore.getState().roots.get(testKey('buy-groceries-2'))?.body).toContain('totally different note')
    expect(persistence.writes).toEqual([testKey('buy-groceries-2')])
  })

  it('still lands a new entry on its natural slug when that slug is not reserved', () => {
    setUnreadableFiles(new Map([
      [testKey('some-other-file'), { path: 'some-other-file.md', message: 'bad indentation' }],
    ]))

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT,
      title: 'Buy groceries',
      body: 'note',
    })

    expect(result).toBe(testKey('buy-groceries'))
    expect(useStore.getState().roots.get(testKey('buy-groceries'))?.title).toBe('Buy groceries')
    expect(persistence.writes).toEqual([testKey('buy-groceries')])
  })
})

// The store holds what has been *pulled*, which after a week offline is not
// the same as what the vault owns. A file created elsewhere in the meantime is
// in the backend's listing long before its content is read — the reconcile
// publishes that listing on its first round trip precisely so a save landing
// during the rest of the cycle can see it.
//
// Without this the save took the slug, pushed as a create, was refused, and
// resolved as a conflict copy: the user's brand-new note and an unrelated
// remote one treated as two versions of the same file.
describe('saveNode — slugs the backend has listed but this device has not pulled', () => {
  setupStore()
  const persistence = installFakePersistence()

  it('places a new entry beside a listed file rather than on top of it', () => {
    setVaultListedKeys(TEST_VAULT, new Set([testKey('buy-milk')]))

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT, title: 'Buy milk', body: 'two litres',
    })

    expect(result).toBe(testKey('buy-milk-2'))
    expect(useStore.getState().roots.has(testKey('buy-milk'))).toBe(false)
    expect(persistence.writes).toEqual([testKey('buy-milk-2')])
  })

  it('leaves the natural slug free once that listing no longer claims it', () => {
    setVaultListedKeys(TEST_VAULT, new Set([testKey('buy-milk')]))
    setVaultListedKeys(TEST_VAULT, new Set())

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT, title: 'Buy milk', body: 'two litres',
    })

    expect(result).toBe(testKey('buy-milk'))
  })

  it('reserves only the listing vault\'s slugs', () => {
    setVaultListedKeys('other-vault', new Set([entryKey('other-vault', 'buy-milk')]))

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT, title: 'Buy milk', body: 'two litres',
    })

    expect(result).toBe(testKey('buy-milk'))
  })
})


// ── saveNode — writing only what the editor touched ────────────
//
// An editor loads its fields once and never re-reads them, so everything it is
// not editing goes stale the moment anything else writes to the entry: a sync
// pulling another device's change, a checkbox ticked from the agenda, another
// tab. A save that writes all eleven fields from that snapshot turns each of
// those into a silent revert — and on a synced vault a revert is a push, which
// the other device sees as a change worth pushing back. That loop is what
// turned one conflict into a run of conflict copies.

describe('saveNode — writes only the fields the editor changed', () => {
  setupStore()
  installFakePersistence()

  /** The store keeps occurrence-level metadata only — title/body/tags/items are
   *  file-level and live on the root. Strip them back off so a fixture writes
   *  them in exactly one place, the way a real parse does. */
  function rawItem(occ: ReturnType<typeof makeOcc>): StoreItem {
    const { title: _t, tags: _tg, items: _i, body: _b, ...metadata } = occ.metadata
    return { ...occ, metadata }
  }

  /** A note in the store, plus the editor snapshot taken when it was opened. */
  function openEditorOn(body: string) {
    const occ = makeOcc({ date: '', time: null, entryKey: testKey('essensplan'), metadata: { vaultId: TEST_VAULT, fileSlug: 'essensplan', participants: [], title: 'Essensplan', tags: [], items: [], body } })
    seedStore([occ], makeRoots('essensplan', { title: 'Essensplan', body }))
    return { occ, base: { ...entryFromOccurrence(occ, 'single'), body } }
  }

  /** What the store holds for the note now. `body` is optional on a root, and
   *  an empty one is stored as absent — normalised here so the assertions read
   *  as "what would be written to the file". */
  const storedBody = () => (useStore.getState().roots.get(testKey('essensplan')) as { body?: string } | undefined)?.body ?? ''

  it('keeps a body that changed under the editor while only a metadata field was edited', () => {
    // The incident: one person turns the note into a recurring task from a
    // stale editor while the other has already added a description.
    const { occ, base } = openEditorOn('')
    seedStore([rawItem(occ)], makeRoots('essensplan', { title: 'Essensplan', body: 'Nudeln am Dienstag' }))

    saveNode(occ, 'single', { ...base, priority: 'high' }, { base })

    expect(storedBody()).toBe('Nudeln am Dienstag')
    const saved = useStore.getState().items.find(i => i.id === 'occ-1') as { metadata: { priority?: string } } | undefined
    expect(saved?.metadata.priority).toBe('high')
  })

  it('still writes the body when the editor is the one that changed it', () => {
    const { occ, base } = openEditorOn('old text')

    saveNode(occ, 'single', { ...base, body: 'new text' }, { base })

    expect(storedBody()).toBe('new text')
  })

  it('lets the editor clear a field it actually cleared', () => {
    const { occ, base } = openEditorOn('old text')

    saveNode(occ, 'single', { ...base, body: '' }, { base })

    expect(storedBody()).toBe('')
  })

  it('writes every field when no base is supplied, as before', () => {
    // The compatibility path: callers with no snapshot to compare against
    // (a brand-new entry, a promoted checklist line) keep the old behaviour.
    const { occ, base } = openEditorOn('')
    seedStore([rawItem(occ)], makeRoots('essensplan', { title: 'Essensplan', body: 'added elsewhere' }))

    saveNode(occ, 'single', { ...base, priority: 'high' })

    expect(storedBody()).toBe('')
  })

  it('leaves a title that changed elsewhere alone', () => {
    const { occ, base } = openEditorOn('')
    seedStore([rawItem(occ)], makeRoots('essensplan', { title: 'Essensplan KW35' }))

    saveNode(occ, 'single', { ...base, priority: 'high' }, { base })

    expect((useStore.getState().roots.get(testKey('essensplan')) as { title?: string } | undefined)?.title).toBe('Essensplan KW35')
  })

  it('falls back to writing the editor snapshot when the entry is gone from the store', () => {
    // applyEdit rebuilds a deleted entry from the fields it is handed, so
    // narrowing them against a store that no longer has it would write blanks.
    const { occ, base } = openEditorOn('some text')
    useStore.getState().setData(new Map())

    saveNode(occ, 'single', { ...base, priority: 'high' }, { base })

    expect(storedBody()).toBe('some text')
  })

  // data-integrity survey, finding #1: `saveNode` used to hand `applyEdit`
  // no way to tell which fields this particular save touched, so `occMeta`/
  // `editedEntry` stripped every registry key's raw fallback out of `extra`
  // on every save regardless — renaming a title alone deleted an unrelated
  // hand-authored `tags`/`done`/`priority` the model can't type. This is the
  // end-to-end repro from the results doc, through the real editor entry
  // point rather than a direct `applyEdit` call.
  it('renaming the title through the editor keeps a hand-authored tags/done/priority', () => {
    const OBSIDIAN = `---
title: Groceries
tags: shopping
done: yes
priority: 1
date: 2026-04-08
---

Buy milk.
`
    const parsed = parseToStoreItems('groceries.md', OBSIDIAN, TEST_VAULT)
    seedStore(parsed.items, new Map([[parsed.key, parsed.root]]))
    const [occ] = expandRange(parsed.items, new Map([[parsed.key, parsed.root]]), new Date(2020, 0, 1), new Date(2030, 0, 1))
    const base = entryFromOccurrence(occ!, 'all')

    saveNode(occ!, 'all', { ...base, title: 'Groceries (weekly)' }, { base })

    // `tags` is a file-level field (fieldRegistry.ts's FILE_LEVEL_SPECS), so a
    // malformed value for it lands on the root's extra, not the item's — see
    // buildRoot/extractFileMetadata. `done`/`priority` are occurrence-level.
    const item = useStore.getState().items.find(i => i.entryKey === testKey('groceries'))
    expect(item?.metadata.extra).toMatchObject({ done: 'yes', priority: 1 })
    const root = useStore.getState().roots.get(testKey('groceries')) as { title?: string; extra?: Record<string, unknown> } | undefined
    expect(root?.extra).toMatchObject({ tags: 'shopping' })
    expect(root?.title).toBe('Groceries (weekly)')
  })
})

// plans/archived-entries.md PR 2 — archiving via the editor and its delete
// dialogs. The store op itself (setArchived) is pinned in
// model/__tests__/setArchived.test.ts; these cover the write path
// (persisted content, not just store state) and deleteNode's wiring.
describe('archiveEntry', () => {
  setupStore()
  const persistence = installFakePersistence()

  it('archiving writes archived: true to the file', () => {
    const occ = makeOcc({ entryKey: testKey('solo'), metadata: { vaultId: TEST_VAULT, fileSlug: 'solo', participants: [], title: 'Solo note', tags: [], items: [] } })
    seedStore([occ], makeRoots('solo', { title: 'Solo note' }))

    archiveEntry(testKey('solo'), true)

    expect(useStore.getState().roots.get(testKey('solo'))?.archived).toBe(true)
    expect(persistence.contentByKey.get(testKey('solo'))).toContain('archived: true')
  })

  // The trap PR 1 pinned at the registry level (round-trip-totality.test.ts):
  // clearing must never round-trip as a written `archived: false`.
  it('unarchiving writes no archived key at all', () => {
    const occ = makeOcc({ entryKey: testKey('solo'), metadata: { vaultId: TEST_VAULT, fileSlug: 'solo', participants: [], title: 'Solo note', tags: [], items: [], archived: true } })
    seedStore([occ], makeRoots('solo', { title: 'Solo note', archived: true }))

    archiveEntry(testKey('solo'), false)

    expect(useStore.getState().roots.get(testKey('solo'))?.archived).toBeUndefined()
    expect(persistence.contentByKey.get(testKey('solo'))).not.toContain('archived')
  })
})

describe('deleteNode — archiving instead of deleting', () => {
  setupStore()
  installFakePersistence()

  it('single-entry path (no siblings, not recurring): archives without navigating away', () => {
    const occ = makeOcc({ entryKey: testKey('solo'), id: 'solo-1', metadata: { vaultId: TEST_VAULT, fileSlug: 'solo', participants: [], title: 'Solo note', tags: [], items: [] } })
    seedStore([occ], makeRoots('solo', { title: 'Solo note' }))

    const navigateBack = vi.fn()
    let captured: { title: string; onConfirm: () => void; onArchive: () => void } | undefined
    deleteNode(occ, navigateBack, undefined, undefined, (title, onConfirm, onArchive) => {
      captured = { title, onConfirm, onArchive }
    })

    expect(captured?.title).toBe('Solo note')
    captured!.onArchive()

    expect(useStore.getState().roots.get(testKey('solo'))?.archived).toBe(true)
    // Unlike a real delete (doDelete), archiving leaves the entry — and the
    // editor showing it — right where it was.
    expect(navigateBack).not.toHaveBeenCalled()
    expect(useStore.getState().items.some(i => i.id === 'solo-1')).toBe(true)
  })

  it('multi-item file path: the series sheet\'s archive option archives the WHOLE file, not one occurrence', () => {
    const occA = makeOcc({ entryKey: testKey('multi'), id: 'multi-a', metadata: { vaultId: TEST_VAULT, fileSlug: 'multi', participants: [], title: 'Task A', tags: [], items: [], done: false } })
    const occB = makeOcc({ entryKey: testKey('multi'), id: 'multi-b', date: '2026-06-16', metadata: { vaultId: TEST_VAULT, fileSlug: 'multi', participants: [], title: 'Task A', tags: [], items: [], done: false } })
    seedStore([occA, occB], makeRoots('multi', { title: 'Task A' }))

    let config: SeriesSheetConfig | undefined
    deleteNode(occA, vi.fn(), c => { config = c }, vi.fn())

    // It's the multi-item (sibling) branch, not a lone standalone — confirms
    // the fixture actually reaches onShowSeries rather than onConfirmSingle.
    expect(config).toBeDefined()
    expect(config!.onArchive).toBeDefined()
    config!.onArchive!()

    expect(useStore.getState().roots.get(testKey('multi'))?.archived).toBe(true)
    // Both occurrences are still there — archiving is not a delete of any kind.
    expect(useStore.getState().items.map(i => i.id).sort()).toEqual(['multi-a', 'multi-b'])
  })
})
