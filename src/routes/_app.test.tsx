// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import type * as CalendarModule from '@/calendar'
import { render, act } from '@testing-library/react'
import { setupStore, seedStore, makeRoots } from '@/test-utils'
import { fmtMonth, parseMonth, fmtISO } from '@/model'

// Regression test for the feedback loop described in
// plans/agenda-quicknav-swipe.md's PR 1: before the fix, _app.tsx fed the
// agenda's own live scroll position (agendaTopDate) into the quick-nav
// grid's anchorMonth prop. Since AgendaView's real scroll landing is an
// estimate that can be a day short of the browsed month (see PR 2's own doc
// comment on offsetOfRow), that live value routinely disagreed with the
// month the grid had just committed to — and MiniMonth's own
// useResetOnChange (see MiniMonth.tsx) reads any such disagreement as "the
// parent wants a different month" and yanks the grid back, so consecutive
// swipes can get stuck re-browsing the same month instead of advancing.
//
// -------------------------------------------------------------------------
// Controllable, reactive stand-in for useAgendaTopDate. The real hook is a
// Zustand subscription over calendarView, which is private to @/calendar
// (see eslint.config.js's module-boundary rule) — this test lives outside
// that module, so it can't reach agendaTopDate or set it directly. Standing
// in for just this one hook (via useSyncExternalStore, so changes are as
// reactive as the real thing) lets the test simulate AgendaView's real
// scroll landing without a deep import into calendar-private state.
let topDate: string | null = null
const topDateListeners = new Set<() => void>()
function setTopDateForTest(v: string | null) {
  topDate = v
  topDateListeners.forEach(l => l())
}
function useMockAgendaTopDate() {
  return useSyncExternalStore(
    onChange => { topDateListeners.add(onChange); return () => topDateListeners.delete(onChange) },
    () => topDate,
  )
}

interface CapturedCarouselOpts {
  unitKey: string
  onCommit: (key: string) => void
}
let latestOpts: CapturedCarouselOpts | undefined
/** Every dateKey requestScrollToDate was called with, in order — a plain
 * array instead of a vi.fn() spy, since the mock factory below re-exports
 * requestScrollToDate's real type unchanged and a cast back to a Mock type
 * is unnecessary type gymnastics for what this test needs. */
let scrollCalls: string[] = []

// Same pattern as MiniMonth.preview.test.tsx: MiniMonth's real carousel has
// no drag physics under jsdom (no layout engine), so onCommit is driven
// directly instead of simulating a real touch gesture. Mocked via the alias
// path (not a relative one, since this test doesn't live in src/calendar/)
// — vi.mock's string argument isn't a static import, so it isn't subject to
// the module-boundary lint rule that would otherwise block this from
// outside the calendar/ module.
vi.mock('@/calendar/useCarousel', () => ({
  useCarousel: (opts: CapturedCarouselOpts) => {
    latestOpts = opts
    return { emblaRef: () => {}, paneKeys: [opts.unitKey] }
  },
}))

// Swaps in the mock above for just useAgendaTopDate, and wraps
// requestScrollToDate to record its calls while still calling through to the
// real implementation — every other export (MiniMonth, toggleQuickNav,
// useQuickNavOpen, and so on) passes through untouched, so the panel's
// open/close state and the grid itself stay genuinely real.
vi.mock('@/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof CalendarModule>()
  return {
    ...actual,
    useAgendaTopDate: useMockAgendaTopDate,
    requestScrollToDate: (dateKey: string) => {
      scrollCalls.push(dateKey)
      actual.requestScrollToDate(dateKey)
    },
  }
})

// createFileRoute/useMatch/useNavigate/Outlet mocked the same way
// __root.test.tsx mocks createRootRoute/Outlet — _app.tsx's useMatch calls
// need real router context otherwise, which nothing here sets up. A blanket
// `undefined` for every useMatch call is enough to land on the agenda
// branch (isDayView/isWeekView/isMonthView/isListView all false), the one
// this bug lives in.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => opts,
    Outlet: () => <div data-testid="outlet" />,
    useNavigate: () => () => {},
    useMatch: () => undefined,
  }
})

