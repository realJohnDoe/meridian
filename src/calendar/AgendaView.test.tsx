// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import AgendaView from './AgendaView'
import { setupStore, seedStore, makeOcc, makeSeries, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import { useStore } from '@/store'
import { calendarView, resetCalendarOnVaultChange, requestScrollToToday } from './viewState'
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
// past the intended target all the way to the end of the list.
//
// Each row measures exactly what `estimateRow` predicts for its kind, read off
// the flip key's prefix. A single uniform size would also keep that pass
// converging, but it makes every row a 14–32px estimate miss, and a rebuild
// that inserts sixty rows then compounds those misses into hundreds of pixels
// of settling — churn a real build (where the estimates are tuned to the
// actual row heights) does not have. That noise swamps the scroll-anchoring
// assertions below, which are about *which row* the viewport holds.
//
// Unlike FileResultsList, AgendaView owns its own scroll container, so its ref
// is attached before its own virtualizer's layout effect runs — no
// mount-empty-then-rerender dance is needed here.
let offsetHeightDescriptor: PropertyDescriptor | undefined
let offsetWidthDescriptor: PropertyDescriptor | undefined
let animateDescriptor: PropertyDescriptor | undefined
let scrollTopDescriptor: PropertyDescriptor | undefined
let scrollToDescriptor: PropertyDescriptor | undefined

const isScrollContainer = (el: HTMLElement) => el.classList.contains('overflow-y-auto')

/**
 * What `estimateRow` predicts for the row this wrapper holds, keyed off the
 * flip key's prefix (see agendaSections.ts's row keys). Every occurrence row
 * these tests build carries a meta row — an overdue group row has `showDate`,
 * and every fixture occurrence carries a `time` — so they all take the
 * meta-height branch (ROW_H_META and OVERDUE_GROUP_H are the same 68).
 */
function estimatedRowHeight(el: HTMLElement): number {
  const key = el.querySelector('[data-flip-key]')?.getAttribute('data-flip-key') ?? ''
  if (key.startsWith('m|'))  return 60  // MONTH_H
  if (key.startsWith('w|'))  return 36  // WEEK_H
  if (key.startsWith('h|'))  return 40  // HEADER_H
  if (key.startsWith('e|'))  return 56  // EMPTY_H
  if (key.startsWith('og|')) return 68  // OVERDUE_GROUP_H
  return 68                             // ROW_H_META
}

/**
 * jsdom does no layout, so nothing the virtualizer needs to track a scroll
 * exists: `scrollTo` is not implemented at all (virtual-core calls it as
 * `scrollElement?.scrollTo?.()`, so it silently no-ops), `scrollTop` is
 * permanently 0, and `scrollHeight`/`clientHeight` are 0 — which makes
 * `getMaxScrollOffset()` 0 and clamps *every* `scrollToIndex` to offset 0.
 *
 * The pre-existing tests never noticed: with no scroll events, the virtualizer
 * keeps rendering from the seeded `initialOffset`. Anything that asserts on
 * scroll *behaviour* needs a viewport that actually scrolls, so give it one.
 *
 * The scroll event is dispatched in a microtask rather than synchronously
 * inside the setter — a browser never re-enters `scrollTo` with its own scroll
 * event, and doing so here made the virtualizer clamp its mount scroll to 0.
 * Tests therefore drive this with `await act(...)`.
 */
const scrollTops = new WeakMap<HTMLElement, number>()
let clientHeightDescriptor: PropertyDescriptor | undefined
let scrollHeightDescriptor: PropertyDescriptor | undefined

function installScrollShim(): void {
  // These four live on Element.prototype, not HTMLElement.prototype — getting
  // that wrong makes the afterEach restore a silent no-op and leaks the shim
  // into every later test in the run.
  scrollTopDescriptor    = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  scrollToDescriptor     = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo')
  clientHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  scrollHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')

  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return isScrollContainer(this) ? 600 : 0 },
  })
  // The virtualizer sizes its own inner spacer to getTotalSize(), so reading
  // that back is exactly the scrollHeight a browser would report.
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const sizer = this.querySelector<HTMLElement>('[style*="position: relative"]')
      return sizer ? Number.parseFloat(sizer.style.height) || 0 : 0
    },
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) { return scrollTops.get(this) ?? 0 },
    set(this: HTMLElement, v: number) {
      scrollTops.set(this, Math.max(0, v))
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')))
    },
  })
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true, writable: true,
    value(this: HTMLElement, opts?: { top?: number }) {
      if (typeof opts?.top === 'number') this.scrollTop = opts.top
    },
  })
}

