// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgendaView from './AgendaView'
import { setupStore, seedStore, makeOcc, makeRoots } from '@/test-utils'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import type { Occurrence } from '@/types'

setupStore()

// @tanstack/react-virtual measures the scroll element once via offsetWidth/
// offsetHeight (see virtual-core's `getRect`), which jsdom leaves at 0 — with
// a zero-height viewport the virtualizer computes an empty visible range and
// renders nothing, no matter how many rows exist. Give every element a real
// viewport-sized box so the visible range actually covers the rows under test.
//
// Unlike FileResultsList, AgendaView owns its own scroll container, so its ref
// is attached before its own virtualizer's layout effect runs — no
// mount-empty-then-rerender dance is needed here.
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

const today = new Date()

/** An undone task N days in the past — i.e. one that lands in the overdue section. */
function overdueTask(i: number): Occurrence {
  const date = fmtISO(addDays(today, -(1 + (i % 300))))
  return makeOcc({
    id: `overdue-${i}`,
    date,
    time: null,
    fileSlug: 'note.md',
    metadata: { participants: [], title: `Overdue task ${i}`, tags: [], items: [], done: false },
  })
}

/** Every rendered occurrence card — SurfaceButton carries aria-label={title}. */
const renderedCards = () => screen.getAllByRole('button').filter(el => el.getAttribute('aria-label'))

describe('AgendaView', () => {
  it('mounts only a viewport-sized window of rows, not the whole overdue section', () => {
    const occs = Array.from({ length: 500 }, (_, i) => overdueTask(i))
    seedStore(occs, makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    // The overdue section holds all 500, but virtualization is row-granular:
    // only the 600px viewport plus overscan may mount (observed: 8). Under
    // the previous section-granular virtualizer all 500 mounted in a single
    // synchronous commit the moment the section entered the viewport — on a
    // real vault that was ~6,900 rows and a multi-second freeze.
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    const mounted = renderedCards().length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(40)
  })

  it('renders the overdue header and its task titles', () => {
    const task = makeOcc({
      id: 'overdue-1',
      date: fmtISO(addDays(today, -3)),
      time: null,
      metadata: { participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([task], makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('Pay the invoice')).toBeInTheDocument()
  })

  it('calls onOpen with the occurrence when a row is clicked', () => {
    const task = makeOcc({
      id: 'overdue-1',
      date: fmtISO(addDays(today, -3)),
      time: null,
      metadata: { participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([task], makeRoots('note.md'))

    const onOpen = vi.fn()
    render(<AgendaView onOpen={onOpen} />)

    fireEvent.click(screen.getByLabelText('Pay the invoice'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ id: 'overdue-1' })
  })

  it('labels today\'s header "Today"', () => {
    seedStore([makeOcc({ id: 'today-1', date: fmtISO(today), time: '09:00' })], makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Standup')).toBeInTheDocument()
  })
})
