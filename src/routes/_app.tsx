import { useCallback, useEffect, useRef } from 'react'
import { createFileRoute, Outlet, useNavigate, useMatch } from '@tanstack/react-router'
import { CalendarCheck2 } from 'lucide-react'
import { addDays, fmtTopBarMonth } from '@/format'
import { fmtISO, fmtMonth, parseDateString, parseMonth, weekStartsOn } from '@/model'
import { useToday } from '@/hooks'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import {
  useMonthPreview, useDayPreview, useWeekPreview,
  useAgendaTopDate, requestScrollToToday, requestScrollToDate, weekStartFor,
  useQuickNavOpen, toggleQuickNav, closeQuickNav, MonthStrip, MiniMonth,
} from '@/calendar'
import { CoachTour } from '@/onboarding'
import { AppSidebar, SyncButton, SearchBar, ViewFilterButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { TopbarShell } from './-topbarShell'
import { PagedTopbar } from './-pagedTopbar'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
  validateSearch: (search: Record<string, unknown>): { sq?: string } => ({
    sq: typeof search.sq === 'string' ? search.sq : undefined,
  }),
})

/** The seven dates of the week starting at `start` — week view's MiniMonth highlight. */
function weekDates(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

function AppLayout() {
  return (
    // `_app` is the one shell that stays exactly one screen tall and clips
    // itself, so every scroller below it (the agenda's virtualizer above all)
    // scrolls its own element instead of the document — see index.css, where
    // html/body/#root/#app deliberately only carry `min-height`.
    //
    // The cap lives on this app-owned element rather than on SidebarProvider,
    // which is a shadcn registry mirror (see CLAUDE.md — only files the shadcn
    // CLI wrote belong in components/ui). Overriding a vendored component's
    // base classes made the app's most load-bearing layout invariant depend on
    // upstream's own `flex min-h-svh w-full` and on which Tailwind utilities
    // tailwind-merge treats as colliding: `min-h-svh`/`min-h-0` collide and
    // merge, `h-svh`/`flex-1` do not — which is exactly how the shell silently
    // lost its cap once before. A `shadcn diff` can now change that component
    // without reaching this.
    //
    // `max-h-svh` is the cap that cannot be argued with. This is a flex item
    // of `#app` (`display:flex; flex-direction:column`), so its *height* is
    // the main size — and a flex item's main size comes from `flex-basis`,
    // not from `height`. `flex-1` sets `flex-basis: 0%`, a percentage resolved
    // against the container's inner main size, and #app's height is `auto`
    // with only a `min-height`, i.e. indefinite; a percentage basis that can't
    // resolve degrades to `content`, and the shell then sizes to the agenda's
    // full virtualized spacer with `h-svh` never applying. A max-height is
    // immune to that: it clamps the used main size *after* flex resolution,
    // whatever the basis did and however indefinite the ancestor is.
    <div data-app-shell className="flex w-full h-svh max-h-svh overflow-hidden">
      {/* min-h-0 only neutralizes upstream's `min-h-svh`, so this element
          stretches to the shell rather than insisting on a screen of its own.
          Nothing here caps anything — that is the shell's job, above. */}
      <SidebarProvider
        className="h-full min-h-0"
        style={{ '--sidebar-width': '260px' } as React.CSSProperties}
      >
        <AppSidebar />
        <AppMain />
      </SidebarProvider>
    </div>
  )
}

function AppMain() {
  const { isMobile, setOpenMobile } = useSidebar()
  const setSidebarOpen = useCallback((open: boolean) => {
    if (isMobile) setOpenMobile(open)
  }, [isMobile, setOpenMobile])

  const navigate = useNavigate()

  const dayMatch       = useMatch({ from: '/_app/day/$date', shouldThrow: false })
  const weekMatch      = useMatch({ from: '/_app/week/$date', shouldThrow: false })
  const monthMatch     = useMatch({ from: '/_app/calendar/$month', shouldThrow: false })
  const backlogMatch   = useMatch({ from: '/_app/backlog', shouldThrow: false })
  const notesMatch     = useMatch({ from: '/_app/notes', shouldThrow: false })


  const today         = useToday()
  const agendaTopDate = useAgendaTopDate()
  const monthPreview  = useMonthPreview()
  const dayPreview    = useDayPreview()
  const weekPreview   = useWeekPreview()
  const ws            = weekStartsOn(useStore(s => s.localePrefs))
  const quickNavOpen  = useQuickNavOpen()

  // The one disclosure button currently rendered — PagedTopbar's (day/week/
  // month) or the agenda's own — so Escape can return focus to it on close.
  // Shared across all four call sites below since only one is ever mounted
  // at a time.
  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  // tabIndex={-1} on the panel itself makes it a valid focus target despite
  // holding no text content of its own; see the effect below.
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus moves into the panel the moment it opens (and is no longer
  // `inert`), so a keyboard/screen-reader user lands directly on its
  // content instead of it opening silently behind the still-focused label
  // button.
  // Escape closes the panel and returns focus to whichever button opened it.
  // A document-level listener rather than a JSX onKeyDown on the (necessarily
  // non-interactive) panel div — jsx-a11y flags keyboard handlers on a
  // non-interactive role, and the panel itself isn't a control.
  useEffect(() => {
    if (quickNavOpen) panelRef.current?.focus()
    if (!quickNavOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeQuickNav()
      toggleButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [quickNavOpen])

  const isDayView    = !!dayMatch
  const isWeekView   = !!weekMatch
  const isMonthView  = !!monthMatch
  const isListView   = !!backlogMatch || !!notesMatch
  const dvDate       = dayMatch ? new Date(dayMatch.params.date + 'T00:00:00') : null
  const monthViewDate = monthMatch ? parseMonth(monthMatch.params.month) : null
  // The route param need not already be week-start-normalized (see WeekView),
  // so it's normalized here before anything reads it.
  const weekStartDate = weekMatch ? weekStartFor(new Date(weekMatch.params.date + 'T00:00:00'), ws) : null

  // Closes the quick-nav panel on a view switch — paging within the same view
  // (chevron taps, swipes) must leave it open, which is why this keys off the
  // view kind rather than the route params those carry.
  const viewKind = isDayView ? 'day' : isWeekView ? 'week' : isMonthView ? 'month' : isListView ? 'list' : 'agenda'
  useEffect(() => { closeQuickNav() }, [viewKind])

  // monthPreview/dayPreview/weekPreview (set by the swipe carousel on touchend
  // / crossing the halfway point) show the label the gesture is heading
  // toward immediately, ahead of the route committing — chevron navigation
  // and Today still key off the route's own monthViewDate/dvDate/weekStartDate.
  const monthDisplayDate = monthViewDate && (monthPreview ? parseMonth(monthPreview) : monthViewDate)
  const dvDisplayDate    = dvDate && (dayPreview ? (parseDateString(dayPreview) ?? dvDate) : dvDate)
  const weekDisplayStart = weekStartDate && (weekPreview ? (parseDateString(weekPreview) ?? weekStartDate) : weekStartDate)
  const weekDisplayEnd   = weekDisplayStart && addDays(weekDisplayStart, 6)

  // Backlog/Notes are fixed strings; the agenda default view shows just the
  // month of its topmost visible row, matching Day/Month/Week's own topbar.
  const topBarLabel = (() => {
    if (backlogMatch) return 'Backlog'
    if (notesMatch)   return 'Notes'
    const d = agendaTopDate ? new Date(agendaTopDate + 'T00:00:00') : today
    return fmtTopBarMonth(d, today)
  })()

  const handleToday = () => {
    if (isDayView) {
      void navigate({ to: '/day/$date', params: { date: fmtISO(today) } })
    } else if (isWeekView) {
      void navigate({ to: '/week/$date', params: { date: fmtISO(today) } })
    } else if (isMonthView) {
      void navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } })
    } else {
      requestScrollToToday()
      void navigate({ to: '/' })
    }
  }

  const navigateHome   = useCallback(() => void navigate({ to: '/' }), [navigate])
  const openSidebar    = () => setSidebarOpen(true)

  // Shared by the month strip's chip taps — same replace: true paging
  // semantics as the chevrons and the swipe carousel just above.
  const navigateToMonth = useCallback(
    (d: Date) => navigate({ to: '/calendar/$month', params: { month: fmtMonth(d) }, replace: true }),
    [navigate],
  )

  return (
    <>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* One chrome block: the fixed-height topbar row plus the quick-nav
            panel beneath it, sharing a single background/border/shadow so the
            panel reads as the topbar sliding open, not a separate surface
            stacked under it. Because the border and shadow live here rather
            than on the header itself, they paint at the bottom of whichever
            is currently visible — the header alone while the panel is closed
            or absent, both together once it opens — with no divider between
            the two. */}
        <div className="shrink-0 z-10 bg-background border-b border-border shadow-md">
          <header
            id="mainTop"
            className="h-topbar pt-[env(safe-area-inset-top)] flex items-center"
            data-topbar
          >
            <TopbarShell
              leftHasButton={isMobile}
              left={
                isDayView && dvDate && dvDisplayDate ? (
                  // replace: true on nav — mirrors the day carousel's swipe-to-page
                  // semantics (see DayView) so chevron taps and swipes leave the
                  // same, single history entry per visit instead of chevron taps
                  // alone stacking up a back-press-per-day trail. Label is just the
                  // month (like month view's own PagedTopbar below) — the weekday
                  // and day-of-month already show in DayPane's own corner badge.
                  <PagedTopbar
                    isMobile={isMobile}
                    openSidebar={openSidebar}
                    label={fmtTopBarMonth(dvDisplayDate, today)}
                    paging={{
                      prevLabel: 'Previous day',
                      nextLabel: 'Next day',
                      onPrev: () => void navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) }, replace: true }),
                      onNext: () => void navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) }, replace: true }),
                    }}
                    expanded={quickNavOpen}
                    onToggle={toggleQuickNav}
                    toggleRef={toggleButtonRef}
                  />
                ) : isWeekView && weekStartDate && weekDisplayStart && weekDisplayEnd ? (
                  // replace: true on nav — mirrors the day/month carousels' swipe-to-page
                  // semantics (see WeekView) so chevron taps and swipes leave the
                  // same, single history entry per visit instead of chevron taps
                  // alone stacking up a back-press-per-week trail. Label is just the
                  // month of the week's first day, like Day/Month's own topbar —
                  // the day-of-month range shows in WeekPane's own column badges.
                  <PagedTopbar
                    isMobile={isMobile}
                    openSidebar={openSidebar}
                    label={fmtTopBarMonth(weekDisplayStart, today)}
                    paging={{
                      prevLabel: 'Previous week',
                      nextLabel: 'Next week',
                      onPrev: () => void navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, -7)) }, replace: true }),
                      onNext: () => void navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, 7)) }, replace: true }),
                    }}
                    expanded={quickNavOpen}
                    onToggle={toggleQuickNav}
                    toggleRef={toggleButtonRef}
                  />
                ) : isMonthView && monthViewDate && monthDisplayDate ? (
                  // replace: true on nav — mirrors the month carousel's swipe-to-page
                  // semantics (see MonthView) so chevron taps and swipes leave
                  // the same, single history entry per visit instead of chevron
                  // taps alone stacking up a back-press-per-month trail.
                  <PagedTopbar
                    isMobile={isMobile}
                    openSidebar={openSidebar}
                    label={fmtTopBarMonth(monthDisplayDate, today)}
                    paging={{
                      prevLabel: 'Previous month',
                      nextLabel: 'Next month',
                      onPrev: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)) }, replace: true }),
                      onNext: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)) }, replace: true }),
                    }}
                    expanded={quickNavOpen}
                    onToggle={toggleQuickNav}
                    toggleRef={toggleButtonRef}
                  />
                ) : isListView ? (
                  // Backlog/Notes: a plain label, no paging and no quick-nav panel.
                  <PagedTopbar
                    isMobile={isMobile}
                    openSidebar={openSidebar}
                    label={topBarLabel}
                  />
                ) : (
                  // Agenda: same disclosure-button shape as day/week/month, just
                  // with no prev/next paging — scrolling the list is how agenda pages.
                  <PagedTopbar
                    isMobile={isMobile}
                    openSidebar={openSidebar}
                    label={topBarLabel}
                    expanded={quickNavOpen}
                    onToggle={toggleQuickNav}
                    toggleRef={toggleButtonRef}
                  />
                )
              }
              right={
                <div className="flex items-center gap-0.5 shrink-0">
                  <ViewFilterButton />
                  <SyncButton />
                  {!isListView && (
                    <IconButton variant="ghost" className="text-dim" onClick={handleToday} title="Today" label="Today"><CalendarCheck2 size={18} /></IconButton>
                  )}
                </div>
              }
            />
          </header>

          {/* Kept mounted for as long as its view is, panel open or not: the
              grid-rows fr trick below animates a real "auto" height by
              interpolating against the row's own content, so that content has
              to still be there through a close transition, not just an open
              one. Staying mounted also means MonthStrip's centering effect has
              already settled by the time the panel first opens, instead of
              popping in mis-centered. `inert` drops it from focus and a11y
              while collapsed, matching MonthGrid's off-screen carousel panes.

              `sm:max-w-md` is the desktop form: the same inline panel as
              mobile, just capped rather than stretched edge-to-edge — the
              label/chevron row above it already only occupies part of the
              topbar's width on wide screens, so a full-bleed panel below it
              would look unanchored.

              tabIndex={-1} plus the mount-on-open effect above make this the
              focus target when the panel opens; Escape is handled by a
              document-level listener (see that same effect) rather than a
              JSX handler here, since jsx-a11y flags keyboard handlers on a
              non-interactive role. */}
          {!isListView && (
            <div
              id="quickNavPanel"
              ref={panelRef}
              tabIndex={-1}
              role="region"
              aria-label="Quick date navigation"
              inert={quickNavOpen ? undefined : true}
              className={cn(
                'grid sm:max-w-md transition-[grid-template-rows,opacity] duration-200 ease-linear motion-reduce:transition-none',
                quickNavOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                {isMonthView && monthViewDate && monthDisplayDate ? (
                  <MonthStrip activeMonth={monthDisplayDate} onNavigateMonth={navigateToMonth} />
                ) : isDayView && dvDate && dvDisplayDate ? (
                  <MiniMonth
                    open={quickNavOpen}
                    anchorMonth={dvDisplayDate}
                    highlightDates={[dvDate]}
                    onSelectDay={iso => {
                      void navigate({ to: '/day/$date', params: { date: iso } })
                      closeQuickNav()
                    }}
                  />
                ) : isWeekView && weekStartDate && weekDisplayStart ? (
                  <MiniMonth
                    open={quickNavOpen}
                    anchorMonth={weekDisplayStart}
                    highlightDates={weekDates(weekDisplayStart)}
                    onSelectDay={iso => {
                      void navigate({ to: '/week/$date', params: { date: iso } })
                      closeQuickNav()
                    }}
                  />
                ) : !isDayView && !isWeekView && !isMonthView ? (
                  <MiniMonth
                    open={quickNavOpen}
                    anchorMonth={parseDateString(agendaTopDate) ?? today}
                    highlightDates={agendaTopDate ? [parseDateString(agendaTopDate) ?? today] : []}
                    onSelectDay={iso => {
                      requestScrollToDate(iso)
                      closeQuickNav()
                    }}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>

        <section className="flex flex-1 flex-col overflow-hidden min-h-0">
          <Outlet />
        </section>

        <SearchBar />
      </div>

      <CoachTour
        setSidebarOpen={setSidebarOpen}
        navigateHome={navigateHome}
      />
    </>
  )
}
