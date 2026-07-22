// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { beginSwipeDelete } from './occurrenceActions'
import { Toaster } from '@/components/ui/sonner'
import { useStore } from '@/store'
import { setupStore, seedStore, installFakePersistence, makeOcc, makeSeries, makeRoots } from '@/test-utils'
import type { Roots, StoreItem } from '@/types'

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
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()

    expect(items().find(i => i.id === 'occ-1')).toBeUndefined()
    expect(persistence.deletes).toEqual([])
    expect(screen.getByText('Deleted: Standup')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.deletes).toEqual(['note.md'])
  })

  it('Undo restores the snapshot and the deferred commit never persists', () => {
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(items().find(i => i.id === 'occ-1')).toBeDefined()

    act(() => { vi.advanceTimersByTime(5000) })

    expect(persistence.deletes).toEqual([])
    expect(persistence.writes).toEqual([])
  })

  it('excludes (not deletes) a recurring occurrence and writes the file on auto-close', () => {
    const series = makeSeries({ id: 'series-1', fileSlug: 'note.md', repeat: { type: 'schedule', freq: 'daily' } })
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', ownerId: 'series-1' })
    seedStore([series], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()

    expect(findOverrideFor('series-1')?.excluded).toBe(true)
    expect(persistence.writes).toEqual([])

    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.writes).toEqual(['note.md'])
    expect(persistence.deletes).toEqual([])
  })

  it('Undo on a recurring occurrence restores the un-excluded snapshot', () => {
    const series = makeSeries({ id: 'series-1', fileSlug: 'note.md', repeat: { type: 'schedule', freq: 'daily' } })
    const occ = makeOcc({ id: 'occ-1', fileSlug: 'note.md', ownerId: 'series-1' })
    seedStore([series], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(items()).toEqual([series])

    act(() => { vi.advanceTimersByTime(5000) })

    expect(persistence.writes).toEqual([])
    expect(persistence.deletes).toEqual([])
  })

  it('a second delete fires the first pending commit immediately, before any timer advances', () => {
    const a = makeOcc({ id: 'occ-a', fileSlug: 'a.md', metadata: { participants: [], title: 'A', tags: [], items: [] } })
    const b = makeOcc({ id: 'occ-b', fileSlug: 'b.md', metadata: { participants: [], title: 'B', tags: [], items: [] } })
    const roots: Roots = makeRoots('a.md', { title: 'A' })
    roots.set('b.md', { title: 'B', tags: [], items: [] })
    seedStore([a, b], roots)
    render(<Toaster />)

    const applyA = beginSwipeDelete(a)
    act(() => applyA())
    expect(persistence.deletes).toEqual([])

    let applyB!: () => void
    act(() => { applyB = beginSwipeDelete(b) })
    expect(persistence.deletes).toEqual(['a.md'])

    act(() => applyB())
    act(() => { vi.advanceTimersByTime(4100) })

    expect(persistence.deletes).toEqual(['a.md', 'b.md'])
  })

  it('deleting the last open occurrence of an after_completion series warns that it ends the series', () => {
    const series = makeSeries({ id: 'series-1', fileSlug: 'note.md', repeat: { type: 'after_completion', interval: '1 day' } })
    const occ = makeOcc({
      id: 'occ-1', fileSlug: 'note.md', ownerId: 'series-1',
      metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false },
    })
    seedStore([series], makeRoots('note.md'))
    render(<Toaster />)

    const apply = beginSwipeDelete(occ)
    act(() => apply())
    flushToastMount()

    expect(screen.getByText(/this series only repeats after completion/)).toBeInTheDocument()
  })
})
