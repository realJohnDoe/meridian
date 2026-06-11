import { useState } from 'react'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Menu, FolderSync, CalendarCheck2,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, X, Search,
  HardDrive, BookOpen, FolderPlus, AlertCircle,
} from 'lucide-react'
import { useStore } from '../store'
import { syncToDirectory, setActiveVault, addLocalVault } from '../vault'
import { addDays, fmtLong } from '../presentation'
import { fmtISO, fmtMonth } from '../model/expansion'
import { TODAY } from '../constants'
import { entryRoute } from './-entryRoute'
import FilterOverlay from '../components/FilterOverlay'
import EntryOverlay, { isEditScope } from '../components/EntryOverlay'
import UndoToast from '../components/UndoToast'
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
  const [filterQuery, setFilterQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const { editor, edate, escope, etitle } = Route.useSearch()

  const syncDirtyCount      = useStore(s => s.syncDirtyCount)
  const syncFlash           = useStore(s => s.syncFlash)
  const vaults              = useStore(s => s.vaults)
  const activeVaultId       = useStore(s => s.activeVaultId)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)

  const activeVault  = vaults.find(v => v.id === activeVaultId)
  const isWritable   = activeVault?.kind === 'local'
  const vaultName    = activeVault?.name ?? 'Meridian'

  const syncColor = syncFlash
    ? 'var(--task)'
    : !isWritable ? 'var(--muted-foreground)' : syncDirtyCount > 0 ? 'var(--note)' : 'var(--dim)'
  const syncTitle = !isWritable
    ? 'Example vault is read-only'
    : syncDirtyCount > 0
      ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''} — click to sync`
      : 'All synced'

  const isDayView = pathname.startsWith('/day/')
  const dvDate = isDayView
    ? new Date(pathname.split('/')[2] + 'T00:00:00')
    : null

  const handleToday = () => {
    if (isDayView) {
      navigate({ to: '/day/$date', params: { date: fmtISO(TODAY) } })
    } else if (pathname.startsWith('/calendar')) {
      navigate({ to: '/calendar/$month', params: { month: fmtMonth(TODAY) } })
    } else {
      useStore.setState({ scrollToTodayOnce: true })
      navigate({ to: '/' })
    }
  }

  const navItems = [
    { Icon: AlignLeft,    label: 'Agenda', active: pathname === '/',                   onClick: () => { setSidebarOpen(false); navigate({ to: '/' }) } },
    { Icon: CalendarDays, label: 'Month',  active: pathname.startsWith('/calendar'),   onClick: () => { setSidebarOpen(false); navigate({ to: '/calendar/$month', params: { month: fmtMonth(TODAY) } }) } },
    { Icon: CalendarClock, label: 'Day',   active: isDayView,                          onClick: () => { setSidebarOpen(false); navigate({ to: '/day/$date', params: { date: fmtISO(TODAY) } }) } },
  ]

  const openEntry = (occ: Occurrence, scope?: EditScope) => navigate(entryRoute(occ, scope))

  return (
    <>
      <header className="topbar" id="mainTop">
        {isDayView && dvDate ? (
          <div className="tb-l tb-l--day">
            <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
            <span className="dv-date-title">{fmtLong(dvDate)}</span>
            <button className="ib" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, -1)) } })}><ChevronLeft /></button>
            <button className="ib" onClick={() => navigate({ to: '/day/$date', params: { date: fmtISO(addDays(dvDate, 1)) } })}><ChevronRight /></button>
          </div>
        ) : (
          <div className="tb-l" id="tbDefault">
            <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
            <span className="vault-name">{vaultName}</span>
          </div>
        )}
        <div className="tb-r">
          <button className="ib" onClick={syncToDirectory} title={syncTitle} style={{ color: syncColor }}><FolderSync /></button>
          <button className="ib" onClick={handleToday} title="Today"><CalendarCheck2 /></button>
        </div>
      </header>

      <section className="view active">
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
          <nav className="flex-1 overflow-y-auto py-2">
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
              const isActive  = vault.id === activeVaultId
              const needsReconnect = isActive && !!pendingDirReconnect && vault.kind === 'local'
              const VaultIcon = vault.kind === 'local' ? HardDrive : BookOpen
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
              variant="ghost"
              onClick={() => { setSidebarOpen(false); addLocalVault() }}
              className="w-full justify-start gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <FolderPlus className="size-[17px] stroke-[1.7] shrink-0" />
              Add local vault
            </Button>
          </nav>
        </SheetContent>
      </Sheet>

      <div className="bottom-float">
        <UndoToast />
        <div className="search-bar-wrap">
          <Search size={15} className="search-bar-icon" />
          <input
            id="filterInput"
            className="search-bar-input"
            placeholder="Search or create…"
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filterQuery) {
                navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, editor: 'new', etitle: filterQuery, edate: undefined, escope: undefined }) })
                setFilterQuery('')
              }
            }}
          />
          {filterQuery && (
            <button className="search-bar-clear" onClick={() => setFilterQuery('')}>
              <X size={13} />
            </button>
          )}
          <button
            className="search-bar-add"
            onClick={() => {
              navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, editor: 'new', etitle: filterQuery || undefined, edate: undefined, escope: undefined }) })
              if (filterQuery) setFilterQuery('')
            }}
          ><Plus size={16} /></button>
        </div>
      </div>

      <FilterOverlay
        query={filterQuery}
        onOpen={openEntry}
        onCreate={(title: string) => {
          navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, editor: 'new', etitle: title, edate: undefined, escope: undefined }) })
          setFilterQuery('')
        }}
      />

      {editor && (
        <EntryOverlay editor={editor} edate={edate} escope={escope} etitle={etitle} />
      )}
    </>
  )
}
