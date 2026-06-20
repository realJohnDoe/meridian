import { useCallback } from 'react'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Menu, CalendarCheck2,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useStore } from '../store'
import { addDays, fmtTopBarDay, fmtTopBarMonth } from '../presentation'
import { fmtISO, fmtMonth, parseMonth } from '../model/dateUtils'
import { useToday } from '../hooks/useToday'
import EntryOverlay, { isEditScope } from '@/editor/EntryOverlay'
import CoachTour from '@/onboarding/CoachTour'
import AppSidebar from '@/components/Sidebar'
import SyncButton from '@/components/SyncButton'
import SearchBar from '@/components/SearchBar'
import { Button } from '../components/ui/button'
import { SidebarProvider, useSidebar } from '../components/ui/sidebar'
import type { EditScope } from '../types'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
  validateSearch: (search: Record<string, unknown>): {
    editor?: string
    edate?: string
    escope?: EditScope
    etitle?: string
  } => ({
    editor: typeof search.editor === 'string' ? search.editor : undefined,
    edate:  typeof search.edate  === 'string' ? search.edate  : undefined,
    escope: isEditScope(search.escope) ? search.escope : undefined,
    etitle: typeof search.etitle === 'string' ? search.etitle : undefined,
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
  // The menu button and coach tour drive the mobile sheet only. On desktop the
  // sidebar is persistent, so open/close requests are ignored there (users can
  // still collapse it via the Ctrl/Cmd+B shortcut).
  const setSidebarOpen = useCallback((open: boolean) => {
    if (isMobile) setOpenMobile(open)
  }, [isMobile, setOpenMobile])

  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const { editor, edate, escope, etitle } = Route.useSearch()

  const today = useToday()

  const agendaTopDate = useStore(s => s.agendaTopDate)

  const isDayView   = pathname.startsWith('/day/')
  const isMonthView = pathname.startsWith('/calendar')
  const dvDate = isDayView ? new Date(pathname.split('/')[2] + 'T00:00:00') : null
  const monthViewDate = isMonthView
    ? (pathname.split('/')[2] ? parseMonth(pathname.split('/')[2]) : null)
    : null

  const topBarLabel = (() => {
    if (monthViewDate) return fmtTopBarMonth(monthViewDate, today)
    const d = agendaTopDate ? new Date(agendaTopDate + 'T00:00:00') : today
    return fmtTopBarDay(d, today)
  })()

  const handleToday = () => {
    if (isDayView) {
      navigate({ to: '/day/$date', params: { date: fmtISO(today) } })
    } else if (pathname.startsWith('/calendar')) {
      navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } })
    } else {
      useStore.setState({ scrollToTodayOnce: true })
      navigate({ to: '/' })
    }
  }

  const navigateHome = useCallback(() => navigate({ to: '/' }), [navigate])
  const openTourEntry = useCallback(() => navigate({
    to: '.' as const,
    search: (_prev: Record<string, unknown>) => ({
      editor: '02-your-first-task',
      escope: 'single' as EditScope,
      edate: undefined,
      etitle: undefined,
    }),
  }), [navigate])

  const openSidebar = () => setSidebarOpen(true)

  return (
    <>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="h-topbar flex items-center justify-between px-3.5 border-b border-border shrink-0 bg-background z-10" id="mainTop">
          {isDayView && dvDate ? (
            <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0 md:hidden" onClick={openSidebar} title="Menu"><Menu size={18} /></Button>
              <span className="flex-1 font-[family-name:var(--disp)] italic text-sm text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{fmtTopBarDay(dvDate, today)}</span>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Previous day" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) } })}><ChevronLeft size={18} /></Button>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Next day" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) } })}><ChevronRight size={18} /></Button>
            </div>
          ) : isMonthView && monthViewDate ? (
            <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0 md:hidden" onClick={openSidebar} title="Menu"><Menu size={18} /></Button>
              <span className="flex-1 font-[family-name:var(--disp)] italic text-sm text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{topBarLabel}</span>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Previous month" onClick={() => navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1)) } })}><ChevronLeft size={18} /></Button>
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Next month" onClick={() => navigate({ to: '/calendar/$month', params: { month: fmtMonth(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1)) } })}><ChevronRight size={18} /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0" id="tbDefault">
              <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0 md:hidden" onClick={openSidebar} title="Menu"><Menu size={18} /></Button>
              <span className="font-[family-name:var(--disp)] italic text-sm text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{topBarLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <SyncButton />
            <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={handleToday} title="Today"><CalendarCheck2 size={18} /></Button>
          </div>
        </header>

        <section data-tour="main-content" className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </section>

        <SearchBar />
      </div>

      {editor && (
        <EntryOverlay editor={editor} edate={edate} escope={escope} etitle={etitle} />
      )}

      <CoachTour
        setSidebarOpen={setSidebarOpen}
        navigateHome={navigateHome}
        openTourEntry={openTourEntry}
      />
    </>
  )
}
