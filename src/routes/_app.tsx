import { useState, useCallback, useEffect } from 'react'
import { createFileRoute, Outlet, useNavigate, useMatch } from '@tanstack/react-router'
import { Menu, CalendarCheck2 } from 'lucide-react'
import { addDays, fmtTopBarMonth } from '@/format'
import { fmtISO, fmtMonth, parseDateString, parseMonth, weekStartsOn } from '@/model'
import { useToday, useShellMode } from '@/hooks'
import { useStore } from '@/store'
import { onVaultChanged } from '@/storage'
import {
  resetCalendarOnVaultChange, useMonthPreview, useDayPreview, useWeekPreview,
  useAgendaTopDate, requestScrollToToday, weekStartFor,
} from '@/calendar'
import { CoachTour } from '@/onboarding'
import { AppSidebar, SyncButton, SearchBar, ViewFilterButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { TopbarSlotContext } from './-topbarSlot'
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
    <SidebarProvider
      className="flex-1 min-h-0 overflow-hidden"
      data-shell-pane="row"
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

  // When a vault activates with *different* content, discard the previous
  // vault's calendar-view state (saved agenda scroll, cached occurrence
  // expansions, cached agenda sections — see resetCalendarOnVaultChange). That
  // reset also re-targets the agenda at today, so nothing further is needed.
  //
  // Registered here — not in AgendaPage — because AppMain stays mounted across
  // every app route: a vault switch made while in the editor, month, day, or a
  // list view would otherwise be missed (AgendaPage is unmounted then), leaving
  // the next agenda visit to restore a stale, cross-vault offset near the top.
  //
  // `contentReplaced` is false on the cache-first restore, where the vault
  // being activated is the one already painted from Dexie. Resetting there
  // threw away the expansion and grouping the first paint had just built — and
  // since that emission is gated on an OAuth refresh plus two GitHub round
  // trips, it landed as a visible correction up to a second in. The agenda
  // seeds itself at today from viewState's default now, so there is genuinely
  // nothing to do on that path.
  useEffect(() => onVaultChanged(({ contentReplaced }) => {
    if (!contentReplaced) return
    resetCalendarOnVaultChange()
  }), [])

  const entryMatch     = useMatch({ from: '/_app/entry/$vault/$slug', shouldThrow: false })
  // The pre-multi-vault `/entry/<slug>` URL, which redirects to the route above
  // once the vault is restored. Counted as an entry view too, so the layout
  // doesn't flash the agenda's topbar and search bar during that hop.
  const entryLegacyMatch = useMatch({ from: '/_app/entry/$slug', shouldThrow: false })
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

  const isEntryView  = !!entryMatch || !!entryLegacyMatch || !!entryNewMatch

  // The entry routes are the only ones with a text input inside a scrolling
  // pane, and the only ones with no virtualizer — so they get the flow shell,
  // where the browser scrolls a focused input above the keyboard itself. Every
  // other route keeps the fixed shell the virtualizers require.
  useShellMode(isEntryView ? 'flow' : 'fixed')
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

  // Callback ref so the portal target is available synchronously after mount.
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null)

  return (
    <TopbarSlotContext value={slotEl}>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden" data-shell-pane="row">
        <header
          id="mainTop"
          className="h-topbar pt-[env(safe-area-inset-top)] flex items-center border-b border-border shrink-0 bg-background z-10 shadow-md"
          data-shell-topbar
        >
          {isEntryView ? (
            // Portal target — entry route injects topbar controls here via createPortal
            <div ref={setSlotEl} className="flex flex-1 items-center h-full overflow-hidden" />
          ) : (
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
          )}
        </header>

        <section className="flex flex-1 flex-col overflow-hidden min-h-0" data-shell-pane="col">
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
