// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SearchResults from './SearchResults'
import { setupStore, seedStore, makeOcc, makeRoots } from '@/test-utils'

setupStore()

// Same @tanstack/react-virtual jsdom workaround as FileResultsList.test.tsx —
// see the comment there for why both the offsetHeight stub and the
// mount-empty-then-type render pattern are needed to see FileResultsList's
// (nested inside SearchResults) rendered rows.
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

function renderResults() {
  const scrollRef = createRef<HTMLDivElement>()
  const onOpen = vi.fn()
  const onCreate = vi.fn()
  const { rerender } = render(
    <div ref={scrollRef}>
      <SearchResults query="" onOpen={onOpen} onCreate={onCreate} scrollRef={scrollRef} />
    </div>,
  )
  function type(query: string) {
    rerender(
      <div ref={scrollRef}>
        <SearchResults query={query} onOpen={onOpen} onCreate={onCreate} scrollRef={scrollRef} />
      </div>,
    )
  }
  return { onOpen, onCreate, type }
}

function flushDebounce() {
  act(() => { vi.advanceTimersByTime(150) })
}

describe('SearchResults', () => {
  it('hides the Create row when the query is empty', () => {
    renderResults()
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument()
  })

  it('shows a Create row for the current query and calls onCreate when clicked', () => {
    const { type, onCreate } = renderResults()
    type('New idea')

    fireEvent.click(screen.getByRole('button', { name: 'Create "New idea"' }))

    expect(onCreate).toHaveBeenCalledWith('New idea')
  })

  it('renders matching file results from the nested FileResultsList', () => {
    const occ = makeOcc({ fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type } = renderResults()

    type('stand')
    flushDebounce()

    expect(screen.getByText('Standup')).toBeInTheDocument()
  })

  it('calls onOpen with the occurrence when a result is clicked', () => {
    const occ = makeOcc({ fileSlug: 'note.md' })
    seedStore([occ], makeRoots('note.md', { title: 'Standup' }))
    const { type, onOpen } = renderResults()

    type('stand')
    flushDebounce()
    fireEvent.click(screen.getByRole('button', { name: 'Standup' }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ fileSlug: 'note.md' }))
  })
})
