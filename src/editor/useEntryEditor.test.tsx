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

  it('a new entry with a title commits on mount and navigates to it', () => {
    const { result } = renderHook(() => useEntryEditor(null, 'single', 'My New Task'))
    const slug = titleToSlug('My New Task')

    expect(persistence.writes).toEqual([slug])
    expect(navigateMock).toHaveBeenCalledWith({ to: '/entry/$slug', params: { slug }, replace: true })
    expect(result.current.entry.item).toBeNull()
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
})
