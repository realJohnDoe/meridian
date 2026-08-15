// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { beginSwipeDelete, toggleOccDone, reopenOcc, moveEntryToVault } from './occurrenceActions'
import { entryKey as makeEntryKey } from '@/fileIO'
import { Toaster } from '@/components/ui/sonner'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeSeries, makeRoots, testKey, makeRootMeta, TEST_VAULT } from '@/test-utils'
import type { Roots, StoreItem, StoreOcc } from '@/types'

setupStore()
const persistence = installFakePersistence()

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // Safety net: settle any toast a failed assertion left pending, so its
  // deferred commit can't fire during the *next* test (occurrenceActions'
  // _pendingCommit/_toastId are module-level singletons shared across tests).
  act(() => { vi.advanceTimersByTime(10_000) })
  vi.useRealTimers()
})

function items(): StoreItem[] {
  return useStore.getState().items
}

function findOverrideFor(ownerId: string) {
  return items().find(i => 'ownerId' in i && i.ownerId === ownerId) as { excluded?: boolean } | undefined
}

// sonner mounts a toast's DOM (and its action button) on the animation frame
// after it's added to the store, not synchronously — advance fake timers past
// that frame before querying for toast content.
function flushToastMount() {
  act(() => { vi.advanceTimersByTime(20) })
}

