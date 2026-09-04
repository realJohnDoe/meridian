import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, Outlet, useNavigate, useMatch } from '@tanstack/react-router'
import { CalendarCheck2 } from 'lucide-react'
import { addDays, fmtTopBarMonth } from '@/format'
import { fmtISO, fmtMonth, parseDateString, parseMonth, weekStartsOn } from '@/model'
import { useToday, useMediaQuery, useResetOnChange } from '@/hooks'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import { Popover, PopoverContent } from '@/components/ui/popover'
import {
  useMonthPreview, useDayPreview, useWeekPreview,
  useAgendaTopDate, requestScrollToToday, requestScrollToDate, weekStartFor, firstWeekStartInMonth,
  useQuickNavOpen, toggleQuickNav, closeQuickNav, MonthStrip, MiniMonth,
  useCurrentDate, setCurrentDate, weekdayKeptDate, useQuickNavSwipe, setQuickNavBrowsePreview,
} from '@/calendar'
import { CoachTour } from '@/onboarding'
import { SyncButton, ViewFilterButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import AppSidebar from './-appSidebar'
import SearchBar from './-searchBar'
import { TopbarShell } from './-topbarShell'
import { PagedTopbar } from './-pagedTopbar'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
  validateSearch: (search: Record<string, unknown>): { sq?: string } => ({
    sq: typeof search.sq === 'string' ? search.sq : undefined,
  }),
})

/**
 * Derives a "preview-aware" display value from a route value and its
 * optional preview key (monthPreview/dayPreview/weekPreview, set by a swipe
 * carousel on touchend, ahead of the route committing — see viewState.ts) —
 * the pattern repeated below for each of Month/Day/Week's own topbar label
 * and quick-nav panel props. Falls back to `raw` when there's no preview, or
 * `parse` can't make sense of one (a malformed key should never happen, but
 * the parse functions return null/undefined on invalid input, and a
 * fallback beats blowing up on it).
 */
