import { useCallback } from 'react'
import { createFileRoute, Outlet, useNavigate, useMatch } from '@tanstack/react-router'
import { Menu, CalendarCheck2 } from 'lucide-react'
import { addDays, fmtTopBarMonth } from '@/format'
import { fmtISO, fmtMonth, parseDateString, parseMonth, weekStartsOn } from '@/model'
import { useToday } from '@/hooks'
import { useStore } from '@/store'
import {
  useMonthPreview, useDayPreview, useWeekPreview,
  useAgendaTopDate, requestScrollToToday, weekStartFor,
} from '@/calendar'
import { CoachTour } from '@/onboarding'
import { AppSidebar, SyncButton, SearchBar, ViewFilterButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { TopbarShell } from './-topbarShell'
import { PagedTopbar } from './-pagedTopbar'
import { TopbarLabel } from './-topbarLabel'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
  validateSearch: (search: Record<string, unknown>): { sq?: string } => ({
    sq: typeof search.sq === 'string' ? search.sq : undefined,
  }),
})

function AppLayout() {
  return (
    // `_app` is the one shell that stays exactly one screen tall and clips
    // itself, so every scroller below it (the agenda's virtualizer above all)
    // scrolls its own element instead of the document — see index.css, where
    // html/body/#root/#app deliberately only carry `min-height`.
    //
    // `flex-none` is load-bearing, not tidying. This is a flex item of
    // `#app` (`display:flex; flex-direction:column`), so its *height* is the
    // main size, and a flex item's main size comes from `flex-basis`, not from
    // `height`. `flex-1` sets `flex-basis: 0%` — a percentage, resolved
    // against the container's inner main size — and #app's height is now
    // `auto` with only a `min-height`, i.e. indefinite. A percentage basis
    // that can't resolve is treated as `content`, so the wrapper sized to the
    // agenda's full virtualized spacer (~11000px measured on a Pixel 7
    // viewport), `h-svh` never applied, and the *document* scrolled instead:
    // the topbar scrolled away, rows started ~2500px down the page, and
    // scroll-to-today did nothing because the agenda's own scroll element had
    // scrollHeight === clientHeight and could not scroll at all.
    //
    // `flex-none` (`flex: 0 0 auto`) leaves the basis at `auto`, which means
    // "use the main size property" — `h-svh` — and the cap holds again.
    <SidebarProvider
      className="h-svh flex-none min-h-0 overflow-hidden"
      style={{ '--sidebar-width': '260px' } as React.CSSProperties}
    >
      <AppSidebar />
      <AppMain />
    </SidebarProvider>
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

  const isDayView    = !!dayMatch
  const isWeekView   = !!weekMatch
  const isMonthView  = !!monthMatch
  const isListView   = !!backlogMatch || !!notesMatch
  const dvDate       = dayMatch ? new Date(dayMatch.params.date + 'T00:00:00') : null
  const monthViewDate = monthMatch ? parseMonth(monthMatch.params.month) : null
  // The route param need not already be week-start-normalized (see WeekView),
  // so it's normalized here before anything reads it.
  const weekStartDate = weekMatch ? weekStartFor(new Date(weekMatch.params.date + 'T00:00:00'), ws) : null

  // monthPreview/dayPreview/weekPreview (set by the swipe carousel on touchend
  // / crossing the halfway point) show the label the gesture is heading
  // toward immediately, ahead of the route committing — chevron navigation
  // and Today still key off the route's own monthViewDate/dvDate/weekStartDate.
  const monthDisplayDate = monthViewDate && (monthPreview ? parseMonth(monthPreview) : monthViewDate)
  const dvDisplayDate    = dvDate && (dayPreview ? (parseDateString(dayPreview) ?? dvDate) : dvDate)
  const weekDisplayStart = weekStartDate && (weekPreview ? (parseDateString(weekPreview) ?? weekStartDate) : weekStartDate)
  const weekDisplayEnd   = weekDisplayStart && addDays(weekDisplayStart, 6)

  // Backlog/Notes are fixed strings; the agenda default view shows just the
  // month of its topmost visible row, matching Day/Month/Week's own topbar —
  // it never abbreviates, so long and short are the same string.
  const [topBarLabel, topBarLabelShort] = (() => {
    if (backlogMatch) return ['Backlog', 'Backlog']
    if (notesMatch)   return ['Notes', 'Notes']
    const d = agendaTopDate ? new Date(agendaTopDate + 'T00:00:00') : today
    const label = fmtTopBarMonth(d, today)
    return [label, label]
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

  return (
    <>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        <header
          id="mainTop"
          className="h-topbar pt-[env(safe-area-inset-top)] flex items-center border-b border-border shrink-0 bg-background z-10 shadow-md"
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
                  prevLabel="Previous day"
                  nextLabel="Next day"
                  onPrev={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) }, replace: true })}
                  onNext={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) }, replace: true })}
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
                  prevLabel="Previous week"
                  nextLabel="Next week"
                  onPrev={() => navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, -7)) }, replace: true })}
                  onNext={() => navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, 7)) }, replace: true })}
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
                  prevLabel="Previous month"
                  nextLabel="Next month"
                  onPrev={() => navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)) }, replace: true })}
                  onNext={() => navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)) }, replace: true })}
                />
              ) : (
                <div className="flex flex-1 items-center gap-2 min-w-0" id="tbDefault">
                  {isMobile && <IconButton variant="ghost" className="text-dim" onClick={openSidebar} title="Menu" label="Menu"><Menu size={18} /></IconButton>}
                  {/* flex-1 here (and on the row above) is load-bearing, not cosmetic: TopbarLabel's
                      @container needs a size that comes from the flex algorithm's available-space
                      distribution. A shrink-to-fit width (flex-basis: auto, sized from content) would
                      collapse to 0 instead, because container-type: inline-size makes the browser
                      disregard the label's own content when computing that shrink-to-fit size. */}
                  <TopbarLabel long={topBarLabel} short={topBarLabelShort} className="flex-1 text-base text-foreground" />
                </div>
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
