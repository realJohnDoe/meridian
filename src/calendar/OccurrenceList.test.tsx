// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OccurrenceList from './OccurrenceList'
import { setupStore, makeOcc, TEST_VAULT } from '@/test-utils'
import type { Occurrence } from '@/types'

setupStore()

// @tanstack/react-virtual measures the scroll element once via offsetWidth/
// offsetHeight (see virtual-core's `getRect`), which jsdom leaves at 0 — with
// a zero-height viewport the virtualizer computes an empty visible range and
// renders nothing, no matter how many rows exist. Give every element a real
// viewport-sized box so the visible range actually covers the rows under test.
//
// Like AgendaView (and unlike FileResultsList), OccurrenceList owns its own
// scroll container, so its ref is attached before its own virtualizer's layout
// effect runs — no mount-empty-then-rerender dance is needed here.
let offsetHeightDescriptor: PropertyDescriptor | undefined
let offsetWidthDescriptor: PropertyDescriptor | undefined
let animateDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  offsetWidthDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 })
  // jsdom has no Web Animations API. useVirtualFlip feature-detects and skips
  // without it, but stub it anyway so these tests exercise the real path
  // rather than passing only because the glide was skipped.
  animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true, writable: true, value: () => ({ cancel: () => {} }),
  })
})

afterEach(() => {
  if (offsetHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor)
  if (offsetWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor)
  if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor)
  else delete (Element.prototype as { animate?: unknown }).animate
})

function baseProps(occs: Occurrence[]) {
  return {
    occs,
    onOpen: vi.fn(),
    onToggleDone: vi.fn(),
    onSwipeDelete: vi.fn(() => vi.fn()),
  }
}

/** An undated task, i.e. the kind BacklogView pools without a bound. */
function undatedTask(i: number, done = false): Occurrence {
  return makeOcc({
    id: `task-${i}`,
    time: null,
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: `Task ${i}`, tags: [], items: [], done },
  })
}

/** Every rendered occurrence card — SurfaceButton carries aria-label={title}. */
const renderedCards = () => screen.getAllByRole('button').filter(el => el.getAttribute('aria-label'))

describe('OccurrenceList', () => {
  it('shows active items immediately', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Open task', tags: [], items: [], done: false } })
    render(<OccurrenceList {...baseProps([occ])} />)

    expect(screen.getByText('Open task')).toBeInTheDocument()
  })

  it('omits the Done section entirely when there are no done items', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Open task', tags: [], items: [], done: false } })
    render(<OccurrenceList {...baseProps([occ])} />)

    expect(screen.queryByText(/^Done ·/)).not.toBeInTheDocument()
  })

  it('hides done items behind a collapsed Done section, revealed on click', () => {
    const open = makeOcc({ id: 'a', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Open task', tags: [], items: [], done: false } })
    const done = makeOcc({ id: 'b', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Finished task', tags: [], items: [], done: true } })
    render(<OccurrenceList {...baseProps([open, done])} />)

    expect(screen.getByText('Open task')).toBeInTheDocument()
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument()
    expect(screen.getByText('Done · 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Done · 1'))

    expect(screen.getByText('Finished task')).toBeInTheDocument()
  })

  it('calls onToggleDone when a row checkbox is clicked', () => {
    const onToggleDone = vi.fn()
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Open task', tags: [], items: [], done: false } })
    render(<OccurrenceList {...baseProps([occ])} onToggleDone={onToggleDone} />)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onToggleDone).toHaveBeenCalledWith(occ)
  })

  it('mounts only a viewport-sized window of rows, not the whole list', () => {
    const occs = Array.from({ length: 500 }, (_, i) => undatedTask(i))
    render(<OccurrenceList {...baseProps(occs)} />)

    // The backlog holds all 500, but virtualization is row-granular: only the
    // 600px viewport plus overscan may mount. Unvirtualized, all 500 mounted
    // in one synchronous commit — each AgendaRow carrying three raw touch
    // listeners, two store subscriptions and a backlink lookup.
    const mounted = renderedCards().length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(40)
    expect(screen.getByText('Task 0')).toBeInTheDocument()
    expect(screen.queryByText('Task 499')).not.toBeInTheDocument()
  })

  it('keeps the expanded Done section windowed too', () => {
    const occs = [
      ...Array.from({ length: 5 }, (_, i) => undatedTask(i)),
      ...Array.from({ length: 500 }, (_, i) => undatedTask(1000 + i, true)),
    ]
    render(<OccurrenceList {...baseProps(occs)} />)

    fireEvent.click(screen.getByText('Done · 500'))

    // Expanding appends the done rows to the same virtual row list rather than
    // handing them to a Collapsible that would mount all 500 at once.
    expect(screen.getByText('Task 1000')).toBeInTheDocument()
    expect(renderedCards().length).toBeLessThan(40)
  })

  it('marks the Done toggle expanded only while it is open', () => {
    const open = makeOcc({ id: 'a', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Open task', tags: [], items: [], done: false } })
    const done = makeOcc({ id: 'b', metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Finished task', tags: [], items: [], done: true } })
    render(<OccurrenceList {...baseProps([open, done])} />)

    const toggle = screen.getByRole('button', { expanded: false })
    fireEvent.click(toggle)

    expect(screen.getByRole('button', { expanded: true })).toBe(toggle)
  })
})