function restoreScrollShim(): void {
  const restore = (name: string, d: PropertyDescriptor | undefined) => {
    if (d) Object.defineProperty(Element.prototype, name, d)
    else delete (Element.prototype as unknown as Record<string, unknown>)[name]
  }
  restore('scrollTop', scrollTopDescriptor)
  restore('scrollTo', scrollToDescriptor)
  restore('clientHeight', clientHeightDescriptor)
  restore('scrollHeight', scrollHeightDescriptor)
}

/** The agenda's scroll container — the element the virtualizer drives. */
const scrollContainer = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.overflow-y-auto')
  if (!el) throw new Error('agenda scroll container not found')
  return el
}

beforeEach(() => {
  installScrollShim()
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  offsetWidthDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (isScrollContainer(this)) return 600
      return this.hasAttribute('data-index') ? estimatedRowHeight(this) : 50
    },
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
  restoreScrollShim()
})

const today = new Date()

/**
 * An undone task N days in the past. It contributes two kinds of row now: one
 * on its own past day, and one grouped row in the overdue block (see
 * overduePool.ts) — before grouping, the day row did not exist at all.
 *
 * Timed so its day row takes the same meta-height branch the harness above
 * measures; an untimed one estimates 50 and would measure 68.
 */
function overdueTask(i: number): Occurrence {
  const date = fmtISO(addDays(today, -(1 + (i % 300))))
  return makeOcc({
    id: `overdue-${i}`,
    date,
    time: '09:00',
    entryKey: testKey('note.md'),
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: `Overdue task ${i}`, tags: [], items: [], done: false },
  })
}

/** Every rendered occurrence card — SurfaceButton carries aria-label={title}. */
const renderedCards = () => screen.getAllByRole('button').filter(el => el.getAttribute('aria-label'))

/**
 * The overdue block's grouped rows. Their flat-list keys are the only ones
 * prefixed `og|` (see overdueGroupRows in agendaSections.ts), and AgendaView
 * puts that key on each row's flip wrapper — so this distinguishes them from
 * the same task's row on its own past day, which renders an identical card.
 */