function previewAware<T>(raw: T, previewKey: string | null, parse: (key: string) => T | null | undefined): T {
  if (!previewKey) return raw
  return parse(previewKey) ?? raw
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
  const currentDate   = useCurrentDate()
  const ws            = weekStartsOn(useStore(s => s.localePrefs))
  const quickNavOpen  = useQuickNavOpen()
  // The agenda's quick-nav grid's own anchor, frozen to whatever agendaTopDate
  // was at the moment the panel opened — NOT read live thereafter. The panel's
  // own browse gesture drives requestScrollToDate, which moves the agenda's
  // scroll position and therefore agendaTopDate; feeding that live value back
  // in as anchorMonth/highlightDates re-renders MiniMonth mid-browse with a
  // changed anchorMonth, which its own useResetOnChange reads as "the parent
  // wants a different month" and yanks `month` back to it — the gesture's own
  // consequence re-steering the widget that produced it. Landing off by one
  // row (an estimate-vs-measured gap, or any future change to how the agenda
  // seeds its scroll) is enough to trigger this, and once it does, repeated
  // swipes can never advance past the first browsed month. useResetOnChange
  // (render-phase, not an effect) means this updates in the same render pass
  // `quickNavOpen` flips, so the grid still opens showing the agenda's current
  // position — it just stops tracking it once open.
  const [agendaQuickNavAnchor, setAgendaQuickNavAnchor] = useState(agendaTopDate)
  useResetOnChange([quickNavOpen], () => setAgendaQuickNavAnchor(agendaTopDate))
  // Same breakpoint ResponsiveModal uses for its dialog/drawer split (md,
  // 768px) — deliberately not useSidebar's own `isMobile` (lg, 1024px),
  // which answers a different question (does the sidebar collapse behind a
  // hamburger). Below it the quick-nav panel stays the inline slide-down
  // card it's always been; at or above it, the panel opens as a Popover
  // anchored to the toggle button instead (see the two render sites below).
  const isDesktopQuickNav = useMediaQuery('(min-width: 768px)')

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
  //
  // Desktop's panel is a Radix Popover instead, which owns autofocus-into-
  // Content-on-open and Escape-to-dismiss on its own — this manual version is
  // only for the mobile inline panel below, which isn't Radix-managed (its
  // close-focus-restore is handled separately too, see PopoverContent's own
  // onCloseAutoFocus below). Running this same effect on desktop actively
  // fights Radix's own FocusScope: our manual focus() moves focus outside the
  // still-mounted, still-trapping Content, which the trap then yanks back, so
  // by the time Content actually unmounts (after its close transition)
  // neither attempt has stuck and focus falls through to the document body.
  useEffect(() => {
    if (isDesktopQuickNav) return
    if (quickNavOpen) panelRef.current?.focus()
    if (!quickNavOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeQuickNav()
      toggleButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [quickNavOpen, isDesktopQuickNav])

  const isDayView    = !!dayMatch
  const isWeekView   = !!weekMatch
  const isMonthView  = !!monthMatch
  const isListView   = !!backlogMatch || !!notesMatch
  // Vertical swipe on the topbar chrome as an alternate gesture for the quick-nav
  // panel's own disclosure button — see useQuickNavSwipe. Disabled on Backlog/Notes,
  // which render no panel to toggle.
  const quickNavSwipeRef = useQuickNavSwipe<HTMLDivElement>(!isListView)
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
  const monthDisplayDate = monthViewDate && previewAware(monthViewDate, monthPreview, parseMonth)
  const dvDisplayDate    = dvDate && previewAware(dvDate, dayPreview, parseDateString)
  const weekDisplayStart = weekStartDate && previewAware(weekStartDate, weekPreview, parseDateString)
  // currentDate carried forward into the previewed week, same weekday kept —
  // the week-view quick-nav panel's anchor month and highlighted day both key
  // off this (see below) rather than currentDate directly, so they track a
  // swipe in progress instead of only jumping once it commits.
  const currentDisplayDate = isWeekView
    ? previewAware(currentDate, weekPreview, key => weekdayKeptDate(key, currentDate, ws))
    : currentDate

  // The day/week/month topbar's paging configuration — one lookup instead of
  // three near-identical PagedTopbar branches below, which used to differ
  // only in the unit noun, the label's source date, and where prev/next
  // navigate. replace: true on every nav call mirrors each carousel's own
  // swipe-to-page semantics (see DayView/WeekView/MonthView) so chevron taps
  // and swipes leave the same, single history entry per visit instead of
  // stacking a back-press-per-unit trail. null for backlog/notes/agenda,
  // which render the plain (non-paged) PagedTopbar branches below instead.
  const pagedView: { unit: string; label: string; onPrev: () => void; onNext: () => void } | null =
    isDayView && dvDate && dvDisplayDate ? {
      unit: 'day',
      label: fmtTopBarMonth(dvDisplayDate, today),
      onPrev: () => void navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) }, replace: true }),
      onNext: () => void navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) }, replace: true }),
    } : isWeekView && weekStartDate && weekDisplayStart ? {
      unit: 'week',
      label: fmtTopBarMonth(weekDisplayStart, today),
      onPrev: () => void navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, -7)) }, replace: true }),
      onNext: () => void navigate({ to: '/week/$date', params: { date: fmtISO(addDays(weekStartDate, 7)) }, replace: true }),
    } : isMonthView && monthViewDate && monthDisplayDate ? {
      unit: 'month',
      label: fmtTopBarMonth(monthDisplayDate, today),
      onPrev: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)) }, replace: true }),
      onNext: () => void navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)) }, replace: true }),
    } : null

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
      // WeekPage's own effect always runs the route date through
      // setCurrentWeekKeepingWeekday, which preserves the *previously*
      // selected weekday rather than adopting the target date's own — see
      // its own doc comment. Setting currentDate here first means that
      // effect reads it back as already-today and no-ops, so "Today"
      // actually lands currentDate (and the quick-nav highlight) on today
      // instead of on today's week with the old weekday kept.
      setCurrentDate(fmtISO(today))
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

  // The quick-nav panel's own content, per view — rendered twice below (the
  // mobile inline panel and the desktop Popover), which is why this is a
  // plain function rather than being inlined at either call site. `monthNav`
  // is the one thing that differs between the two: the mobile panel still
  // pages by MonthStrip's scrollable chip row, but that reads as too much
  // chrome inside a popover's tighter width, so the desktop popover instead
  // leaves each grid's own (normally hidden) caption + prev/next chevrons as
  // the paging control — see MiniMonth's own monthNav doc comment. Month
  // view has no day grid here to begin with (just the MonthStrip itself, its
  // own quick-nav content), so monthNav doesn't apply to it either way.
  const renderQuickNavPanel = (monthNav: 'strip' | 'buttons') => (
    isMonthView && monthViewDate && monthDisplayDate ? (
      <MonthStrip activeMonth={monthDisplayDate} onNavigateMonth={navigateToMonth} />
    ) : isDayView && dvDate && dvDisplayDate ? (
      <MiniMonth
        open={quickNavOpen}
        anchorMonth={dvDisplayDate}
        highlightDates={[dvDisplayDate]}
        monthNav={monthNav}
        onSelectDay={iso => {
          void navigate({ to: '/day/$date', params: { date: iso } })
          closeQuickNav()
        }}
        onBrowseMonth={d => {
          // replace: true — browsing months here is view state,
          // not a navigation event, matching the carousels'
          // own commit navigations (see e.g. MonthView).
          void navigate({ to: '/day/$date', params: { date: fmtISO(d) }, replace: true })
        }}
        // Cheap, decoupled preview instead of the navigation above —
        // _app.day.$date.tsx reads this in place of its own route param
        // while it's set, so the day view tracks the swipe live without a
        // route commit on every frame. See quickNavBrowsePreview's own doc
        // comment in viewState.ts.
        onBrowseMonthPreview={d => setQuickNavBrowsePreview(fmtISO(d))}
      />
    ) : isWeekView && weekStartDate && weekDisplayStart ? (
      <MiniMonth
        open={quickNavOpen}
        // Same source as highlightDates below (currentDisplayDate),
        // not weekDisplayStart — the week's first day and the
        // actually selected day routinely fall in different months
        // (any week straddling a month boundary), and anchoring to
        // weekDisplayStart while highlighting currentDisplayDate
        // opened the panel on a month that didn't contain its own
        // highlighted day. currentDisplayDate rather than plain
        // currentDate so both track an in-progress swipe (see its
        // own comment above) instead of only jumping once it commits.
        anchorMonth={parseDateString(currentDisplayDate) ?? weekDisplayStart}
        highlightDates={[parseDateString(currentDisplayDate) ?? weekDisplayStart]}
        monthNav={monthNav}
        onSelectDay={iso => {
          // See the "Today" handler's comment above: set
          // currentDate directly so the picked day — not the
          // previously selected weekday — is what ends up
          // highlighted and current.
          setCurrentDate(iso)
          void navigate({ to: '/week/$date', params: { date: iso } })
          closeQuickNav()
        }}
        onBrowseMonth={d => {
          // `d` is the 1st of the browsed month, which routinely
          // isn't itself the locale's week-start weekday — landing
          // there literally would show (and label, via
          // weekDisplayStart above) whichever week contains it,
          // which can round backward into the *previous* month
          // (see firstWeekStartInMonth) and desync the topbar
          // label from the month strip highlighting the month
          // just tapped. Land on that month's first proper week
          // instead, so both agree.
          const iso = fmtISO(firstWeekStartInMonth(d, ws))
          setCurrentDate(iso)
          void navigate({ to: '/week/$date', params: { date: iso }, replace: true })
        }}
        // Same firstWeekStartInMonth landing as the commit above, computed
        // here rather than by the route file so day and week never have to
        // agree on one shared interpretation of the raw browsed date — see
        // quickNavBrowsePreview's own doc comment in viewState.ts.
        onBrowseMonthPreview={d => setQuickNavBrowsePreview(fmtISO(firstWeekStartInMonth(d, ws)))}
      />
    ) : !isDayView && !isWeekView && !isMonthView ? (
      <MiniMonth
        open={quickNavOpen}
        // Frozen snapshot, not agendaTopDate directly — see
        // agendaQuickNavAnchor's own doc comment above for why.
        anchorMonth={parseDateString(agendaQuickNavAnchor) ?? today}
        highlightDates={agendaQuickNavAnchor ? [parseDateString(agendaQuickNavAnchor) ?? today] : []}
        monthNav={monthNav}
        onSelectDay={iso => {
          requestScrollToDate(iso)
          closeQuickNav()
        }}
        onBrowseMonth={d => requestScrollToDate(fmtISO(d))}
        // No onBrowseMonthPreview: unlike day/week's own decoupled preview
        // state (quickNavBrowsePreview), the agenda has nothing cheap to do
        // on preview — requestScrollToDate moves agendaAnchor and re-renders
        // the agenda's own row list, so firing it on preview *and* commit
        // doubles that work on every swipe for no benefit, since the panel's
        // own highlight (MonthStrip, the highlighted day) already tracks the
        // gesture via MiniMonth's local browsePreview state regardless. The
        // agenda behind the panel now updates once, on commit, instead of
        // live-tracking the drag — a deliberate, visible behaviour change.
      />
    ) : null
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
        <div ref={quickNavSwipeRef} className="shrink-0 z-10 bg-background border-b border-border shadow-md">
          {/* Wraps the header (holding whichever view's PagedTopbar — and,
              via its popoverAnchor prop, the disclosure button that anchors
              this) together with the desktop PopoverContent below, so both
              sit inside the same Popover context regardless of which view's
              branch is currently mounted. `open` only ever goes true from
              our own toggle button's onClick (PopoverAnchor carries no click
              handling of its own — see PagedTopbar); onOpenChange only ever
              runs the other direction, from Radix's own outside-click/Escape
              handling closing it — so the two can never race each other. */}
          <Popover open={quickNavOpen && isDesktopQuickNav} onOpenChange={o => { if (!o) closeQuickNav() }}>
            <header
              id="mainTop"
              className="h-topbar pt-[env(safe-area-inset-top)] flex items-center"
              data-topbar
            >
              <TopbarShell
                leftHasButton={isMobile}
                left={
                  pagedView ? (
                    <PagedTopbar
                      isMobile={isMobile}
                      openSidebar={openSidebar}
                      label={pagedView.label}
                      paging={{
                        prevLabel: `Previous ${pagedView.unit}`,
                        nextLabel: `Next ${pagedView.unit}`,
                        onPrev: pagedView.onPrev,
                        onNext: pagedView.onNext,
                      }}
                      expanded={quickNavOpen}
                      onToggle={toggleQuickNav}
                      toggleRef={toggleButtonRef}
                      popoverAnchor
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
                      popoverAnchor
                    />
                  )
                }
                right={
                  <div className="flex items-center gap-0.5 shrink-0">
                    <ViewFilterButton />
                    <SyncButton />
                    {!isListView && (
                      <IconButton variant="ghost" className="text-muted-foreground" onClick={handleToday} title="Today" label="Today"><CalendarCheck2 size={18} /></IconButton>
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

                Below the `isDesktopQuickNav` breakpoint this is the only form
                the panel takes, stretched edge-to-edge. At or above it, the
                PopoverContent below takes over as the actual panel, so this
                stays collapsed instead (`quickNavOpen && !isDesktopQuickNav`)
                — see isDesktopQuickNav's own comment above for why a floating
                popover reads better once the topbar has room to spare instead
                of stretching a full-width card under the label.

                tabIndex={-1} plus the mount-on-open effect above make this the
                focus target when the panel opens; Escape is handled by a
                document-level listener (see that same effect) rather than a
                JSX handler here, since jsx-a11y flags keyboard handlers on a
                non-interactive role. */}
            {!isListView && (
              <div
                id={isDesktopQuickNav ? undefined : 'quickNavPanel'}
                ref={panelRef}
                tabIndex={-1}
                role="region"
                aria-label="Quick date navigation"
                inert={quickNavOpen && !isDesktopQuickNav ? undefined : true}
                className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-linear motion-reduce:transition-none',
                  quickNavOpen && !isDesktopQuickNav ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                )}
              >
                <div className="overflow-hidden">
                  {renderQuickNavPanel('strip')}
                </div>
              </div>
            )}
            {/* At/above the desktop breakpoint this — not the div above,
                permanently `inert` there — is the actual panel a keyboard/
                screen-reader user lands in and Escape returns focus from, so
                it (not the inline div) carries the shared "quickNavPanel" id
                the toggle button's aria-controls and the focus-management
                effect above key off. Radix focuses Content itself on open, no
                help needed there — but its own default close-focus-restore
                targets `Popover.Trigger`'s own ref, which this button isn't
                (see `popoverAnchor`'s doc comment on PagedTopbar for why:
                Anchor only, so the button's own onClick keeps sole ownership
                of opening it). With no Trigger, Radix has nothing to restore
                focus to and leaves it wherever the browser defaults to once
                Content unmounts (the document body) — onCloseAutoFocus below
                substitutes the toggle button as that target instead, for
                every dismissal path (Escape, outside click), not just the
                Escape case the mobile inline panel's own effect covers. */}
            {!isListView && (
              <PopoverContent
                id={isDesktopQuickNav ? 'quickNavPanel' : undefined}
                align="start"
                onCloseAutoFocus={e => {
                  e.preventDefault()
                  toggleButtonRef.current?.focus()
                }}
              >
                {renderQuickNavPanel('buttons')}
              </PopoverContent>
            )}
          </Popover>
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
