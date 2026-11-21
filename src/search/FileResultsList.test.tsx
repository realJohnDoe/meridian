// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FileResultsList, { type FileSearchResult } from './FileResultsList'
import { setupStore, seedStore, makeOcc, makeRoots, testKey, makeRootMeta, TEST_VAULT } from '@/test-utils'
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
let clientHeightDescriptor: PropertyDescriptor | undefined
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  offsetWidthDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 })
  // virtual-core's `getRect` reads clientWidth/clientHeight since 3.19; older releases read offset*.
  clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  clientWidthDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 600 })
})

afterEach(() => {
  if (offsetHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor)
  if (offsetWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor)
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
  if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
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
function renderList(highlightedEntryKey: string | null = null) {
  const scrollRef = createRef<HTMLDivElement>()
  const onOpen = vi.fn()
  const onResultsChange = vi.fn<(results: FileSearchResult[]) => void>()
  const { container, rerender } = render(
    <div ref={scrollRef}>
      <FileResultsList query="" onOpen={onOpen} scrollRef={scrollRef} highlightedEntryKey={highlightedEntryKey} onResultsChange={onResultsChange} />
    </div>,
  )
  function type(query: string) {
    rerender(
      <div ref={scrollRef}>
        <FileResultsList query={query} onOpen={onOpen} scrollRef={scrollRef} highlightedEntryKey={highlightedEntryKey} onResultsChange={onResultsChange} />
      </div>,
    )
  }
  return { onOpen, onResultsChange, container, type }
}

describe('FileResultsList', () => {
  it('renders nothing for an empty query', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { container } = renderList()
    expect(container.firstChild).toBeEmptyDOMElement()
  })

  it('shows a matching file', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderList()

    type('stand')


    expect(screen.getByText('Standup')).toBeInTheDocument()
  })

  it('excludes files that do not match the query', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderList()

    type('zzz')

    expect(screen.queryByText('Standup')).not.toBeInTheDocument()
  })

  it('matches against tags and items, not just the title', () => {
    // The rendered card's title comes from the resolved occurrence (`fom`), which joins
    // the item's own metadata over the root's — so the item's title must agree with the
    // root's for this test to observe a single, unambiguous title. The match itself,
    // though, is filtered from `fileEntries(roots)`, i.e. root-level tags/items/title.
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Groceries', tags: ['urgent'] } })
    const roots: Roots = makeRoots('note.md', { title: 'Groceries', tags: ['urgent'] })
    seedStore([occ], roots)
    const { type } = renderList()

    type('urgent')

    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('ranks title hits above tag hits above body hits', () => {
    const mk = (id: string, title: string) =>
      makeOcc({ id, entryKey: testKey(`${id}.md`), metadata: { vaultId: TEST_VAULT, fileSlug: `${id}.md`, title } })
    const occs = [mk('a', 'Alpha'), mk('b', 'Beta'), mk('c', 'Planning')]
    const roots: Roots = makeRoots('a.md', { title: 'Alpha', body: 'ship the plan' })
    roots.set(testKey('b.md'), makeRootMeta('b.md', { title: 'Beta', tags: ['plan'], items: [] }))
    roots.set(testKey('c.md'), makeRootMeta('c.md', { title: 'Planning', tags: [], items: [] }))
    seedStore(occs, roots)
    const { type, container } = renderList()

    type('plan')

    const titles = [...container.querySelectorAll('.text-sm.font-medium')].map(el => el.textContent)
    expect(titles).toEqual(['Planning', 'Beta', 'Alpha'])
  })

  it('finds a phrase from the body and shows the matching line, highlighted', () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Welcome' } })
    seedStore([occ], makeRoots('note.md', { title: 'Welcome', body: 'Intro\nkeeps tasks as plain Markdown files' }))
    const { type, container } = renderList()

    type('markdown')

    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(container.querySelector('mark')?.textContent).toBe('Markdown')
    expect(container.textContent).toContain('keeps tasks as plain')
  })

  it('does not match scattered letters', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Book a dentist appointment' }))
    const { type } = renderList()

    type('sam')

    expect(screen.queryByText('Book a dentist appointment')).not.toBeInTheDocument()
  })

  it('requires every query word and ignores case and accents', () => {
    const occ = makeOcc({ entryKey: testKey('note.md'), metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', title: 'Café Visit' } })
    seedStore([occ], makeRoots('note.md', { title: 'Café Visit', body: 'with Zoë' }))
    const { type } = renderList()

    type('CAFE zoe')
    expect(screen.getByText('Café Visit')).toBeInTheDocument()

    type('cafe nobody')
    expect(screen.queryByText('Café Visit')).not.toBeInTheDocument()
  })

  it('shows one card per file even when a file has multiple occurrences', () => {
    const a = makeOcc({ id: 'a', entryKey: testKey('note.md'), date: '2026-06-15' })
    const b = makeOcc({ id: 'b', entryKey: testKey('note.md'), date: '2026-06-16' })
    seedStore([a, b], makeRoots('note.md', { title: 'Standup' }))
    const { type, container } = renderList()

    type('stand')

    expect(container.querySelectorAll('[data-testid="entry-card"]')).toHaveLength(1)
  })

  it('calls onOpen with the underlying occurrence when a result is clicked', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type, onOpen } = renderList()

    type('stand')
    fireEvent.click(screen.getByRole('button', { name: 'Standup' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entryKey: testKey('note.md') }))
  })

  it('renders a card for an entry whose only occurrence is undated, instead of a blank row', () => {
    // The reported bug: an entry created from the search overlay whose root
    // landed in the store without an occurrence still matched the query, so
    // the virtualizer counted it and reserved a row — and then drew nothing,
    // leaving a gap between the "Create" row and the first real result.
    //
    // That store state is now unrepresentable (`Entry['items']` is non-empty),
    // and `fileOccurrenceMap` is total by construction rather than by a sweep
    // that synthesized a representative for root-only entries. What is left to
    // pin is the shape such an entry actually has: one undated occurrence,
    // which is what both the search overlay creates and what a file carrying
    // only file-level fields parses into. It must draw a card, not a gap.
    seedStore(
      [makeOcc({ id: 'occ-handy', entryKey: testKey('handy'), date: '', time: null, metadata: { title: 'handy', vaultId: TEST_VAULT, fileSlug: 'handy' } })],
      makeRoots('handy', { title: 'handy' }),
    )
    const { type, container } = renderList()

    type('handy')

    expect(container.querySelectorAll('[data-testid="entry-card"]')).toHaveLength(1)
    expect(screen.getByText('handy')).toBeInTheDocument()
  })

  it('shows backlinking file titles as listed-on chips', () => {
    // backlinks is derived from roots' wikilinks (buildBacklinkIndex), not directly
    // settable — other.md "links to" note.md via a wikilink in its own items.
    const occ = makeOcc({ entryKey: testKey('note.md') })
    const roots: Roots = makeRoots('note.md', { title: 'Standup' })
    roots.set(testKey('other.md'), makeRootMeta('other.md', { title: 'Linked From', tags: [], items: ['[[note.md]]'] }))
    // `other.md` needs an occurrence of its own: an entry is its root *and* its
    // occurrences, so a root on its own is no longer a state the store holds.
    seedStore([occ, makeOcc({ id: 'occ-other', entryKey: testKey('other.md') })], roots)
    const { type } = renderList()

    type('stand')

    expect(screen.getByText('Linked From')).toBeInTheDocument()
  })

  it('reports ranked results up via onResultsChange', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type, onResultsChange } = renderList()

    type('stand')

    const [results] = onResultsChange.mock.calls.at(-1)!
    expect(results).toHaveLength(1)
    expect(results[0]!.entry.entryKey).toBe(testKey('note.md'))
  })

  it('rings the row matching highlightedEntryKey', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderList(testKey('note.md'))

    type('stand')

    expect(document.getElementById(`search-option-${testKey('note.md')}`)?.className).toMatch(/ring-2/)
  })
})
