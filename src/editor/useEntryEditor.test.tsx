// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type * as ReactRouter from '@tanstack/react-router'
import { titleToSlug } from '@/fileIO'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeRoots } from '@/test-utils'
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
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.handleDoneToggle() })

    expect(persistence.writes).toEqual(['note.md'])
    expect(result.current.entry.done).toBe(true)
  })

  it('autosave debounces body writes by 1500ms and commits the latest scheduled body', () => {
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft 1') })
    act(() => { vi.advanceTimersByTime(700) })
    act(() => { result.current.scheduleAutoSave('draft 2') }) // resets the debounce timer
    act(() => { vi.advanceTimersByTime(1499) })
    expect(persistence.writes).toEqual([])

    act(() => { vi.advanceTimersByTime(1) })

    expect(persistence.writes).toEqual(['note.md'])
    expect(useStore.getState().roots.get('note.md')?.body).toBe('draft 2')
  })

  it('a scheduled autosave commits against the latest entry state, not a stale snapshot', () => {
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false } })
    seedStore([occ], makeRoots('note.md'))
    const { result } = renderHook(() => useEntryEditor(occ))

    act(() => { result.current.scheduleAutoSave('draft') })
    act(() => { result.current.handleDoneToggle() }) // synchronous meta save, before the autosave timer fires
    act(() => { vi.advanceTimersByTime(1500) })

    expect(persistence.writes).toEqual(['note.md', 'note.md'])
    expect(useStore.getState().roots.get('note.md')?.body).toBe('draft')
    const saved = useStore.getState().items.find(i => i.id === 'occ-1') as { metadata: { done?: boolean } } | undefined
    expect(saved?.metadata.done).toBe(true)
  })

  it('a new entry with a title commits on mount without navigating away', () => {
    const { result } = renderHook(() => useEntryEditor(null, 'single', 'My New Task'))
    const slug = titleToSlug('My New Task')

    expect(persistence.writes).toEqual([slug])
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
    const slug = titleToSlug('Board game night')

    expect(useStore.getState().items.filter(i => i.fileSlug === slug)).toHaveLength(1)

    act(() => { result.current.handleDoneToggle() })

    expect(useStore.getState().items.filter(i => i.fileSlug === slug)).toHaveLength(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('editScope "add" suppresses both the meta save and the autosave', () => {
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false } })
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
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false } })
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
