// @vitest-environment jsdom
import { isValidElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import type * as CalendarModule from '@/calendar'
import { renderHook, act } from '@testing-library/react'
import { setupStore, seedStore, makeRoots } from '@/test-utils'
import { useStore } from '@/store'
import { fmtISO, parseDateString, weekStartsOn } from '@/model'

// The per-view chrome adapters behind _app.tsx's topbar and quick-nav panel
// (health-ui-results.md finding #1). _app.viewBranches.test.tsx already covers
// the five-way topbar surface black-box, through the rendered shell; this
// covers what that can't reach without a layout engine — the preview-aware
// label derivations, and the quick-nav panel callbacks each view wires into
// its MiniMonth/MonthStrip. Those callbacks are exactly the class of thing
// finding #1 called out: four views spelling out near-identical navigation
// whose divergences are silent, not type errors.

interface RouteMatch { params: Record<string, string> }
let matches: Partial<Record<string, RouteMatch>> = {}
const navigateSpy = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return { ...actual, useNavigate: () => navigateSpy, useMatch: (opts: { from: string }) => matches[opts.from] }
})

// The three preview hooks are the carousels' own swipe state (see
// viewState.ts). Their setters are private to @/calendar — DayView/WeekView/
// MonthView are the only legitimate writers — so, exactly as _app.test.tsx
// does for useAgendaTopDate, the read side is swapped here rather than
// deep-importing past the module boundary. Everything else passes through, so
// the store the adapters read and the functions they call are the real ones;
// the two recorded below call through as well.
let dayPreview: string | null = null
let weekPreview: string | null = null
let monthPreview: string | null = null
let scrollCalls: string[] = []
let browsePreviewCalls: (string | null)[] = []

vi.mock('@/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof CalendarModule>()
  return {
    ...actual,
    useDayPreview: () => dayPreview,
    useWeekPreview: () => weekPreview,
    useMonthPreview: () => monthPreview,
    requestScrollToDate: (dateKey: string) => {
      scrollCalls.push(dateKey)
      actual.requestScrollToDate(dateKey)
    },
    setQuickNavBrowsePreview: (key: string | null) => {
      browsePreviewCalls.push(key)
      actual.setQuickNavBrowsePreview(key)
    },
  }
})

setupStore()

const { previewAware } = await import('./-viewChrome')
const { useDayChrome } = await import('./-dayChrome')
const { useWeekChrome } = await import('./-weekChrome')
const { useMonthChrome } = await import('./-monthChrome')
const { useAgendaChrome } = await import('./-agendaChrome')
const { useViewChrome } = await import('./-useViewChrome')
const { useQuickNavOpen, toggleQuickNav, closeQuickNav, useCurrentDate } = await import('@/calendar')

const TODAY = new Date(2026, 8, 15) // September 15 2026, matching the sibling _app tests

/** The props of whatever element a `quickNav(monthNav)` call returned. */
function panelProps<P>(node: ReactNode): P {
  if (!isValidElement(node)) throw new Error('quickNav did not return an element')
  return node.props as P
}

interface MiniMonthProps {
  anchorMonth: Date
  highlightDates: Date[]
  monthNav: 'strip' | 'buttons'
  onSelectDay: (iso: string) => void
  onBrowseMonth: (d: Date) => void
  onBrowseMonthPreview?: (d: Date) => void
}
interface MonthStripProps {
  activeMonth: Date
  onNavigateMonth: (d: Date) => void
}

beforeEach(() => {
  matches = {}
  navigateSpy.mockClear()
  dayPreview = weekPreview = monthPreview = null
  scrollCalls = []
  browsePreviewCalls = []
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
  seedStore([], makeRoots('note.md'))
  closeQuickNav()
})

afterEach(() => { vi.useRealTimers() })

describe('previewAware', () => {
  it('returns the route value when no swipe preview is pending', () => {
    expect(previewAware('route', null, () => 'parsed')).toBe('route')
  })

  it('returns the parsed preview while a swipe is in flight', () => {
    expect(previewAware('route', 'key', () => 'parsed')).toBe('parsed')
  })

  it('falls back to the route value when the preview key cannot be parsed', () => {
    // The parse functions return null/undefined on malformed input rather
    // than throwing; a stale or bad key must degrade to the route, not blow
    // up the topbar.
    expect(previewAware('route', 'nonsense', () => null)).toBe('route')
    expect(previewAware('route', 'nonsense', () => undefined)).toBe('route')
  })
})

