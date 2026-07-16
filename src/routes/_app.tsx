import { useState, useCallback } from 'react'
import { createFileRoute, Outlet, useNavigate, useMatch } from '@tanstack/react-router'
import {
  Menu, CalendarCheck2,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useStore } from '@/store'
import { addDays, fmtTopBarDay, fmtTopBarMonth } from '@/format'
import { fmtISO, fmtMonth, parseMonth } from '@/model'
import { useToday } from '@/hooks'
import { CoachTour } from '@/onboarding'
import { AppSidebar, SyncButton, SearchBar } from '@/components'
import { Button } from '@/components/ui/button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/cn'
import { TopbarSlotContext } from './-topbarSlot'

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

  const entrySlugMatch = useMatch({ from: '/_app/entry/$slug', shouldThrow: false })
  const entryNewMatch  = useMatch({ from: '/_app/entry/new', shouldThrow: false })
  const dayMatch       = useMatch({ from: '/_app/day/$date', shouldThrow: false })
  const monthMatch     = useMatch({ from: '/_app/calendar/$month', shouldThrow: false })
  const backlogMatch   = useMatch({ from: '/_app/backlog', shouldThrow: false })
  const notesMatch     = useMatch({ from: '/_app/notes', shouldThrow: false })

  const today         = useToday()
  const agendaTopDate = useStore(s => s.agendaTopDate)

  const isEntryView  = !!entrySlugMatch || !!entryNewMatch
  const isDayView    = !!dayMatch
  const isMonthView  = !!monthMatch
  const isListView   = !!backlogMatch || !!notesMatch
  const dvDate       = dayMatch ? new Date(dayMatch.params.date + 'T00:00:00') : null
  const monthViewDate = monthMatch ? parseMonth(monthMatch.params.month) : null

  const topBarLabel = (() => {
    if (backlogMatch) return 'Backlog'
    if (notesMatch)   return 'Notes'
    if (monthViewDate) return fmtTopBarMonth(monthViewDate, today)
    const d = agendaTopDate ? new Date(agendaTopDate + 'T00:00:00') : today
    return fmtTopBarDay(d, today)
  })()

  const handleToday = () => {
    if (isDayView) {
      void navigate({ to: '/day/$date', params: { date: fmtISO(today) } })
    } else if (isMonthView) {
      void navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } })
    } else {
      useStore.setState({ scrollToTodayOnce: true })
      void navigate({ to: '/' })
    }
  }

  const navigateHome   = useCallback(() => void navigate({ to: '/' }), [navigate])
  const openSidebar    = () => setSidebarOpen(true)

  // Callback ref so the portal target is available synchronously after mount.
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null)

  return (
    <TopbarSlotContext.Provider value={slotEl}>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        <header
          id="mainTop"
          className={cn(
            'h-topbar pt-[env(safe-area-inset-top)] flex items-center border-b border-border shrink-0 bg-background z-10',
            isEntryView ? 'overflow-hidden' : 'px-3.5 justify-between',
          )}
        >
          {isEntryView ? (
            // Portal target — entry route injects topbar controls here via createPortal
            <div ref={setSlotEl} className="flex flex-1 items-center h-full overflow-hidden" />
          ) : isDayView && dvDate ? (
            <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
              {isMobile && <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={openSidebar} title="Menu" aria-label="Menu"><Menu size={18} /></Button>}
              <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{fmtTopBarDay(dvDate, today)}</span>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Previous day" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) } })}><ChevronLeft size={18} /></Button>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Next day" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) } })}><ChevronRight size={18} /></Button>
            </div>
          ) : isMonthView && monthViewDate ? (
            <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
              {isMobile && <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={openSidebar} title="Menu" aria-label="Menu"><Menu size={18} /></Button>}
              <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{topBarLabel}</span>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Previous month" onClick={() => navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)) } })}><ChevronLeft size={18} /></Button>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Next month" onClick={() => navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)) } })}><ChevronRight size={18} /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0" id="tbDefault">
              {isMobile && <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={openSidebar} title="Menu" aria-label="Menu"><Menu size={18} /></Button>}
              <span className="text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{topBarLabel}</span>
            </div>
          )}
          {!isEntryView && (
            <div className="flex items-center gap-0.5 shrink-0">
              <SyncButton />
              {!isListView && (
                <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={handleToday} title="Today" aria-label="Today"><CalendarCheck2 size={18} /></Button>
              )}
            </div>
          )}
        </header>

        <section data-tour="main-content" className="flex flex-1 flex-col overflow-hidden min-h-0">
          <Outlet />
        </section>

        {!isEntryView && <SearchBar />}
      </div>

      <CoachTour
        setSidebarOpen={setSidebarOpen}
        navigateHome={navigateHome}
      />
    </TopbarSlotContext.Provider>
  )
}
