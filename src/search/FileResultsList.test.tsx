// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import FileResultsList from './FileResultsList'
import { setupStore, seedStore, makeOcc, makeRoots } from '@/test-utils'
import type { Roots } from '@/types'

setupStore()

// @tanstack/react-virtual measures the scroll element once via offsetWidth/
// offsetHeight (see virtual-core's `getRect`), which jsdom leaves at 0 —
// with a zero-height viewport the virtualizer computes an empty visible
// range and renders nothing, no matter how many results exist. Give every
// element a real viewport-sized box so the visible range actually covers
// the rows under test.
let offsetHeightDescriptor: PropertyDescriptor | undefined
let offsetWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  vi.useFakeTimers()
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  offsetWidthDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 })
})

afterEach(() => {
  vi.useRealTimers()
  if (offsetHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor)
  if (offsetWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor)
})

/**
 * Mounts with an empty query, then types the real one via `rerender`.
 *
 * Mounting directly with a non-empty query defeats the virtualizer: its
 * scroll-element subscription is set up in a layout effect on `FileResultsList`
 * (a *descendant* of the ref'd scroll container), and React runs descendant
 * layout effects before the ancestor's ref is attached — so on the very first
 * commit `getScrollElement()` still reads null and the subscription attempt is
 * dropped. It only reconnects on a later render, which "mount empty, then
 * type" naturally provides (and mirrors how the search box is actually used —
 * nobody opens it pre-filled).
 */
function renderList() {
  const scrollRef = createRef<HTMLDivElement>()
  const onOpen = vi.fn()
  const { container, rerender } = render(
    <div ref={scrollRef}>
      <FileResultsList query="" onOpen={onOpen} scrollRef={scrollRef} />
    </div>,
  )
  function type(query: string) {
    rerender(
      <div ref={scrollRef}>
        <FileResultsList query={query} onOpen={onOpen} scrollRef={scrollRef} />
      </div>,
    )
  }
  return { onOpen, container, type }
}

function flushDebounce() {
  act(() => { vi.advanceTimersByTime(150) })
}

describe('FileResultsList', () => {
  it('renders nothing for an empty query', () => {
    const occ = makeOcc({ fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { container } = renderList()
    flushDebounce()
    expect(container.firstChild).toBeEmptyDOMElement()
  })

  it('shows a matching file after the debounce settles', () => {
    const occ = makeOcc({ fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderList()

    type('stand')
    expect(screen.queryByText('Standup')).not.toBeInTheDocument() // not yet — debounce hasn't settled

    flushDebounce()

    expect(screen.getByText('Standup')).toBeInTheDocument()
  })

  it('excludes files that do not match the query', () => {
    const occ = makeOcc({ fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderList()

    type('zzz')
    flushDebounce()

    expect(screen.queryByText('Standup')).not.toBeInTheDocument()
  })

  it('matches against tags and items, not just the title', () => {
    // The rendered card's title comes from the resolved occurrence (`fom`), which joins
    // the item's own metadata over the root's — so the item's title must agree with the
    // root's for this test to observe a single, unambiguous title. The match itself,
    // though, is filtered from `fileEntries(roots)`, i.e. root-level tags/items/title.
    const occ = makeOcc({ fileSlug: 'note.md', metadata: { participants: [], title: 'Groceries', tags: ['urgent'], items: [] } })
    const roots: Roots = makeRoots('note.md', { title: 'Groceries', tags: ['urgent'] })
    seedStore([occ], roots)
    const { type } = renderList()

    type('urgent')
    flushDebounce()

    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('ranks a prefix match above a scattered subsequence match', () => {
    const a = makeOcc({ id: 'a', fileSlug: 'a.md', metadata: { participants: [], title: 'Xylophone practice', tags: [], items: [] } })
    const b = makeOcc({ id: 'b', fileSlug: 'b.md', metadata: { participants: [], title: 'Practice notes', tags: [], items: [] } })
    const roots: Roots = makeRoots('a.md', { title: 'Xylophone practice' }) // 'p...r...a...c' scattered match for "pra"
    roots.set('b.md', { title: 'Practice notes', tags: [], items: [] })     // starts with "pra" -> scoreQuery prefix bonus
    seedStore([a, b], roots)
    const { type, container } = renderList()

    type('pra')
    flushDebounce()

    const titles = [...container.querySelectorAll('.text-sm.font-medium')].map(el => el.textContent)
    expect(titles).toEqual(['Practice notes', 'Xylophone practice'])
  })

  it('shows one card per file even when a file has multiple occurrences', () => {
    const a = makeOcc({ id: 'a', fileSlug: 'note.md', date: '2026-06-15' })
    const b = makeOcc({ id: 'b', fileSlug: 'note.md', date: '2026-06-16' })
    seedStore([a, b], makeRoots('note.md', { title: 'Standup' }))
    const { type, container } = renderList()

    type('stand')
    flushDebounce()

    expect(container.querySelectorAll('[data-tour="entry-card"]')).toHaveLength(1)
  })

  it('calls onOpen with the underlying occurrence when a result is clicked', () => {
    const occ = makeOcc({ fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type, onOpen } = renderList()

    type('stand')
    flushDebounce()
    fireEvent.click(screen.getByRole('button', { name: 'Standup' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ fileSlug: 'note.md' }))
  })

  it('shows backlinking file titles as listed-on chips', () => {
    // backlinks is derived from roots' wikilinks (buildBacklinkIndex), not directly
    // settable — other.md "links to" note.md via a wikilink in its own items.
    const occ = makeOcc({ fileSlug: 'note.md' })
    const roots: Roots = makeRoots('note.md', { title: 'Standup' })
    roots.set('other.md', { title: 'Linked From', tags: [], items: ['[[note.md]]'] })
    seedStore([occ], roots)
    const { type } = renderList()

    type('stand')
    flushDebounce()

    expect(screen.getByText('Linked From')).toBeInTheDocument()
  })
})