// Heavy siblings _app.tsx mounts alongside AppMain, irrelevant to this
// test and each with its own real dependencies (auth, vaults, onboarding
// state) not worth wiring up here.
vi.mock('@/components', () => ({
  AppSidebar: () => null,
  SyncButton: () => null,
  SearchBar: () => null,
  ViewFilterButton: () => null,
}))
vi.mock('@/onboarding', () => ({ CoachTour: () => null }))

setupStore()

const { Route } = await import('./_app')
const { toggleQuickNav } = await import('@/calendar')
// createFileRoute's mock above hands back the options object verbatim, so
// Route.component is AppLayout itself — same cast idiom __root.test.tsx uses
// for its own createRootRoute mock.
const AppLayout = (Route as unknown as { component: () => React.ReactElement }).component

/** The month key one pane past `key` — what a real user's next swipe targets. */
function monthAfter(key: string): string {
  const d = parseMonth(key)
  return fmtMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1))
}

/**
 * The last day of the month before `key` — an offset-estimate scroll landing
 * one day short of `key`'s first day. Not a rare edge case: see PR 2's own
 * doc comment on offsetOfRow summing estimated row heights where nothing has
 * been measured yet, which is routinely off by a row.
 */
function dayBeforeMonth(key: string): string {
  const d = parseMonth(key)
  return fmtISO(new Date(d.getFullYear(), d.getMonth(), 0))
}

beforeEach(() => {
  // Forces the agenda's quick-nav panel into its plain mobile form (always
  // mounted, see _app.tsx) rather than the desktop Popover (which Radix only
  // mounts once open) — keeps exactly one MiniMonth instance in the tree.
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })
  latestOpts = undefined
  topDate = null
  topDateListeners.clear()
  scrollCalls = []
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 15)) // September 15 2026
})

afterEach(() => { vi.useRealTimers() })

describe('_app — agenda quick-nav panel anchor', () => {
  it("advances a full month per swipe even when the agenda's own scroll lands a day short of the browsed month", () => {
    seedStore([], makeRoots('note.md'))
    render(<AppLayout />)

    act(() => toggleQuickNav())
    expect(latestOpts).toBeDefined()
    expect(latestOpts!.unitKey).toBe('2026-09')

    // Three swipes forward, each targeting one pane past wherever the grid
    // is *currently* centered — exactly what a real user's next swipe does,
    // regardless of whether the previous swipe's landing yanked the grid
    // back to an earlier month.
    for (let i = 0; i < 3; i++) {
      const target = monthAfter(latestOpts!.unitKey)
      act(() => { latestOpts!.onCommit(target) })
      act(() => { setTopDateForTest(dayBeforeMonth(target)) })
    }

    // Healthy: Sep -> Oct -> Nov -> Dec, three full months of progress.
    // Broken (pre-fix): the second swipe's mismatched landing yanks the grid
    // back a month, so the third swipe re-targets November instead of
    // reaching December — this comes back '2026-11-01'.
    expect(scrollCalls.at(-1)).toBe('2026-12-01')
  })

  it('still re-syncs to the agenda\'s current position when the panel is closed and reopened', () => {
    seedStore([], makeRoots('note.md'))
    render(<AppLayout />)

    act(() => toggleQuickNav())
    expect(latestOpts!.unitKey).toBe('2026-09')

    // Close the panel, then move the agenda somewhere else entirely (a
    // sidebar jump or ordinary scrolling while the panel was shut) —
    // agendaTopDate no longer has anything to do with what the grid last
    // browsed to.
    act(() => toggleQuickNav())
    act(() => { setTopDateForTest('2026-12-25') })

    // Reopening must pick up the agenda's *current* position, not whatever
    // the grid was frozen at during the previous open.
    act(() => toggleQuickNav())
    expect(latestOpts!.unitKey).toBe('2026-12')
  })
})
