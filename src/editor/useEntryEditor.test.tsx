// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { titleToSlug, entryKey as makeEntryKey } from '@/fileIO'
import type { FileMetadata, Roots } from '@/types'
import type { VaultRef } from '@/vaultRef'
import { entriesOf } from '@/test-utils'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { useEntryEditor } from './useEntryEditor'

const { navigateMock, backMock } = vi.hoisted(() => ({ navigateMock: vi.fn(), backMock: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouter: () => ({ history: { back: backMock } }),
  }
})

setupStore()
const persistence = installFakePersistence()

beforeEach(() => {
  navigateMock.mockClear()
  backMock.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useEntryEditor', () => {
  it('meta save (handleDoneToggle) writes synchronously', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleDoneToggle() })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(result.current.entry.done).toBe(true)
  })

  it('switching scope to "add" resets done, even though it was done just before the switch', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: true } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    expect(result.current.entry.done).toBe(true)

    act(() => { result.current.handleScopeChange('add') })

    expect(result.current.entry.done).toBe(false)
  })

  it('autosave debounces body writes by 1500ms and commits the latest scheduled body', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft 1') })
    act(() => { vi.advanceTimersByTime(700) })
    act(() => { result.current.scheduleAutoSave('draft 2') }) // resets the debounce timer
    act(() => { vi.advanceTimersByTime(1499) })
    expect(persistence.writes).toEqual([])

    act(() => { vi.advanceTimersByTime(1) })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('draft 2')
  })

  it('a scheduled autosave commits against the latest entry state, not a stale snapshot', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft') })
    act(() => { result.current.handleDoneToggle() }) // synchronous meta save, before the autosave timer fires
    act(() => { vi.advanceTimersByTime(1500) })

    expect(persistence.writes).toEqual([testKey('note.md'), testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('draft')
    const saved = useStore.getState().items.find(i => i.id === 'occ-1') as { metadata: { done?: boolean } } | undefined
    expect(saved?.metadata.done).toBe(true)
  })

  it('goBack flushes a still-pending autosave immediately instead of dropping it', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('unsaved draft') })
    // Navigate away (e.g. tapping back) before the 1500ms debounce elapses.
    act(() => { result.current.handleClose() })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('unsaved draft')
  })

  it('commits a brand-new item on close even when the creating edit never got a chance to debounce', () => {
    // Reproduces the reported bug: typing a title arms the debounced autosave
    // (see EntryEditor's title onChange), but navigating back immediately —
    // well within the 1500ms window — used to just clearTimeout the pending
    // commit, silently dropping the brand-new item.
    const { result } = renderHook(() => useEntryEditor(null))
    const key = testKey(titleToSlug('Brand new task'))

    act(() => { result.current.setEntry({ ...result.current.entry, title: 'Brand new task' }) })
    act(() => { result.current.scheduleAutoSave('') })
    act(() => { result.current.handleClose() })

    expect(persistence.writes).toEqual([key])
    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)
  })

  it('flushes a still-pending autosave on unmount (e.g. navigating to a wikilink)', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md'))
    const { result, unmount } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft body') })
    act(() => { unmount() })

    expect(persistence.writes).toEqual([testKey('note.md')])
    expect(useStore.getState().roots.get(testKey('note.md'))?.body).toBe('draft body')
  })

  it('a new entry with a title commits on mount without navigating away', () => {
    const { result } = renderHook(() => useEntryEditor(null, 'single', 'My New Task'))
    const key = testKey(titleToSlug('My New Task'))

    expect(persistence.writes).toEqual([key])
    // Asserting the *content*, not just that a save was requested for the key.
    // The key-only assertion this used to make passed for the whole time the
    // write path was silently dropping the file — "a save was requested for K"
    // and "K was written" are different claims, and only one of them was ever
    // checked anywhere in the suite.
    expect(persistence.contentByKey.get(key)).toContain('title: My New Task')
    // Navigating away mid-session used to tear down the editor (and any open
    // dialog) the instant the first save landed — see the duplicate-entry
    // investigation. The created item is now adopted internally instead, so
    // the editor stays mounted on /entry/new for the rest of the session.
    expect(navigateMock).not.toHaveBeenCalled()
    expect(result.current.entry.item).toBeNull()
  })

  it('a metadata save fired right after the creating save upserts instead of duplicating the item', () => {
    // Reproduces the reported bug: typing a title arms the debounced body
    // autosave, but confirming a dialog (date/time/duration/priority) before
    // that timer fires calls saveMeta synchronously — landing a second
    // create-scoped commit while the hook still thinks no item exists yet.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Board game night'))
    const key = testKey(titleToSlug('Board game night'))

    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)

    act(() => { result.current.handleDoneToggle() })

    expect(useStore.getState().items.filter(i => i.entryKey === key)).toHaveLength(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('a new entry whose title slugifies onto an existing file leaves that file alone', () => {
    // Reproduces the reported bug: "Buy groceries!" slugifies to `buy-groceries`,
    // the slug an unrelated entry already owns. A write is a whole-file replace,
    // so creating the new entry there destroyed the existing one outright — no
    // error, no artifact, and every wikilink to it silently re-pointed.
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('buy-groceries'), date: '2026-04-08', metadata: { vaultId: TEST_VAULT, fileSlug: 'buy-groceries', participants: [], title: 'Buy groceries', tags: ['errands'], items: [] } })
    seedStore([occ], makeRoots('buy-groceries', { title: 'Buy groceries', tags: ['errands'], body: 'Remember the bags.' }))

    renderHook(() => useEntryEditor(null, 'all', 'Buy groceries!'))

    const roots = useStore.getState().roots
    expect(roots.get(testKey('buy-groceries'))?.title).toBe('Buy groceries')
    expect(roots.get(testKey('buy-groceries'))?.body).toBe('Remember the bags.')
    expect(roots.get(testKey('buy-groceries-2'))?.title).toBe('Buy groceries!')
    expect(persistence.writes).toEqual([testKey('buy-groceries-2')])
  })

  it('later saves of a slug-collided new entry keep hitting its own file', () => {
    // The re-entrancy the applyNew guard exists for, on the collision path: the
    // creating save lands on `buy-groceries-2`, and the autosave that follows must
    // upsert onto it rather than allocate `buy-groceries-3` (or fall back onto the
    // unrelated `buy-groceries`).
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('buy-groceries'), date: '2026-04-08', metadata: { vaultId: TEST_VAULT, fileSlug: 'buy-groceries', participants: [], title: 'Buy groceries', tags: [], items: [] } })
    seedStore([occ], makeRoots('buy-groceries', { title: 'Buy groceries', body: 'Remember the bags.' }))

    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Buy groceries!'))
    act(() => { result.current.scheduleAutoSave('totally different note') })
    act(() => { vi.advanceTimersByTime(1500) })

    const roots = useStore.getState().roots
    expect([...roots.keys()].sort()).toEqual([testKey('buy-groceries'), testKey('buy-groceries-2')])
    expect(roots.get(testKey('buy-groceries'))?.body).toBe('Remember the bags.')
    expect(roots.get(testKey('buy-groceries-2'))?.body).toBe('totally different note')
    expect(useStore.getState().items.filter(i => i.entryKey === testKey('buy-groceries-2'))).toHaveLength(1)
  })

  it('handleSave on a not-yet-adopted new entry upserts instead of creating a second file', () => {
    // handleSave passes entry.item, which stays null for a brand-new entry even
    // after autosave created the file — so without the draft identity it asks for
    // another new entry and lands on a `-2` sibling of the file it just made.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'Board game night'))
    expect(persistence.writes).toEqual([testKey('board-game-night')])

    act(() => { result.current.handleSave('body text') })

    expect([...useStore.getState().roots.keys()]).toEqual([testKey('board-game-night')])
    expect(useStore.getState().roots.get(testKey('board-game-night'))?.body).toBe('body text')
    expect(useStore.getState().items).toHaveLength(1)
  })

  it('a save after the entry lost its items keeps it whole instead of leaving a bare root', () => {
    // The reported bug, end to end: create from the search overlay, then change
    // the priority. The editor holds the occurrence its first save created, so
    // if the entry's items go while it stays open — a reconcile re-merging the
    // vault layer, another tab, a remote delete — the next save updated the
    // root and matched no item. That left a root with zero occurrences: search
    // reserved a row for it and drew nothing, and the write path refused to
    // persist it, so the entry died with the tab.
    const { result } = renderHook(() => useEntryEditor(null, 'all', 'handy', { date: '2026-08-18' }))
    const key = testKey(titleToSlug('handy'))
    expect(persistence.writes).toEqual([key])

    // The items disappear from under the open editor; the root survives.
    act(() => { useStore.getState().setData(entriesOf([], useStore.getState().roots)) })

    act(() => { result.current.dialogHandlers.onPriority('high') })

    const items = useStore.getState().items.filter(i => i.entryKey === key)
    expect(items).toHaveLength(1)
    expect(items[0]!.metadata.priority).toBe('high')
    expect(persistence.writes).toEqual([key, key])
    // The file the second save carried is a whole entry, not an empty document
    // — which is what the store would have serialized to with the root alone.
    const content = persistence.contentByKey.get(key)
    expect(content).toContain('title: handy')
    expect(content).toContain('priority: high')
  })

  it('editScope "add" suppresses both the meta save and the autosave', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ, 'add'))

    act(() => { result.current.handleDoneToggle() })
    act(() => { result.current.scheduleAutoSave('draft') })
    act(() => { vi.advanceTimersByTime(2000) })

    expect(persistence.writes).toEqual([])
    expect(result.current.entry.done).toBe(true) // local state still updates
  })

  it('a new entry with no title does not commit or navigate on mount', () => {
    renderHook(() => useEntryEditor(null))

    expect(persistence.writes).toEqual([])
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('handleSave with an empty title flags titleMissing and bumps focusTitleTick instead of navigating back', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.setEntry({ ...result.current.entry, title: '' }) })
    const tickBefore = result.current.focusTitleTick
    act(() => { result.current.handleSave('body') })

    expect(result.current.titleMissing).toBe(true)
    expect(result.current.focusTitleTick).toBe(tickBefore + 1)
    expect(backMock).not.toHaveBeenCalled()

    act(() => { result.current.setEntry({ ...result.current.entry, title: 'Standup again' }) })
    act(() => { result.current.handleSave('body') })
    expect(result.current.titleMissing).toBe(false)
    expect(backMock.mock.calls.length + navigateMock.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('useEntryEditor — moving between vaults', () => {
  const OTHER = 'other-vault'
  const otherKey = (slug: string) => makeEntryKey(OTHER, slug)
  const VAULTS: VaultRef[] = [
    { id: TEST_VAULT, name: 'Work', kind: 'local' },
    { id: OTHER, name: 'Personal', kind: 'local' },
  ]

  function seedTwoVaults(rootMeta: Partial<FileMetadata> = {}) {
    const occ = makeOcc({ id: 'occ-1', entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', rootMeta))
    useStore.setState({ vaults: VAULTS })
    return occ
  }

  it('picking a vault stages a move instead of applying one', () => {
    const occ = seedTwoVaults()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({
      toVaultId: OTHER, fromVault: 'Work', toVault: 'Personal', slugTaken: false,
    })
    // Nothing has happened to the entry yet — the dialog decides.
    expect(persistence.moves).toEqual([])
    expect(useStore.getState().roots.has(testKey('note.md'))).toBe(true)
  })

  it('counts the links the move will break', () => {
    // This entry links to `other-note`, and `linker` links back to it. Both
    // links are inside the source vault, so both break.
    const occ = seedTwoVaults({ items: ['[[other-note]]'] })
    const roots = new Map(useStore.getState().roots)
    roots.set(testKey('other-note'), { title: 'Other', tags: [], items: [], vaultId: TEST_VAULT, fileSlug: 'other-note' })
    roots.set(testKey('linker'), { title: 'Linker', tags: [], items: ['[[note.md]]'], vaultId: TEST_VAULT, fileSlug: 'linker' })
    act(() => { useStore.getState().setData(entriesOf(useStore.getState().items, roots)) })

    const { result } = renderHook(() => useEntryEditor(occ))
    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({ inbound: 1, outbound: 1 })
  })

  it('confirming moves the entry and navigates to its new URL', () => {
    const occ = seedTwoVaults()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.onVaultChange?.(OTHER) })
    act(() => { result.current.onMoveConfirm() })

    expect(persistence.moves).toEqual([[testKey('note.md'), otherKey('note.md'), expect.stringContaining('title:')]])
    expect(result.current.pendingMove).toBeNull()
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '/entry/$vault/$slug',
      params: { vault: OTHER, slug: 'note.md' },
      replace: true,
    }))
  })

  it('cancelling leaves the entry where it was', () => {
    const occ = seedTwoVaults()
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.onVaultChange?.(OTHER) })
    act(() => { result.current.onMoveCancel() })

    expect(result.current.pendingMove).toBeNull()
    expect(persistence.moves).toEqual([])
    expect(useStore.getState().roots.has(testKey('note.md'))).toBe(true)
  })

  it('flushes a pending body edit before counting, so a just-typed link is included', () => {
    const occ = seedTwoVaults()
    const roots = new Map(useStore.getState().roots)
    roots.set(testKey('other-note'), { title: 'Other', tags: [], items: [], vaultId: TEST_VAULT, fileSlug: 'other-note' })
    act(() => { useStore.getState().setData(entriesOf(useStore.getState().items, roots)) })

    const { result } = renderHook(() => useEntryEditor(occ))
    act(() => { result.current.scheduleAutoSave('see [[other-note]]') })
    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({ outbound: 1 })
  })

  it('warns when the target vault already owns the slug', () => {
    const occ = seedTwoVaults()
    const roots = new Map(useStore.getState().roots)
    roots.set(otherKey('note.md'), { title: 'Theirs', tags: [], items: [], vaultId: OTHER, fileSlug: 'note.md' })
    act(() => { useStore.getState().setData(entriesOf(useStore.getState().items, roots)) })

    const { result } = renderHook(() => useEntryEditor(occ))
    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toMatchObject({ slugTaken: true, toSlug: 'note.md-2' })
  })

  it('offers no move at all out of a non-writable vault', () => {
    const occ = makeOcc({ id: 'occ-1', entryKey: makeEntryKey('example', 'note.md'), metadata: { vaultId: 'example', fileSlug: 'note.md', participants: [], title: 'Standup', tags: [], items: [] } })
    const roots: Roots = new Map([[makeEntryKey('example', 'note.md'), { title: 'Note', tags: [], items: [], vaultId: 'example', fileSlug: 'note.md' }]])
    seedStore([occ], roots)
    useStore.setState({ vaults: [{ id: 'example', name: 'Tutorial', kind: 'example' }, ...VAULTS] })

    const { result } = renderHook(() => useEntryEditor(occ))

    expect(result.current.onVaultChange).toBeNull()
  })

  it('retargets rather than moves before the first save', () => {
    seedStore([], new Map())
    useStore.setState({ vaults: VAULTS })
    const { result } = renderHook(() => useEntryEditor(null))

    act(() => { result.current.onVaultChange?.(OTHER) })

    expect(result.current.pendingMove).toBeNull()
    expect(result.current.vaultId).toBe(OTHER)
    expect(persistence.moves).toEqual([])
  })
})
