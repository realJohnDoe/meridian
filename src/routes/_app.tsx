import { useState, useEffect, useCallback } from 'react'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Menu, FolderSync, CalendarCheck2,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, X, Search,
  HardDrive, BookOpen, GitBranch, Settings2, AlertCircle,
} from 'lucide-react'
import { useStore } from '../store'
import { syncToBackend } from '../storage/sync'
import { setActiveVault } from '../storage/vaultRegistry'
import { on } from '../events'
import { addDays, fmtLong } from '../presentation'
import { fmtISO, fmtMonth } from '../model/dateUtils'
import { useToday } from '../hooks/useToday'
import { entryRoute, newEntryRoute } from './-entryRoute'
import FilterOverlay from '@/search/FilterOverlay'
import EntryOverlay, { isEditScope } from '@/editor/EntryOverlay'
import ManageVaultsDialog from '@/vaults/ManageVaultsDialog'
import CoachTour from '@/onboarding/CoachTour'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'
import type { Occurrence, EditScope } from '../types'

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
  const [filterQuery,   setFilterQuery]   = useState('')
  const [sidebarOpen,   setSidebarOpen]   = useState(false)
  const [addVaultOpen,  setAddVaultOpen]  = useState(false)

  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const { editor, edate, escope, etitle } = Route.useSearch()

  const today = useToday()

  const syncDirtyCount      = useStore(s => s.syncDirtyCount)
  const syncFlash           = useStore(s => s.syncFlash)
  const syncError           = useStore(s => s.syncError)
  const vaults              = useStore(s => s.vaults)
  const activeVaultId       = useStore(s => s.activeVaultId)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)

  useEffect(() => on('sync:done', () => {
    useStore.setState({ syncFlash: true })
    setTimeout(() => useStore.setState({ syncFlash: false }), 800)
  }), [])

  const activeVault  = vaults.find(v => v.id === activeVaultId)
  const isWritable   = activeVault?.kind === 'local' || activeVault?.kind === 'github'
  const vaultName    = activeVault?.name ?? 'Meridian'

  const syncColor = syncError
    ? 'var(--destructive)'
    : syncFlash ? 'var(--task)'
    : !isWritable ? 'var(--muted-foreground)'
    : syncDirtyCount > 0 ? 'var(--note)'
    : 'var(--dim)'
  const syncTitle = !isWritable
    ? 'Example vault is read-only'
    : syncError
      ? 'Sync failed — click to retry'
      : syncDirtyCount > 0
        ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''} — syncing…`
        : 'All synced'

  const isDayView = pathname.startsWith('/day/')
  const dvDate = isDayView
    ? new Date(pathname.split('/')[2] + 'T00:00:00')
    : null

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

  const navItems = [
    { Icon: AlignLeft,    label: 'Agenda', active: pathname === '/',                   onClick: () => { setSidebarOpen(false); navigate({ to: '/' }) } },
    { Icon: CalendarDays, label: 'Month',  active: pathname.startsWith('/calendar'),   onClick: () => { setSidebarOpen(false); navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } }) } },
    { Icon: CalendarClock, label: 'Day',   active: isDayView,                          onClick: () => { setSidebarOpen(false); navigate({ to: '/day/$date', params: { date: fmtISO(today) } }) } },
  ]

  const openEntry = (occ: Occurrence, scope?: EditScope) => navigate(entryRoute(occ, scope))

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

  function vaultIcon(kind: string) {
    if (kind === 'local')   return HardDrive
    if (kind === 'github')  return GitBranch
    return BookOpen
  }

  return (
    <>
      <header className="h-topbar flex items-center justify-between px-3.5 border-b border-border shrink-0 bg-background z-10" id="mainTop">
        {isDayView && dvDate ? (
          <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
            <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={() => setSidebarOpen(true)} title="Menu"><Menu size={18} /></Button>
            <span className="flex-1 font-[family-name:var(--disp)] italic text-sm text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{fmtLong(dvDate)}</span>
            <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Previous day" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) } })}><ChevronLeft size={18} /></Button>
            <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Next day" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) } })}><ChevronRight size={18} /></Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0" id="tbDefault">
            <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={() => setSidebarOpen(true)} title="Menu"><Menu size={18} /></Button>
            <span className="font-[family-name:var(--disp)] italic text-base text-secondary-foreground">{vaultName}</span>
          </div>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={syncToBackend} title={syncTitle} style={{ color: syncColor }}><FolderSync size={18} /></Button>
          <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={handleToday} title="Today"><CalendarCheck2 size={18} /></Button>
        </div>
      </header>

      <section data-tour="main-content" className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </section>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[260px] sm:max-w-[260px] p-0 flex flex-col bg-sidebar border-r border-sidebar-border"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex items-center gap-[10px] h-[var(--th)] px-4 border-b border-sidebar-border shrink-0">
            <img
              src={`${import.meta.env.BASE_URL}icon-192.png`}
              width="26" height="26"
              style={{ borderRadius: 5 }}
              alt="Meridian"
            />
            <span className="font-[family-name:var(--disp)] italic text-[16px] text-sidebar-foreground">Meridian</span>
          </div>
          <nav data-tour="nav-group" className="flex-1 overflow-y-auto py-2">
            {navItems.map(({ Icon, label, active, onClick }) => (
              <Button
                key={label}
                variant="ghost"
                onClick={onClick}
                className={cn(
                  'w-full justify-start gap-[14px] px-5 h-auto py-[13px] text-[14px] font-medium rounded-none',
                  'text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  active && 'text-sidebar-primary bg-primary/12 hover:text-sidebar-primary hover:bg-primary/12',
                )}
              >
                <Icon className="size-[19px] stroke-[1.7] shrink-0" />
                {label}
              </Button>
            ))}

            <div className="px-5 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-dim border-t border-sidebar-border mt-2">
              Vaults
            </div>

            {vaults.map(vault => {
              const isActive       = vault.id === activeVaultId
              const needsReconnect = isActive && !!pendingDirReconnect && vault.kind === 'local'
              const VaultIcon      = vaultIcon(vault.kind)
              return (
                <Button
                  key={vault.id}
                  variant="ghost"
                  onClick={() => { setSidebarOpen(false); setActiveVault(vault.id) }}
                  className={cn(
                    'w-full justify-start gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none',
                    'text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    isActive && 'text-sidebar-primary bg-primary/12 hover:text-sidebar-primary hover:bg-primary/12',
                  )}
                >
                  <VaultIcon className="size-[17px] stroke-[1.7] shrink-0" />
                  <span className="flex-1 truncate text-left">{vault.name}</span>
                  {needsReconnect && <span title="Permission needed — click to reconnect"><AlertCircle className="size-[14px] text-note shrink-0" /></span>}
                </Button>
              )
            })}

            <Button
              data-tour="manage-vaults"
              variant="ghost"
              onClick={() => { setSidebarOpen(false); setAddVaultOpen(true) }}
              className="w-full justify-start gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Settings2 className="size-[17px] stroke-[1.7] shrink-0" />
              Manage vaults
            </Button>
          </nav>
        </SheetContent>
      </Sheet>

      <ManageVaultsDialog open={addVaultOpen} onOpenChange={setAddVaultOpen} />

      <div className="absolute left-3.5 right-3.5 flex flex-col gap-2 pointer-events-none z-30" style={{ bottom: 'calc(var(--nh) + 0.875rem)' }}>
        <div data-tour="search-bar" className="search-bar-wrap">
          <Search size={15} className="shrink-0 stroke-muted-foreground fill-none" />
          <input
            id="filterInput"
            className="flex-1 bg-transparent border-none outline-none text-foreground text-sm min-w-0 placeholder:text-muted-foreground"
            placeholder="Search or create…"
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filterQuery) {
                navigate(newEntryRoute(filterQuery))
                setFilterQuery('')
              }
            }}
          />
          {filterQuery && (
            <Button variant="ghost" size="icon" className="w-7 h-7 rounded-full shrink-0 text-muted-foreground" aria-label="Clear search" onClick={() => setFilterQuery('')}>
              <X size={13} />
            </Button>
          )}
          <Button
            variant="brand"
            size="icon"
            className="w-9 h-9 rounded-full shrink-0 hover:scale-[1.08] active:scale-[.93] [&_svg]:size-4"
            aria-label="New entry"
            onClick={() => {
              navigate(newEntryRoute(filterQuery))
              if (filterQuery) setFilterQuery('')
            }}
          ><Plus size={16} /></Button>
        </div>
      </div>

      <FilterOverlay
        query={filterQuery}
        onOpen={openEntry}
        onCreate={(title: string) => {
          navigate(newEntryRoute(title))
          setFilterQuery('')
        }}
      />

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