const overdueGroupRows = () => [...document.querySelectorAll<HTMLElement>('[data-flip-key^="og|"]')]

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

  it('renders the overdue header and its grouped task, and leaves the task on its own day', () => {
    const task = makeOcc({
      id: 'overdue-1',
      date: fmtISO(addDays(today, -3)),
      time: '09:00',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([task], makeRoots('note.md'))

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    // Twice: once summarised in the overdue block, once on 3 days ago — which
    // is where it can still be checked off or deleted individually.
    expect(screen.getAllByText('Pay the invoice')).toHaveLength(2)
    expect(overdueGroupRows()).toHaveLength(1)
    expect(within(overdueGroupRows()[0]!).getByText('Pay the invoice')).toBeInTheDocument()
  })

  it('shows a count on a group standing for more than one occurrence, and none on a single', () => {
    // Weekly from a fortnight ago: two overdue slots (-14, -7) plus today's,
    // which is not overdue. One series, one row, ×2.
    const weekly = makeSeries({
      id: 'series-a',
      date: fmtISO(addDays(today, -14)),
      time: '09:00',
      entryKey: testKey('plants.md'),
      repeat: { type: 'schedule', freq: 'weekly' },
      metadata: { participants: [], done: false },
    })
    const once = makeOcc({
      id: 'once-1',
      date: fmtISO(addDays(today, -2)),
      time: '09:00',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([weekly, once], new Map([
      ...makeRoots('note.md'),
      ...makeRoots('plants.md', { title: 'Water the plants' }),
    ]))

    render(<AgendaView onOpen={vi.fn()} />)

    // One row per series; the standalone is its own group and carries no count.
    expect(overdueGroupRows()).toHaveLength(2)
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.queryByText('×1')).not.toBeInTheDocument()
    // The header counts groups, not the three occurrences behind them.
    expect(screen.getByText('2')).toBeInTheDocument()
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

    // …and one tap folds it away to just the bar. The tasks' own past-day rows
    // are untouched by that — only the summary block collapses.
    fireEvent.click(screen.getByRole('button', { expanded: true }))

    expect(overdueGroupRows()).toHaveLength(0)
  })

  it('renders only the header once the user collapses the overdue section', () => {
    const occs = Array.from({ length: 20 }, (_, i) => overdueTask(i))
    seedStore(occs, makeRoots('note.md'))
    collapseOverdue()

    render(<AgendaView onOpen={vi.fn()} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(overdueGroupRows()).toHaveLength(0)
  })

  it('calls onOpen with the representative occurrence when an overdue group row is clicked', () => {
    const task = makeOcc({
      id: 'overdue-1',
      date: fmtISO(addDays(today, -3)),
      time: '09:00',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Pay the invoice', tags: [], items: [], done: false },
    })
    seedStore([task], makeRoots('note.md'))

    const onOpen = vi.fn()
    render(<AgendaView onOpen={onOpen} />)

    fireEvent.click(within(overdueGroupRows()[0]!).getByLabelText('Pay the invoice'))

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
})

/**
 * The reported "opens on today but jumps back in time a few seconds after".
 *
 * The virtualizer holds a raw scroll *pixel* offset. When rows appear above the
 * viewport after the agenda has already settled, that offset lands on entirely
 * different content — the agenda slides, with no scroll from the user.
 *
 * The startup shape of this is a vault's background sync: `loadVaultContent`
 * deliberately does not await it when the Dexie cache already painted, so it
 * lands well after `markAgendaScrolled` cleared `agendaScrollTarget` and left
 * nothing to re-assert the position. A filter toggle drops a block of rows the
 * same way. Both are just "`rows` was rebuilt without a scroll".
 */
describe('AgendaView — holding the visible day across row-list changes', () => {
  const todayTask = () => makeOcc({ id: 'today-1', date: fmtISO(today), time: '09:00' })
  const overdue = (n: number) => Array.from({ length: n }, (_, i) => overdueTask(i))
  // Real content ahead of today, so the list is long enough that re-pinning a
  // row after a large insertion above it isn't clamped by the end of the
  // scroll range. Without this the future is bare week dividers and the whole
  // agenda is barely two screens tall.
  const upcoming = () => Array.from({ length: 40 }, (_, i) => makeOcc({
    id: `up-${i}`, date: fmtISO(addDays(today, 1 + i * 2)), time: '14:00', entryKey: testKey('note.md'),
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: `Upcoming ${i}`, tags: [], items: [] },
  }))
  /** Past-dated events — no `done`, so `occKind` is 'event' and they stay on
   * their own past days instead of pooling into overdue the way tasks do.
   * This is the shape an iCal subscription's history has. */
  const pastEvents = (n: number) => Array.from({ length: n }, (_, i) => makeOcc({
    id: `past-${i}`, date: fmtISO(addDays(today, -(1 + i * 2))), time: '10:00', entryKey: testKey('note.md'),
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title: `Past ${i}`, tags: [], items: [] },
  }))

  // The virtualizer only clears `isScrolling` on a debounce timer
  // (isScrollingResetDelay, 150ms). Left ticking on real timers it never fires
  // inside a test, so the anchoring's "don't fight an in-flight gesture" guard
  // would swallow every correction and these tests would pass vacuously.
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers() })

  /** Flush the shim's microtask scroll dispatch and let the scroll settle. */
  const settle = async () => {
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve() })
  }

  const scrollDownBy = async (px: number) => {
    await act(async () => { scrollContainer().scrollTop += px; await Promise.resolve() })
    await settle()
  }

  /** Flush pending microtasks without letting the isScrolling debounce fire. */
  const flush = async () => {
    await act(async () => { await Promise.resolve() })
  }

  // The startup shape, and the one the first fix missed. A vault whose content
  // needs no network — the synthesized Tutorial vault, or an iCal/GitHub vault
  // hydrating from Dexie — lands *milliseconds* after the first vault painted,
  // well inside virtual-core's 150ms isScrollingResetDelay. The mount's own
  // programmatic scroll is still marked `isScrolling`, so a correction gated on
  // that flag is skipped, and since nothing rebuilds `rows` again the agenda
  // stays parked wherever the insertion left it — permanently, not for 150ms.
  //
  // Reported as: GitHub vault alone is fine (its sync lands seconds later,
  // outside the window), GitHub + Tutorial lands half a screen off, and a
  // dense iCal vault lands about a month early.
  it('holds the visible day when a second vault lands right after the first paint', async () => {
    seedStore([todayTask(), ...upcoming()], makeRoots('note.md'))
    render(<AgendaView onOpen={vi.fn()} />)
    await flush()

    const before = calendarView.getState().agendaTopDate
    expect(before).toBe(fmtISO(today))

    // Past-dated *events*, not tasks — an iCal subscription's back catalogue.
    // They build real past-day sections above today rather than pooling into
    // the overdue section, so an uncorrected viewport lands on one of those
    // past days instead of on today. (Overdue rows all carry todayKey, which
    // is why a task-shaped fixture cannot tell the two outcomes apart.)
    //
    // Deliberately no settle() before this — that is the whole point.
    await act(async () => {
      seedStore([todayTask(), ...upcoming(), ...pastEvents(60)], makeRoots('note.md'))
      await Promise.resolve()
    })
    await settle()

    expect(calendarView.getState().agendaTopDate).toBe(before)
  })

  it('holds the visible day when a vault sync lands past-dated content above it', async () => {
    seedStore([todayTask(), ...upcoming()], makeRoots('note.md'))
    render(<AgendaView onOpen={vi.fn()} />)
    await settle()
    // Read ahead a little, so the landing content is unambiguously above.
    await scrollDownBy(400)

    const before = calendarView.getState().agendaTopDate
    const offsetBefore = scrollContainer().scrollTop
    expect(before).not.toBeNull()
    expect(before).not.toBe(fmtISO(today))

    // 60 undone past tasks arrive — they pool into the overdue section, which
    // splices in *above* today. This is the store write mergeChangedIntoStore
    // makes seconds into a GitHub restore.
    await act(async () => {
      seedStore([todayTask(), ...upcoming(), ...overdue(60)], makeRoots('note.md'))
      await Promise.resolve()
    })
    await settle()

    // Both halves matter: the same day is still at the top, and the offset
    // moved to keep it there. An unchanged offset would mean the list slid
    // underneath a frozen scroll position — the bug.
    expect(calendarView.getState().agendaTopDate).toBe(before)
    expect(scrollContainer().scrollTop).toBeGreaterThan(offsetBefore)
  })

  it('holds the visible day when the filter drops rows above it', async () => {
    seedStore([todayTask(), ...upcoming(), ...overdue(60)], makeRoots('note.md'))
    render(<AgendaView onOpen={vi.fn()} />)
    await settle()
    await scrollDownBy(1200)

    const before = calendarView.getState().agendaTopDate
    const offsetBefore = scrollContainer().scrollTop
    expect(before).not.toBeNull()

    // Hiding tasks drops the whole overdue section from above the viewport.
    await act(async () => { useStore.getState().toggleShowTasks(); await Promise.resolve() })
    await settle()

    // The anchored row may itself have been one of the hidden tasks — the day
    // fallback (see findAnchorIndex) is what holds the position then.
    expect(calendarView.getState().agendaTopDate).toBe(before)
    expect(scrollContainer().scrollTop).toBeLessThan(offsetBefore)
  })

  // The guard the isScrolling flag was standing in for, now stated directly:
  // while a finger is actually down, re-pinning would drag content out from
  // under the gesture. Programmatic settling (the startup case above) is no
  // longer caught by it.
  it('does not re-pin while a finger is down on the list', async () => {
    seedStore([todayTask(), ...upcoming()], makeRoots('note.md'))
    render(<AgendaView onOpen={vi.fn()} />)
    await settle()
    await scrollDownBy(400)

    const offsetBefore = scrollContainer().scrollTop

    act(() => { scrollContainer().dispatchEvent(new Event('touchstart')) })
    await act(async () => {
      seedStore([todayTask(), ...upcoming(), ...pastEvents(60)], makeRoots('note.md'))
      await Promise.resolve()
    })
    await settle()

    // Untouched: the gesture owns the scroll position until the finger lifts.
    expect(scrollContainer().scrollTop).toBe(offsetBefore)
  })

  it('leaves the position alone when the rebuild moved nothing above the viewport', async () => {
    seedStore([todayTask(), ...upcoming(), ...overdue(20)], makeRoots('note.md'))
    render(<AgendaView onOpen={vi.fn()} />)
    await settle()
    await scrollDownBy(300)

    const before = calendarView.getState().agendaTopDate
    const offsetBefore = scrollContainer().scrollTop

    // A future-dated entry appears *below* the viewport. rows is rebuilt, but
    // nothing above moved — re-pinning here would snap a mid-row reading
    // position flush to the top for nothing. Same shape as the once-a-minute
    // `now` tick, which rebuilds rows wholesale without moving anything.
    await act(async () => {
      seedStore(
        [todayTask(), ...upcoming(), ...overdue(20),
          makeOcc({ id: 'later', date: fmtISO(addDays(today, 200)), time: '11:00' })],
        makeRoots('note.md'),
      )
      await Promise.resolve()
    })
    await settle()

    expect(calendarView.getState().agendaTopDate).toBe(before)
    expect(scrollContainer().scrollTop).toBe(offsetBefore)
  })

  it('lets an explicit jump win over holding the current position', async () => {
    seedStore([todayTask(), ...upcoming(), ...overdue(60)], makeRoots('note.md'))
    render(<AgendaView onOpen={vi.fn()} />)
    await settle()
    await scrollDownBy(1200)
    expect(calendarView.getState().agendaScrollTarget).toBeNull()

    // The Today button, pressed while the agenda is already mounted.
    await act(async () => { requestScrollToToday(); await Promise.resolve() })
    await settle()

    // Consumed, and landed on today's own target — the anchoring must not
    // hold the old position against an explicit request.
    expect(calendarView.getState().agendaScrollTarget).toBeNull()
    expect(calendarView.getState().agendaTopDate).toBe(fmtISO(today))
  })
})
