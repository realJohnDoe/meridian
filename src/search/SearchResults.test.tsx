// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SearchResults, { type SearchRow } from './SearchResults'
import { setupStore, seedStore, makeOcc, makeRoots, testKey } from '@/test-utils'

setupStore()

// Same @tanstack/react-virtual jsdom workaround as FileResultsList.test.tsx —
// see the comment there for why both the offsetHeight stub and the
// mount-empty-then-type render pattern are needed to see FileResultsList's
// (nested inside SearchResults) rendered rows.
let offsetHeightDescriptor: PropertyDescriptor | undefined
let offsetWidthDescriptor: PropertyDescriptor | undefined
let clientHeightDescriptor: PropertyDescriptor | undefined
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  vi.useFakeTimers()
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
  vi.useRealTimers()
  if (offsetHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor)
  if (offsetWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor)
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
  if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
})

function renderResults(highlightedIndex = -1) {
  const scrollRef = createRef<HTMLDivElement>()
  const onOpen = vi.fn()
  const onCreate = vi.fn()
  const onRowsChange = vi.fn<(rows: SearchRow[], defaultIndex: number) => void>()
  const { rerender } = render(
    <div ref={scrollRef}>
      <SearchResults query="" onOpen={onOpen} onCreate={onCreate} scrollRef={scrollRef} highlightedIndex={highlightedIndex} onRowsChange={onRowsChange} />
    </div>,
  )
  function type(query: string) {
    rerender(
      <div ref={scrollRef}>
        <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} scrollRef={scrollRef} highlightedIndex={highlightedIndex} onRowsChange={onRowsChange} />
      </div>,
    )
  }
  return { onOpen, onCreate, onRowsChange, type }
}

function flushDebounce() {
  act(() => { vi.advanceTimersByTime(150) })
}

describe('SearchResults', () => {
  it('hides the Create row when the query is empty', () => {
    renderResults()
    expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument()
  })

  it('shows a Create row for the current query and calls onCreate when clicked', () => {
    const { type, onCreate } = renderResults()
    type('New idea')

    fireEvent.click(screen.getByRole('option', { name: 'Create "New idea"' }))

    expect(onCreate).toHaveBeenCalledWith('New idea')
  })

  it('renders matching file results from the nested FileResultsList', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderResults()

    type('stand')
    flushDebounce()

    expect(screen.getByText('Standup')).toBeInTheDocument()
  })

  it('calls onOpen with the occurrence when a result is clicked', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type, onOpen } = renderResults()

    type('stand')
    flushDebounce()
    fireEvent.click(screen.getByRole('button', { name: 'Standup' }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entryKey: testKey('note.md') }))
  })

  // See issue #1124: Enter must land on an exact title match rather than
  // always creating a duplicate — this is the row-reporting half of that fix.
  // The combined row list is [Create, ...results], so an exact match at
  // results[0] defaults to combined index 1.
  it('reports the exact title match as the default highlighted row', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Morning Run' }))
    const { type, onRowsChange } = renderResults()

    type('Morning Run')
    flushDebounce()

    const [rows, defaultIndex] = onRowsChange.mock.calls.at(-1)!
    expect(defaultIndex).toBe(1)
    expect(rows[1]!.entryKey).toBe(testKey('note.md'))
  })

  // Mobile hazard from the issue: with no exact match, Enter on a phone
  // keyboard must still create rather than landing on some fuzzy result.
  it('defaults to the Create row when there is no exact title match', () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Morning Run' }))
    const { type, onRowsChange } = renderResults()

    type('Morning') // matches "Morning Run" but isn't exactly it
    flushDebounce()

    const [, defaultIndex] = onRowsChange.mock.calls.at(-1)!
    expect(defaultIndex).toBe(0)
  })

  it("activating a reported result row opens its occurrence, and the Create row's creates", () => {
    const occ = makeOcc({ entryKey: testKey('note.md') })
    seedStore([occ], makeRoots('note.md', { title: 'Morning Run' }))
    const { type, onOpen, onCreate, onRowsChange } = renderResults()

    type('Morning Run')
    flushDebounce()

    const [rows] = onRowsChange.mock.calls.at(-1)!
    rows[1]!.activate()
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entryKey: testKey('note.md') }))

    rows[0]!.activate()
    expect(onCreate).toHaveBeenCalledWith('Morning Run')
  })

  it('rings the Create row when it is the highlighted index', () => {
    const { type } = renderResults(0)
    type('New idea')

    expect(screen.getByRole('option', { name: 'Create "New idea"' }).className).toMatch(/ring-2/)
  })
})
