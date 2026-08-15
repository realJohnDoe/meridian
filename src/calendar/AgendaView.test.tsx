// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import AgendaView from './AgendaView'
import { setupStore, seedStore, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import { useStore } from '@/store'
import { calendarView, resetCalendarOnVaultChange } from './viewState'
import type { Occurrence } from '@/types'

setupStore()

/**
 * The overdue section ships expanded (viewState.ts), so its occurrence rows
 * render by default. Only the test about collapsing needs this.
 */
const collapseOverdue = () => { calendarView.setState({ overdueCollapsed: true }) }

// The agenda's scroll offset/target and its cached row grouping are
// module-level state (see viewState.ts, useAgendaSections.ts), not reset by
// render() alone. Without clearing them, a later test can inherit an earlier
// test's post-scroll agendaScrollOffset (scrollTarget cleared to null on the
// first scroll) instead of getting its own fresh scroll-to-today — harmless
// with the old, tiny per-test row lists, but the agenda's row list always
// spans the full ~455-day window now, so landing on a carried-over offset
// lands nowhere near the row this test actually seeded.
beforeEach(() => {
  resetCalendarOnVaultChange()
})

// @tanstack/react-virtual measures the scroll element once via offsetWidth/
// offsetHeight (see virtual-core's `getRect`), which jsdom leaves at 0 — with
// a zero-height viewport the virtualizer computes an empty visible range and
// renders nothing, no matter how many rows exist. Give the scroll container a
// real viewport-sized box so the visible range actually covers the rows under
// test.
//
// Individual rows get a plausible non-zero size too (not the container's
// 600), rather than jsdom's default 0: `measureElement` overwrites each row's
// *estimated* size with whatever it measures once mounted, and since the
// agenda's row list now always spans the full ~455-day window (dozens of
// month/week dividers ahead of any actual content — see agendaSections.ts),
// a mounted-but-measured-as-0 row makes the "fill the viewport" pass think it
// still has 600px left to cover no matter how many rows it adds, sweeping
// past the intended target all the way to the end of the list. A uniform,
// roughly-realistic per-row size keeps that pass converging near the actual
// scroll target instead.
//
// Unlike FileResultsList, AgendaView owns its own scroll container, so its ref
// is attached before its own virtualizer's layout effect runs — no
// mount-empty-then-rerender dance is needed here.
let offsetHeightDescriptor: PropertyDescriptor | undefined
let offsetWidthDescriptor: PropertyDescriptor | undefined
let animateDescriptor: PropertyDescriptor | undefined

const isScrollContainer = (el: HTMLElement) => el.classList.contains('overflow-y-auto')

beforeEach(() => {
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  offsetWidthDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true, get(this: HTMLElement) { return isScrollContainer(this) ? 600 : 50 },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true, get(this: HTMLElement) { return isScrollContainer(this) ? 600 : 320 },
  })
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
    entryKey: testKey('note.md'),
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: `Overdue task ${i}`, tags: [], items: [], done: false },
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
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([task], makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('Pay the invoice')).toBeInTheDocument()
  })

  it('expands the overdue section by default, mounting its rows', () => {
    const occs = Array.from({ length: 20 }, (_, i) => overdueTask(i))
    seedStore(occs, makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    // The count rides beside the label rather than inside it, so the divider
    // still reads exactly "Overdue".
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(renderedCards().length).toBeGreaterThan(0)

    // …and one tap folds it away to just the bar.
    fireEvent.click(screen.getByRole('button', { expanded: true }))

    expect(renderedCards()).toHaveLength(0)
  })

  it('renders only the header once the user collapses the overdue section', () => {
    const occs = Array.from({ length: 20 }, (_, i) => overdueTask(i))
    seedStore(occs, makeRoots('note.md'))
    collapseOverdue()

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(renderedCards()).toHaveLength(0)
  })

  it('calls onOpen with the occurrence when a row is clicked', () => {
    const task = makeOcc({
      id: 'overdue-1',
      date: fmtISO(addDays(today, -3)),
      time: null,
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([task], makeRoots('note.md'))

    const onOpen = vi.fn()
    render(<AgendaView onOpen={onOpen} />)

    fireEvent.click(screen.getByLabelText('Pay the invoice'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ id: 'overdue-1' })
  })

  it("highlights today's own badge, replacing the old per-day text header", () => {
    seedStore([makeOcc({ id: 'today-1', date: fmtISO(today), time: '09:00' })], makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Standup')).toBeInTheDocument()
    // Several months' badges can share the same day-of-month number, so find
    // the one carrying the "today" highlight rather than assuming uniqueness.
    const dayNumbers = screen.getAllByText(String(today.getDate()))
    expect(dayNumbers.some(el => el.className.includes('bg-primary'))).toBe(true)
  })

  // Hiding tasks drops the whole overdue section — a block of rows that can
  // sit above whatever day the user is currently looking at. Left alone, the
  // virtualizer's scroll offset would still point at the same pixel position,
  // now against a shorter list, landing on a different day than before the
  // toggle. AgendaView must re-anchor on the day already showing instead.
  it('keeps the agenda anchored on the day already showing when the filter changes, instead of resetting to today', () => {
    seedStore([overdueTask(0)], makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    // Simulate the user having already scrolled away from today — currentDate
    // tracks the agenda's own scroll position (see markAgendaScrolled), and a
    // day 30 days out is still well inside the default +90 day window.
    const awayDate = fmtISO(addDays(today, 30))
    act(() => { calendarView.setState({ currentDate: awayDate }) })

    act(() => { useStore.getState().toggleShowTasks() })

    // Re-centered on the day the user was actually looking at, not snapped
    // back to today.
    expect(calendarView.getState().agendaAnchor).toBe(awayDate)
    expect(calendarView.getState().agendaScrollTarget).toBeNull()
  })
})
