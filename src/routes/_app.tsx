import { useState, useCallback, useEffect } from 'react'
import { createFileRoute, Outlet, useNavigate, useMatch } from '@tanstack/react-router'
import { Menu, CalendarCheck2 } from 'lucide-react'
import { addDays, fmtTopBarDay, fmtTopBarDayShort, fmtTopBarMonth, fmtTopBarWeek } from '@/format'
import { fmtISO, fmtMonth, parseDateString, parseMonth, weekStartsOn } from '@/model'
import { useToday } from '@/hooks'
import { useStore } from '@/store'
import { onVaultChanged } from '@/storage'
import {
  resetCalendarOnVaultChange, useMonthPreview, useDayPreview, useWeekPreview,
  useAgendaTopDate, requestScrollToToday, weekStartFor,
} from '@/calendar'
import { CoachTour } from '@/onboarding'
import { AppSidebar, SyncButton, SearchBar, ParticipantFilterButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/cn'
import { TopbarSlotContext } from './-topbarSlot'
import { topbarEdgePadding } from './-topbarEdgePadding'
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
    <SidebarProvider
      className="flex-1 min-h-0 overflow-hidden"
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

  // When a vault activates, discard the previous vault's calendar-view state
  // (saved agenda scroll, cached occurrence expansions, cached agenda
  // sections — see resetCalendarOnVaultChange) and flag a scroll-to-today.
  // Registered here — not in AgendaPage — because AppMain stays mounted
  // across every app route: a vault switch made while in the editor, month,
  // day, or a list view would otherwise be missed (AgendaPage is unmounted
  // then), leaving the next agenda visit to restore a stale, cross-vault
  // offset near the top. AgendaView owns the virtualizer and performs the
  // actual scroll when the flag is set.
  useEffect(() => onVaultChanged(() => {
    resetCalendarOnVaultChange()
    requestScrollToToday()
  }), [])

  const entrySlugMatch = useMatch({ from: '/_app/entry/$slug', shouldThrow: false })
  const entryNewMatch  = useMatch({ from: '/_app/entry/new', shouldThrow: false })
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

  const isEntryView  = !!entrySlugMatch || !!entryNewMatch
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

  // Backlog/Notes are fixed strings; the agenda default view is date-based
  // like day mode. Month mode (below) computes its own label directly — it
  // never abbreviates, so it doesn't need a long/short pair.
  const [topBarLabel, topBarLabelShort] = (() => {
    if (backlogMatch) return ['Backlog', 'Backlog']
    if (notesMatch)   return ['Notes', 'Notes']
    const d = agendaTopDate ? new Date(agendaTopDate + 'T00:00:00') : today
    return [fmtTopBarDay(d, today), fmtTopBarDayShort(d, today)]
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

  // Callback ref so the portal target is available synchronously after mount.
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null)

  return (
    <TopbarSlotContext value={slotEl}>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        <header
          id="mainTop"
          className={cn(
            'h-topbar pt-[env(safe-area-inset-top)] flex items-center border-b border-border shrink-0 bg-background z-10 shadow-md',
            isEntryView
              ? 'overflow-hidden'
              // Right edge always leads with an icon button; left edge only does on mobile
              // (hamburger) — desktop's left edge is a plain text label. gap-2 is a floor,
              // not the usual spacing: justify-between alone only inserts space when the
              // label has room to spare, so a wide participant-filter pill (active filter)
              // can otherwise squeeze all the way up against the truncated label.
              : cn('justify-between gap-2', topbarEdgePadding(isMobile, true)),
          )}
        >
          {isEntryView ? (
            // Portal target — entry route injects topbar controls here via createPortal
            <div ref={setSlotEl} className="flex flex-1 items-center h-full overflow-hidden" />
          ) : isDayView && dvDate && dvDisplayDate ? (
            // replace: true on nav — mirrors the day carousel's swipe-to-page
            // semantics (see DayView) so chevron taps and swipes leave the
            // same, single history entry per visit instead of chevron taps
            // alone stacking up a back-press-per-day trail.
            <PagedTopbar
              isMobile={isMobile}
              openSidebar={openSidebar}
              label={fmtTopBarDay(dvDisplayDate, today)}
              shortLabel={fmtTopBarDayShort(dvDisplayDate, today)}
              prevLabel="Previous day"
              nextLabel="Next day"
              onPrev={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) }, replace: true })}
              onNext={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) }, replace: true })}
            />
          ) : isWeekView && weekStartDate && weekDisplayStart && weekDisplayEnd ? (
            // replace: true on nav — mirrors the day/month carousels' swipe-to-page
            // semantics (see WeekView) so chevron taps and swipes leave the
            // same, single history entry per visit instead of chevron taps
            // alone stacking up a back-press-per-week trail.
            <PagedTopbar
              isMobile={isMobile}
              openSidebar={openSidebar}
              label={fmtTopBarWeek(weekDisplayStart, weekDisplayEnd, today)}
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
          )}
          {!isEntryView && (
            <div className="flex items-center gap-0.5 shrink-0">
              <ParticipantFilterButton />
              <SyncButton />
              {!isListView && (
                <IconButton variant="ghost" className="text-dim" onClick={handleToday} title="Today" label="Today"><CalendarCheck2 size={18} /></IconButton>
              )}
            </div>
          )}
        </header>

        <section className="flex flex-1 flex-col overflow-hidden min-h-0">
          <Outlet />
        </section>

        {!isEntryView && <SearchBar />}
      </div>

      <CoachTour
        setSidebarOpen={setSidebarOpen}
        navigateHome={navigateHome}
      />
    </TopbarSlotContext>
  )
}
