// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { setupStore, seedStore, makeRoots } from '@/test-utils'
import { fmtTopBarMonth } from '@/format'

// health-ui-results.md finding #6: AppMain re-derives the day/week/month/
// list/agenda discriminant in nine separate branch chains, and the file was
// excluded from coverage on a rationale ("route registration and little
// else") that stopped being true for it. Un-excluding it (vitest.config.ts)
// surfaced the topbar's five-way branch — which label and which paging each
// route yields — as untested. These are the table-driven tests _app.test.tsx
// didn't have: one per view, asserting the topbar label, the prev/next
// chevron paging (or its absence), and what "Today" navigates to.

interface RouteMatch { params: Record<string, string> }
let matches: Partial<Record<string, RouteMatch>> = {}
const navigateSpy = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => opts,
    Outlet: () => <div data-testid="outlet" />,
    useNavigate: () => navigateSpy,
    useMatch: (opts: { from: string }) => matches[opts.from],
  }
})

// Same drag-physics workaround _app.test.tsx uses: MiniMonth/MonthStrip stay
// mounted regardless of which view is active (see _app.tsx's own comment),
// and their real carousel has no layout engine to drive under jsdom.
vi.mock('@/calendar/useCarousel', () => ({
  useCarousel: (opts: { unitKey: string }) => ({ emblaRef: () => {}, paneKeys: [opts.unitKey] }),
}))

vi.mock('@/components', () => ({
  SyncButton: () => null,
  ViewFilterButton: () => null,
}))
vi.mock('./-appSidebar', () => ({ default: () => null }))
vi.mock('./-searchBar', () => ({ default: () => null }))
vi.mock('@/onboarding', () => ({ CoachTour: () => null }))

setupStore()

const { Route } = await import('./_app')
const AppLayout = (Route as unknown as { component: () => React.ReactElement }).component

const TODAY = new Date(2026, 8, 15) // September 15 2026, matches _app.test.tsx's fixed clock

beforeEach(() => {
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
  matches = {}
  navigateSpy.mockClear()
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
  seedStore([], makeRoots('note.md'))
})

afterEach(() => { vi.useRealTimers() })

describe('_app — per-view topbar label and paging', () => {
  it('day view: labels by the matched date, pages by one day, and Today navigates to today', () => {
    matches = { '/_app/day/$date': { params: { date: '2026-09-20' } } }
    render(<AppLayout />)

    expect(screen.getByText(fmtTopBarMonth(new Date(2026, 8, 20), TODAY))).toBeInTheDocument()

    screen.getByLabelText('Next day').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/day/$date', params: { date: '2026-09-21' }, replace: true })
    screen.getByLabelText('Previous day').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/day/$date', params: { date: '2026-09-19' }, replace: true })

    screen.getByLabelText('Today').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/day/$date', params: { date: '2026-09-15' } })
  })

  it('week view: labels by the matched week, pages by seven days, and Today navigates to today\'s week', () => {
    matches = { '/_app/week/$date': { params: { date: '2026-09-14' } } }
    render(<AppLayout />)

    expect(screen.getByText(fmtTopBarMonth(new Date(2026, 8, 14), TODAY))).toBeInTheDocument()

    screen.getByLabelText('Next week').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/week/$date', params: { date: '2026-09-21' }, replace: true })
    screen.getByLabelText('Previous week').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/week/$date', params: { date: '2026-09-07' }, replace: true })

    screen.getByLabelText('Today').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/week/$date', params: { date: '2026-09-15' } })
  })

  it('month view: labels by the matched month, pages by one month, and Today navigates to this month', () => {
    matches = { '/_app/calendar/$month': { params: { month: '2026-09' } } }
    render(<AppLayout />)

    expect(screen.getByText(fmtTopBarMonth(new Date(2026, 8, 1), TODAY))).toBeInTheDocument()

    screen.getByLabelText('Next month').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/calendar/$month', params: { month: '2026-10' }, replace: true })
    screen.getByLabelText('Previous month').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/calendar/$month', params: { month: '2026-08' }, replace: true })

    screen.getByLabelText('Today').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/calendar/$month', params: { month: '2026-09' } })
  })

  it('backlog view: a fixed "Backlog" label, no paging chevrons, and no Today button', () => {
    matches = { '/_app/backlog': { params: {} } }
    render(<AppLayout />)

    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Previous /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Next /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Today')).not.toBeInTheDocument()
  })

  it('notes view: a fixed "Notes" label, no paging chevrons, and no Today button', () => {
    matches = { '/_app/notes': { params: {} } }
    render(<AppLayout />)

    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Previous /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Next /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Today')).not.toBeInTheDocument()
  })

  it('agenda view (no route match): labels by today, no paging chevrons, and Today scrolls + navigates home', () => {
    render(<AppLayout />)

    expect(screen.getByText(fmtTopBarMonth(TODAY, TODAY))).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Previous /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Next /)).not.toBeInTheDocument()

    screen.getByLabelText('Today').click()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/' })
  })
})