describe('beginSwipeDelete', () => {
  it('optimistically removes a standalone occurrence and defers persistence to auto-close', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()

    expect(items().find(i => i.id === 'occ-1')).toBeUndefined()
    expect(persistence.deletes).toEqual([])
    expect(screen.getByText('Deleted: Standup')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.deletes).toEqual([testKey('note.md')])
  })

  it('Undo restores the snapshot, persists the restore, and the deferred commit never persists', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(items().find(i => i.id === 'occ-1')).toBeDefined()

    act(() => { vi.advanceTimersByTime(5000) })

    expect(persistence.deletes).toEqual([])
    expect(persistence.writes).toEqual([testKey('note.md')])
  })

  it('excludes (not deletes) a recurring occurrence and writes the file on auto-close', () => {
    const series = makeSeries({ id: 'series-1', entryKey: testKey('note.md'), repeat: { type: 'schedule', freq: 'daily' } })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1' })
    seedStore([series], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()

    expect(findOverrideFor('series-1')?.excluded).toBe(true)
    expect(persistence.writes).toEqual([])

    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(persistence.deletes).toEqual([])
  })

  it('Undo on a recurring occurrence restores the un-excluded snapshot and persists it', () => {
    const series = makeSeries({ id: 'series-1', entryKey: testKey('note.md'), repeat: { type: 'schedule', freq: 'daily' } })
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1' })
    seedStore([series], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(items()).toEqual([series])

    act(() => { vi.advanceTimersByTime(5000) })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(persistence.deletes).toEqual([])
  })

  it('undoing a delete does not revert an unrelated edit made during the toast window', () => {
    const a = makeOcc({ id: 'occ-a', entryKey: testKey('a.md'), date: '2026-06-15', time: null, metadata: { vaultId: TEST_VAULT, fileSlug: 'a.md', participants: [], title: 'A', tags: [], items: [] } })
    const b = makeOcc({
      id: 'occ-b', entryKey: testKey('b.md'), date: '2026-06-16', time: null,
      metadata: { vaultId: TEST_VAULT, fileSlug: 'b.md', participants: [], title: 'B', tags: [], items: [], done: false },
    })
    const roots: Roots = makeRoots('a.md', { title: 'A' })
    roots.set(testKey('b.md'), makeRootMeta('b.md', { title: 'B', tags: [], items: [] }))
    seedStore([a, b], roots)
    render(<Toaster />)

    const apply = beginSwipeDelete(a)
    act(() => apply())
    flushToastMount()

    act(() => { toggleOccDone(b) })
    expect(persistence.writes).toEqual([testKey('b.md')])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(items().map(i => i.entryKey).sort()).toEqual([testKey('a.md'), testKey('b.md')])
    expect((items().find(i => i.id === 'occ-b') as StoreOcc).metadata.done).toBe(true)
  })

  // ── finding #7: swipe-deleting an entry other files link to ────────────────
  //
  // deleteByFileSlug strips the deleted slug out of every other file's items:
  // list in the STORE, but that cleanup used to never reach the backend (this
  // path never wrote the affected file) and Undo never reversed it (restored
  // only the deleted file's own slug). Both halves are pinned here.

  it('persists the backlink cleanup on commit, not just in the in-memory store', () => {
    const a = makeOcc({ id: 'occ-a', entryKey: testKey('a.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'a.md', participants: [], title: 'A', tags: [], items: [] } })
    const b = makeOcc({ id: 'occ-b', entryKey: testKey('b.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'b.md', participants: [], title: 'B', tags: [], items: [] } })
    const roots: Roots = makeRoots('a.md', { title: 'A' })
    roots.set(testKey('b.md'), makeRootMeta('b.md', { title: 'B', tags: [], items: ['[[a.md]]'] }))
    seedStore([a, b], roots)
    render(<Toaster />)

    const apply = beginSwipeDelete(a)
    act(() => apply())
    flushToastMount()

    // Optimistic: the store already reflects the cleanup before the toast settles.
    expect(useStore.getState().roots.get(testKey('b.md'))?.items).toEqual([])
    expect(persistence.writes).toEqual([])

    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.deletes).toEqual([testKey('a.md')])
    expect(persistence.writes).toEqual([testKey('b.md')])
  })

  it('Undo restores both the deleted entry and the wikilink other files carried to it', () => {
    const a = makeOcc({ id: 'occ-a', entryKey: testKey('a.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'a.md', participants: [], title: 'A', tags: [], items: [] } })
    const b = makeOcc({ id: 'occ-b', entryKey: testKey('b.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'b.md', participants: [], title: 'B', tags: [], items: [] } })
    const roots: Roots = makeRoots('a.md', { title: 'A' })
    roots.set(testKey('b.md'), makeRootMeta('b.md', { title: 'B', tags: [], items: ['[[a.md]]'] }))
    seedStore([a, b], roots)
    render(<Toaster />)

    const apply = beginSwipeDelete(a)
    act(() => apply())
    flushToastMount()
    expect(useStore.getState().roots.get(testKey('b.md'))?.items).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(items().find(i => i.id === 'occ-a')).toBeDefined()
    expect(useStore.getState().roots.get(testKey('b.md'))?.items).toEqual(['[[a.md]]'])

    act(() => { vi.advanceTimersByTime(5000) })

    // The restore is persisted too — both slugs, since both were reverted.
    expect(persistence.writes.sort()).toEqual([testKey('a.md'), testKey('b.md')])
    expect(persistence.deletes).toEqual([])
  })

  it('a second delete fires the first pending commit immediately, before any timer advances', () => {
    const a = makeOcc({ id: 'occ-a', entryKey: testKey('a.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'a.md', participants: [], title: 'A', tags: [], items: [] } })
    const b = makeOcc({ id: 'occ-b', entryKey: testKey('b.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'b.md', participants: [], title: 'B', tags: [], items: [] } })
    const roots: Roots = makeRoots('a.md', { title: 'A' })
    roots.set(testKey('b.md'), makeRootMeta('b.md', { title: 'B', tags: [], items: [] }))
    seedStore([a, b], roots)
    render(<Toaster />)

    const applyA = beginSwipeDelete(a)
    act(() => applyA())
    expect(persistence.deletes).toEqual([])

    let applyB!: () => void
    act(() => { applyB = beginSwipeDelete(b) })
    expect(persistence.deletes).toEqual([testKey('a.md')])

    act(() => applyB())
    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.deletes).toEqual([testKey('a.md'), testKey('b.md')])
  })

  it('deleting the last open occurrence of an after_completion series warns that it ends the series', () => {
    const series = makeSeries({ id: 'series-1', entryKey: testKey('note.md'), repeat: { type: 'after_completion', interval: '1 day' } })
    const occ = makeOcc({
      id: 'occ-1', entryKey: testKey('note.md'), ownerId: 'series-1',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false },
    })
    seedStore([series], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()

    expect(screen.getByText(/this series only repeats after completion/)).toBeInTheDocument()
  })
})

describe('toggleOccDone', () => {
  it('flips done to true and persists the file', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))

    toggleOccDone(occ)

    expect((items().find(i => i.id === 'occ-1') as StoreOcc).metadata.done).toBe(true)
    expect(persistence.writes).toEqual([testKey('note.md')])
  })

  it('flips done back to false', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: true } })
    seedStore([occ], makeRoots('note.md'))

    toggleOccDone(occ)

    expect((items().find(i => i.id === 'occ-1') as StoreOcc).metadata.done).toBe(false)
  })
})

describe('reopenOcc', () => {
  it('reuses an existing undated standalone entry for the same file', () => {
    const dated = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), date: '2026-06-15', metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: true } })
    const undated = makeOcc({ id: 'occ-2', entryKey: testKey('note.md'), date: '', time: null, metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: true } })
    seedStore([dated, undated], makeRoots('note.md'))

    reopenOcc(dated)

    expect(items()).toHaveLength(2)
    expect((items().find(i => i.id === 'occ-2') as StoreOcc).metadata.done).toBe(false)
    expect(persistence.writes).toEqual([testKey('note.md')])
  })

  it('creates a fresh undated entry when none exists for the file', () => {
    const occ = makeOcc({
      id: 'occ-1', entryKey: testKey('note.md'), date: '2026-06-15',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: ['alice'], title: 'Standup', tags: [], items: [], done: true, priority: 'high' },
    })
    seedStore([occ], makeRoots('note.md'))

    reopenOcc(occ)

    const created = items().find(i => i.id !== 'occ-1') as StoreOcc
    expect(created).toBeDefined()
    expect(created.date).toBe('')
    expect(created.metadata.done).toBe(false)
    expect(created.metadata.participants).toEqual(['alice'])
    expect(created.metadata.priority).toBe('high')
    expect(persistence.writes).toEqual([testKey('note.md')])
  })

  it('does not reuse an undated entry belonging to a different file', () => {
    const occA = makeOcc({ id: 'occ-1', entryKey: testKey('a.md'), date: '2026-06-15', metadata: { vaultId: TEST_VAULT, fileSlug: 'a.md', participants: [], title: 'A', tags: [], items: [], done: true } })
    const undatedB = makeOcc({ id: 'occ-2', entryKey: testKey('b.md'), date: '', time: null, metadata: { vaultId: TEST_VAULT, fileSlug: 'b.md', participants: [], title: 'B', tags: [], items: [], done: true } })
    const roots: Roots = makeRoots('a.md', { title: 'A' })
    roots.set(testKey('b.md'), makeRootMeta('b.md', { title: 'B', tags: [], items: [] }))
    seedStore([occA, undatedB], roots)

    reopenOcc(occA)

    expect(items()).toHaveLength(3)
    expect((items().find(i => i.id === 'occ-2') as StoreOcc).metadata.done).toBe(true)
  })
})

describe('moveEntryToVault', () => {
  const OTHER_VAULT = 'other-vault'
  const otherKey = (slug: string) => makeEntryKey(OTHER_VAULT, slug)

  function seedOne(slug = 'note.md') {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey(slug) })
    seedStore([occ], makeRoots(slug))
    useStore.setState({ vaults: [
      { id: TEST_VAULT, name: 'Work', kind: 'local' },
      { id: OTHER_VAULT, name: 'Personal', kind: 'local' },
    ] })
    return occ
  }

  it('re-keys the entry into the target vault and reports where it landed', () => {
    seedOne()

    const landed = moveEntryToVault(testKey('note.md'), OTHER_VAULT)

    expect(landed).toBe(otherKey('note.md'))
    expect(items().map(i => i.entryKey)).toEqual([otherKey('note.md')])
    expect(useStore.getState().roots.get(otherKey('note.md'))?.vaultId).toBe(OTHER_VAULT)
    expect(useStore.getState().roots.has(testKey('note.md'))).toBe(false)
  })

  it('persists it as one move — never a write plus an unrelated delete', () => {
    seedOne()

    moveEntryToVault(testKey('note.md'), OTHER_VAULT)

    expect(persistence.moves).toEqual([[testKey('note.md'), otherKey('note.md')]])
    expect(persistence.writes).toEqual([])
    expect(persistence.deletes).toEqual([])
  })

  it('allocates a free slug when the target vault already has that file', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    const taken = makeOcc({ id: 'occ-2', entryKey: otherKey('note.md') })
    const roots: Roots = makeRoots('note.md')
    roots.set(otherKey('note.md'), { title: 'Theirs', tags: [], items: [], vaultId: OTHER_VAULT, fileSlug: 'note.md' })
    seedStore([occ, taken], roots)
    useStore.setState({ vaults: [
      { id: TEST_VAULT, name: 'Work', kind: 'local' },
      { id: OTHER_VAULT, name: 'Personal', kind: 'local' },
    ] })

    expect(moveEntryToVault(testKey('note.md'), OTHER_VAULT)).toBe(otherKey('note.md-2'))
    expect(useStore.getState().roots.get(otherKey('note.md'))?.title).toBe('Theirs')
  })

  it('carries a favourite over, keeping its position', () => {
    seedOne()
    useStore.setState({ favorites: [testKey('a.md'), testKey('note.md'), testKey('b.md')] })

    moveEntryToVault(testKey('note.md'), OTHER_VAULT)

    expect(useStore.getState().favorites).toEqual([testKey('a.md'), otherKey('note.md'), testKey('b.md')])
  })

  it('leaves favourites alone when the moved entry was not one', () => {
    seedOne()
    useStore.setState({ favorites: [testKey('a.md')] })

    moveEntryToVault(testKey('note.md'), OTHER_VAULT)

    expect(useStore.getState().favorites).toEqual([testKey('a.md')])
  })

  it('does nothing when the entry is already in that vault', () => {
    seedOne()

    expect(moveEntryToVault(testKey('note.md'), TEST_VAULT)).toBeNull()
    expect(persistence.moves).toEqual([])
  })

  it('refuses a target that is no longer a registered writable vault', () => {
    seedOne()
    useStore.setState({ vaults: [{ id: TEST_VAULT, name: 'Work', kind: 'local' }] })

    expect(moveEntryToVault(testKey('note.md'), OTHER_VAULT)).toBeNull()
    expect(persistence.moves).toEqual([])
    expect(useStore.getState().roots.has(testKey('note.md'))).toBe(true)
  })

  it('does nothing when there is no such entry', () => {
    seedOne()

    expect(moveEntryToVault(testKey('gone.md'), OTHER_VAULT)).toBeNull()
    expect(persistence.moves).toEqual([])
    expect(items()).toHaveLength(1)
  })
})
