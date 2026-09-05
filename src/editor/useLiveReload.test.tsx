// @vitest-environment jsdom
/**
 * What an open editor does when something else writes to the same entry.
 *
 * The writer these tests stand in for is a **second view of the same vault** —
 * another tab, or the installed PWA — whose cache writes reach this view's
 * store through `startCrossTabSync`. That listener's own wiring is pinned in
 * `storage/__tests__/sync.test.ts`; what it hands the editor is a changed
 * store, which is what these drive directly. A sync pulling another device's
 * change arrives identically, so these cover that too.
 *
 * The policy, in one line: adopt what only the other side moved, keep (and
 * report) what both sides moved, and never re-read the description under the
 * cursor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { useStore } from '@/store'
import type { Occurrence, Roots, StoreOcc } from '@/types'
import {
  setupStore, seedStore, entriesOf, installFakePersistence, makeRoots, testKey, TEST_VAULT,
} from '@/test-utils'
import { useEntryEditor } from './useEntryEditor'

const { navigateMock, backMock, warnMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(), backMock: vi.fn(), warnMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouter: () => ({ history: { back: backMock } }),
  }
})

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { warning: warnMock, error: vi.fn(), dismiss: vi.fn() }),
}))

setupStore()
const persistence = installFakePersistence()

const KEY = testKey('note.md')

/**
 * The stored occurrence, not the expanded one: `makeOcc`'s fixture metadata
 * carries the file-level fields an `Occurrence` has after expansion, and
 * `joinFileMeta` spreads the occurrence's metadata *over* the root's — so a
 * fixture that repeats `title` there would shadow every root change these
 * tests make. A real `StoreItem` carries occurrence-level fields only.
 */
const storeItem: StoreOcc = {
  date: '2026-06-15', time: '09:00', source: 'explicit',
  entryKey: KEY, id: 'occ-1', metadata: { participants: [], done: false },
}

/** The same occurrence as the editor receives it — file-level fields joined in. */
function expanded(title = 'Standup'): Occurrence {
  return {
    ...storeItem,
    metadata: { ...storeItem.metadata, vaultId: TEST_VAULT, fileSlug: 'note.md', title, tags: [], items: [] },
  }
}

/** A root carrying whatever the other view just wrote. */
function rootsWith(over: { title?: string; body?: string; tags?: string[] }): Roots {
  const roots = makeRoots('note.md')
  const root = roots.get(KEY)!
  roots.set(KEY, { ...root, title: 'Standup', ...over })
  return roots
}

/** The other view's write landing in this view's store, exactly as the
 *  cross-tab listener's `mergeChangedIntoStore` delivers it. */
function otherViewWrote(over: { title?: string; body?: string; tags?: string[] }): void {
  act(() => { useStore.getState().setData(entriesOf([storeItem], rootsWith(over))) })
}

/** This view's starting point: the entry as both views last agreed on it. */
function seedEntry(): void {
  seedStore([storeItem], rootsWith({}))
}

beforeEach(() => {
  navigateMock.mockClear()
  backMock.mockClear()
  warnMock.mockClear()
  vi.useFakeTimers()
})

afterEach(() => { vi.useRealTimers() })

describe('useEntryEditor — a change arriving from another view', () => {
  it('live-reloads a metadata field the user has not touched', () => {
    seedEntry()
    const { result } = renderHook(() => useEntryEditor(expanded()))
    expect(result.current.entry.title).toBe('Standup')

    otherViewWrote({ title: 'Standup (renamed elsewhere)' })

    expect(result.current.entry.title).toBe('Standup (renamed elsewhere)')
  })

  it('does not write an adopted field back out on the next save', () => {
    // The adoption advances the editor's base too. Without that, the adopted
    // value reads as something the user touched, and the save pushes it
    // straight back — a write nobody asked for, and a conflict on the next one.
    seedEntry()
    const { result } = renderHook(() => useEntryEditor(expanded()))

    otherViewWrote({ title: 'Standup (renamed elsewhere)', tags: ['work'] })
    act(() => { result.current.handleDoneToggle() })

    const written = persistence.contentByKey.get(KEY) ?? ''
    expect(written).toContain('done: true')
    expect(written).toContain('Standup (renamed elsewhere)')
  })

  it('keeps a field the user is editing, and says so', () => {
    seedEntry()
    const { result } = renderHook(() => useEntryEditor(expanded()))

    // An unsaved local edit: setEntry alone, the way typing in the title field
    // leaves the editor before its save runs.
    act(() => { result.current.setEntry({ ...result.current.entry, title: 'Standup (mine)' }) })
    otherViewWrote({ title: 'Standup (theirs)' })

    expect(result.current.entry.title).toBe('Standup (mine)')
    expect(warnMock).not.toHaveBeenCalled() // nothing is written yet, so nothing is lost yet

    act(() => { result.current.saveMeta(result.current.entry) })

    expect(persistence.contentByKey.get(KEY)).toContain('Standup (mine)')
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('the title'),
      expect.anything(),
    )
  })

  it('never re-reads the description under the cursor', () => {
    // A CodeMirror document with a cursor, a selection and an undo history in
    // it — see useLiveReload. The save is still correct without adopting it:
    // an untouched description is not written, so the other view's survives.
    seedEntry()
    const { result } = renderHook(() => useEntryEditor(expanded()))

    otherViewWrote({ body: 'a description the other view wrote' })

    expect(result.current.entry.body).toBe('')

    act(() => { result.current.handleDoneToggle() })
    expect(persistence.contentByKey.get(KEY)).toContain('a description the other view wrote')
  })

  it('reports both sides having typed prose, and keeps this one', () => {
    seedEntry()
    const { result } = renderHook(() => useEntryEditor(expanded()))

    act(() => { result.current.scheduleAutoSave('mine') })
    otherViewWrote({ body: 'theirs' })
    act(() => { vi.advanceTimersByTime(1500) })

    expect(persistence.contentByKey.get(KEY)).toContain('mine')
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('the description'),
      expect.anything(),
    )
  })

  // The survey's own repro, one layer up from the cache: the other view renames
  // the entry, this one appends to the body, and before the store was kept
  // coherent the rename was destroyed with no conflict and no message.
  it('keeps both views\' changes when they touched different things', () => {
    seedEntry()
    const { result } = renderHook(() => useEntryEditor(expanded()))

    otherViewWrote({ title: 'Standup (renamed by the other view)' })
    act(() => { result.current.scheduleAutoSave('and a line from this one') })
    act(() => { vi.advanceTimersByTime(1500) })

    const written = persistence.contentByKey.get(KEY) ?? ''
    expect(written).toContain('Standup (renamed by the other view)')
    expect(written).toContain('and a line from this one')
    expect(warnMock).not.toHaveBeenCalled()
  })
})
