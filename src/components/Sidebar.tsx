import { useState, lazy, Suspense } from 'react'
import { AlignLeft, CalendarDays, CalendarClock, Settings2, AlertCircle, Pencil, Check, ChevronUp, ChevronDown, X, Inbox, NotebookPen } from 'lucide-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useStore } from '@/store'
import { setActiveVault } from '@/vaultActions'
import { useResetOnChange } from '@/hooks'
import { useCurrentDate, requestScrollToDate } from '@/calendar'
import { FlipList } from './FlipList'
import { vaultIcon } from './vaultIcon'
import { Checkbox } from './ui/checkbox'
import { IconButton } from './primitives/icon-button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from './ui/sidebar'
import { slugRoute } from '@/routes'

// Lazy: pulls in the settings UI plus the add-vault wizard, which isn't
// needed on the agenda's cold-start critical path — deferred until Settings
// is actually opened.
const SettingsDialog = lazy(() => import('./SettingsDialog'))

export default function AppSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false)
  const [editingFavorites, setEditingFavorites] = useState(false)

  const navigate    = useNavigate()
  const pathname    = useRouterState({ select: s => s.location.pathname })
  const currentDate = useCurrentDate()
  const { isMobile, setOpenMobile } = useSidebar()

  const vaults                  = useStore(s => s.vaults)
  const activeVaultId           = useStore(s => s.activeVaultId)
  const pendingDirReconnect     = useStore(s => s.pendingDirReconnect)
  const favorites               = useStore(s => s.favorites)
  const roots                   = useStore(s => s.roots)
  const toggleFavorite          = useStore(s => s.toggleFavorite)
  const reorderFavorites        = useStore(s => s.reorderFavorites)
  const showTasks               = useStore(s => s.showTasks)
  const toggleShowTasks         = useStore(s => s.toggleShowTasks)

  useResetOnChange([activeVaultId], () => setEditingFavorites(false))

  const isDayView = pathname.startsWith('/day/')

  const close = () => { if (isMobile) setOpenMobile(false) }

  // Calendar views — the three time-based views the tasks toggle below scopes
  // to. Month/Day nav targets carry over `currentDate` (the day last focused
  // in any calendar view — see calendar/viewState.ts) instead of always
  // resetting to today, so switching views lands where you were looking.
  // Agenda's jump is gated on actually switching in (pathname !== '/'):
  // re-clicking Agenda while already there would otherwise re-center its
  // window on wherever it's already scrolled to — a no-op that still forces
  // a full section rebuild and a jarring re-scroll.
  const navItems = [
    {
      Icon: AlignLeft, label: 'Agenda', active: pathname === '/',
      onClick: () => { close(); if (pathname !== '/') requestScrollToDate(currentDate); void navigate({ to: '/' }) },
    },
    { Icon: CalendarDays,  label: 'Month',  active: pathname.startsWith('/calendar'), onClick: () => { close(); void navigate({ to: '/calendar/$month', params: { month: currentDate.slice(0, 7) } }) } },
    { Icon: CalendarClock, label: 'Day',    active: isDayView,                        onClick: () => { close(); void navigate({ to: '/day/$date', params: { date: currentDate } }) } },
  ]

  // Content destinations — homes for entries that live outside the calendar.
  // The participant filter (topbar) applies to them; the tasks toggle does not,
  // since each of these is already single-kind. Positioned with Favorites,
  // below the calendar card.
  const collectionItems = [
    { Icon: Inbox,       label: 'Backlog', active: pathname.startsWith('/backlog'), onClick: () => { close(); void navigate({ to: '/backlog' }) } },
    { Icon: NotebookPen, label: 'Notes',   active: pathname.startsWith('/notes'),   onClick: () => { close(); void navigate({ to: '/notes' }) } },
  ]

  return (
    <>
      <Sidebar style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
        <SidebarHeader className="h-[var(--th)] flex-row items-center gap-2.5 px-4 border-b border-sidebar-border shrink-0 pt-[env(safe-area-inset-top)] pb-0">
          <img
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            width="26" height="26"
            style={{ borderRadius: 5 }}
            alt="Meridian"
          />
          <span className="text-lg text-sidebar-foreground">Meridian</span>
        </SidebarHeader>

        <SidebarContent className="pb-[max(calc(var(--spacing)*2),env(safe-area-inset-bottom))]">
          {/* Calendar — views and the tasks toggle bound as one region so the
              toggle reads as scoped to all three views, not to the Day row it
              happens to sit beneath. */}
          <SidebarGroup className="p-0 pt-3">
            <div className="mx-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 overflow-hidden">
              <SidebarGroupLabel className="h-auto px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-wider">Calendar</SidebarGroupLabel>
              <SidebarMenu>
                {navItems.map(({ Icon, label, active, onClick }) => (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={onClick}
                      className="gap-3.5 px-3 py-3 h-auto text-sm font-medium rounded-none"
                    >
                      <Icon className="size-5 stroke-[1.7] shrink-0" />
                      {label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>

              {/* Not a filter — a calendar composition option, which is why it
                  stays here while the participant filter lives in the topbar.
                  Label spelled out in full so it needs no group heading and
                  can't be mistaken for scoping Backlog or Notes. */}
              <SidebarSeparator className="mx-3 mt-2" />
              <div className="px-3 py-1">
                <label className="flex items-center gap-2 cursor-pointer py-2.5">
                  <Checkbox
                    checked={showTasks}
                    onCheckedChange={() => toggleShowTasks()}
                    visualClassName="size-4.5 group-data-[state=checked]:bg-sidebar-foreground/70 group-data-[state=checked]:border-sidebar-foreground/70"
                  />
                  <span className="text-sm">Show tasks on calendar</span>
                </label>
              </div>
            </div>
          </SidebarGroup>

          {favorites.length > 0 && (
            <SidebarGroup className="p-0 pt-3">
              <SidebarGroupLabel className="flex h-auto items-center px-5 py-1">
                <span className="flex-1 text-2xs font-semibold uppercase tracking-wider">Favorites</span>
                <IconButton
                  label={editingFavorites ? 'Done editing favorites' : 'Reorder or remove favorites'}
                  title={editingFavorites ? 'Done' : 'Reorder / remove'}
                  className="hover:text-foreground p-0.5"
                  onClick={() => setEditingFavorites(e => !e)}
                >
                  {editingFavorites ? <Check size={13} /> : <Pencil size={13} />}
                </IconButton>
              </SidebarGroupLabel>
              {/* The rows are <li>s, so the box that folds has to sit outside
                  the <ul> rather than wrap its contents. */}
              <FlipList items={favorites} itemAttr="data-fav-key" animateHeight>
                <SidebarMenu>
                  {favorites.map((slug, idx) => {
                    const title = roots.get(slug)?.title ?? slug
                    return (
                      <SidebarMenuItem key={slug} data-fav-key={slug}>
                        {editingFavorites ? (
                          <div className="flex items-center gap-1 px-5 py-3 text-sm font-medium text-sidebar-foreground/60">
                            <span className="flex-1 truncate">{title}</span>
                            <IconButton hit="pad" label="Move up" title="Move up" disabled={idx === 0} onClick={() => reorderFavorites(idx, idx - 1)} className="disabled:opacity-30 hover:text-sidebar-foreground"><ChevronUp size={13} /></IconButton>
                            <IconButton hit="pad" label="Move down" title="Move down" disabled={idx === favorites.length - 1} onClick={() => reorderFavorites(idx, idx + 1)} className="disabled:opacity-30 hover:text-sidebar-foreground"><ChevronDown size={13} /></IconButton>
                            <IconButton hit="pad" label="Remove from favorites" title="Remove from favorites" onClick={() => toggleFavorite(slug)} className="hover:text-destructive"><X size={13} /></IconButton>
                          </div>
                        ) : (
                          <SidebarMenuButton
                            onClick={() => { close(); void navigate(slugRoute(slug)) }}
                            className="px-5 h-auto py-3 text-sm font-medium rounded-none"
                          >
                            <span className="truncate">{title}</span>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </FlipList>
            </SidebarGroup>
          )}

          {favorites.length > 0 && <SidebarSeparator />}

          {/* Backlog & Notes — content destinations. Full-weight rows; their
              position below Favorites is enough to signal lower priority. */}
          <SidebarGroup className="p-0">
            <SidebarMenu>
              {collectionItems.map(({ Icon, label, active, onClick }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    isActive={active}
                    onClick={onClick}
                    className="gap-3.5 px-5 py-3 h-auto text-sm font-medium rounded-none"
                  >
                    <Icon className="size-4.5 stroke-[1.7] shrink-0" />
                    {label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup className="p-0">
            <SidebarSeparator className="mb-2" />
            <SidebarGroupLabel className="px-5 h-8 text-2xs font-semibold uppercase tracking-wider">Vaults</SidebarGroupLabel>
            <SidebarMenu>
              {vaults.map(vault => {
                const isActive       = vault.id === activeVaultId
                const needsReconnect = isActive && !!pendingDirReconnect && vault.kind === 'local'
                const VaultIcon      = vaultIcon(vault.kind)
                return (
                  <SidebarMenuItem key={vault.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => { close(); void setActiveVault(vault.id) }}
                      className="gap-3.5 px-5 h-auto py-3 text-sm font-medium rounded-none"
                    >
                      <VaultIcon className="size-4.5 stroke-[1.7] shrink-0" />
                      <span className="flex-1 truncate text-left">{vault.name}</span>
                      {needsReconnect && <span title="Permission needed — click to reconnect"><AlertCircle className="size-3.5 text-note shrink-0" /></span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
            <SidebarSeparator className="my-2" />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => { close(); setSettingsOpen(true); setHasOpenedSettings(true) }}
                  className="gap-3.5 px-5 h-auto py-3 text-sm font-medium rounded-none"
                >
                  <Settings2 className="size-4.5 stroke-[1.7] shrink-0" />
                  Settings
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {hasOpenedSettings && (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
    </>
  )
}