describe('useDayChrome', () => {
  it('returns null when the day route is not the one mounted', () => {
    const { result } = renderHook(() => useDayChrome())
    expect(result.current).toBeNull()
  })

  it('labels and anchors by the swipe preview while paging stays on the committed route date', () => {
    matches = { '/_app/day/$date': { params: { date: '2026-09-20' } } }
    dayPreview = '2026-10-04'
    const { result } = renderHook(() => useDayChrome())

    const props = panelProps<MiniMonthProps>(result.current?.quickNav?.('strip'))
    expect(fmtISO(props.anchorMonth)).toBe('2026-10-04')
    expect(props.highlightDates.map(fmtISO)).toEqual(['2026-10-04'])

    // Paging deliberately does not follow the preview: a chevron tap while a
    // swipe is mid-flight must step from the route, not from where the finger
    // is heading.
    result.current?.paging?.onNext()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/day/$date', params: { date: '2026-09-21' }, replace: true })
  })

  it('quick-nav: picking a day navigates to it and closes the panel', () => {
    matches = { '/_app/day/$date': { params: { date: '2026-09-20' } } }
    const { result } = renderHook(() => ({ chrome: useDayChrome(), open: useQuickNavOpen() }))
    act(() => { toggleQuickNav() })
    expect(result.current.open).toBe(true)

    act(() => { panelProps<MiniMonthProps>(result.current.chrome?.quickNav?.('strip')).onSelectDay('2026-09-02') })
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/day/$date', params: { date: '2026-09-02' } })
    expect(result.current.open).toBe(false)
  })

  it('quick-nav: browsing months pages with replace, and previews without navigating at all', () => {
    matches = { '/_app/day/$date': { params: { date: '2026-09-20' } } }
    const { result } = renderHook(() => useDayChrome())
    const props = panelProps<MiniMonthProps>(result.current?.quickNav?.('strip'))

    props.onBrowseMonth(new Date(2026, 10, 1))
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/day/$date', params: { date: '2026-11-01' }, replace: true })

    // The preview path is deliberately decoupled from routing — see
    // quickNavBrowsePreview's doc comment in viewState.ts.
    navigateSpy.mockClear()
    props.onBrowseMonthPreview?.(new Date(2026, 11, 1))
    expect(browsePreviewCalls).toEqual(['2026-12-01'])
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

describe('useWeekChrome', () => {
  it('returns null when the week route is not the one mounted', () => {
    const { result } = renderHook(() => useWeekChrome())
    expect(result.current).toBeNull()
  })

  it('quick-nav: picking a day sets it current before navigating, so the weekday is not kept', () => {
    matches = { '/_app/week/$date': { params: { date: '2026-09-14' } } }
    const { result } = renderHook(() => ({ chrome: useWeekChrome(), current: useCurrentDate() }))

    act(() => { panelProps<MiniMonthProps>(result.current.chrome?.quickNav?.('strip')).onSelectDay('2026-09-02') })
    // Without the setCurrentDate first, WeekPage's own effect would run the
    // target through setCurrentWeekKeepingWeekday and land the previously
    // selected weekday instead of the day actually picked.
    expect(result.current.current).toBe('2026-09-02')
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/week/$date', params: { date: '2026-09-02' } })
  })

  it('quick-nav: browsing a month lands on that month\'s first full week, not on its 1st', () => {
    matches = { '/_app/week/$date': { params: { date: '2026-09-14' } } }
    const ws = weekStartsOn(useStore.getState().localePrefs)
    const { result } = renderHook(() => useWeekChrome())

    // November 1 2026 is a Sunday, so under a Monday-start locale the raw 1st
    // would round *backward* into October and desync the topbar label from
    // the month just tapped — see onBrowseMonth's own comment.
    panelProps<MiniMonthProps>(result.current?.quickNav?.('strip')).onBrowseMonth(new Date(2026, 10, 1))

    const call = navigateSpy.mock.calls.at(-1)?.[0] as { params: { date: string } }
    const landed = parseDateString(call.params.date)
    expect(landed?.getDay()).toBe(ws)
    expect(landed?.getMonth()).toBe(10)
  })
})

describe('useMonthChrome', () => {
  it('returns null when the month route is not the one mounted', () => {
    const { result } = renderHook(() => useMonthChrome())
    expect(result.current).toBeNull()
  })

  it('quick-nav: the month strip pages with the same replace semantics as the chevrons', () => {
    matches = { '/_app/calendar/$month': { params: { month: '2026-09' } } }
    const { result } = renderHook(() => useMonthChrome())

    const props = panelProps<MonthStripProps>(result.current?.quickNav?.('strip'))
    expect(props.activeMonth.getMonth()).toBe(8)
    props.onNavigateMonth(new Date(2026, 11, 1))
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/calendar/$month', params: { month: '2026-12' }, replace: true })
  })
})

describe('useAgendaChrome', () => {
  it('quick-nav: picking a day scrolls the agenda rather than navigating away from it', () => {
    const { result } = renderHook(() => ({ chrome: useAgendaChrome(), open: useQuickNavOpen() }))
    act(() => { toggleQuickNav() })
    expect(result.current.open).toBe(true)

    act(() => { panelProps<MiniMonthProps>(result.current.chrome.quickNav?.('strip')).onSelectDay('2026-11-03') })
    expect(scrollCalls).toEqual(['2026-11-03'])
    expect(navigateSpy).not.toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  it('quick-nav: browsing scrolls on commit and offers no preview hook at all', () => {
    const { result } = renderHook(() => useAgendaChrome())
    const props = panelProps<MiniMonthProps>(result.current.quickNav?.('strip'))

    // Deliberate asymmetry with day/week: requestScrollToDate re-renders the
    // agenda's whole row list, so firing it on preview *and* commit doubles
    // that work every swipe for no benefit.
    expect(props.onBrowseMonthPreview).toBeUndefined()
    props.onBrowseMonth(new Date(2026, 11, 1))
    expect(scrollCalls).toEqual(['2026-12-01'])
  })
})

describe('useViewChrome', () => {
  it('hands back the adapter whose route matched, not the agenda fallback', () => {
    matches = { '/_app/week/$date': { params: { date: '2026-09-14' } } }
    const { result } = renderHook(() => useViewChrome())
    expect(result.current.kind).toBe('week')
  })

  it('falls back to the agenda when no named route matched', () => {
    const { result } = renderHook(() => useViewChrome())
    expect(result.current.kind).toBe('agenda')
    expect(result.current.paging).toBeNull()
  })

  it('gives Backlog and Notes a label and nothing else', () => {
    matches = { '/_app/backlog': { params: {} } }
    const { result } = renderHook(() => useViewChrome())
    expect(result.current).toMatchObject({ kind: 'list', label: 'Backlog', paging: null, onToday: null, quickNav: null })
  })
})
