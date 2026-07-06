import { useState, useMemo } from 'react'
import { AlignLeft, CalendarDays, CalendarClock, Settings2, AlertCircle, Pencil, Check, ChevronUp, ChevronDown, X, Inbox, NotebookPen } from 'lucide-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useStore } from '@/store'
import { setActiveVault } from '@/vaultActions'
import { fmtISO, fmtMonth } from '@/model'
import { useToday, useResetOnChange } from '@/hooks'
import { vaultIcon } from './vaultIcon'
import SettingsDialog from './SettingsDialog'
import { Checkbox } from './ui/checkbox'
import { NO_PARTICIPANT } from '@/hooks'
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

export default function AppSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingFavorites, setEditingFavorites] = useState(false)

  const navigate  = useNavigate()
  const pathname  = useRouterState({ select: s => s.location.pathname })
  const today     = useToday()
  const { isMobile, setOpenMobile } = useSidebar()

  const vaults                  = useStore(s => s.vaults)
  const activeVaultId           = useStore(s => s.activeVaultId)
  const pendingDirReconnect     = useStore(s => s.pendingDirReconnect)
  const favorites               = useStore(s => s.favorites)
  const roots                   = useStore(s => s.roots)
  const items                   = useStore(s => s.items)
  const toggleFavorite          = useStore(s => s.toggleFavorite)
  const reorderFavorites        = useStore(s => s.reorderFavorites)
  const participantFilter       = useStore(s => s.participantFilter)
  const toggleParticipantFilter = useStore(s => s.toggleParticipantFilter)
  const showTasks               = useStore(s => s.showTasks)
  const toggleShowTasks         = useStore(s => s.toggleShowTasks)

  const allParticipants = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      for (const p of item.metadata.participants) {
        const t = p.trim(); if (t) set.add(t)
      }
    }
    return [...set].sort()
  }, [items])

  useResetOnChange([activeVaultId], () => setEditingFavorites(false))

  const isDayView = pathname.startsWith('/day/')

  const close = () => { if (isMobile) setOpenMobile(false) }

  // Calendar views — the three time-based views that the filters below scope to.
  const navItems = [
    { Icon: AlignLeft,     label: 'Agenda', active: pathname === '/',                 onClick: () => { close(); navigate({ to: '/' }) } },
    { Icon: CalendarDays,  label: 'Month',  active: pathname.startsWith('/calendar'), onClick: () => { close(); navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } }) } },
    { Icon: CalendarClock, label: 'Day',    active: isDayView,                        onClick: () => { close(); navigate({ to: '/day/$date', params: { date: fmtISO(today) } }) } },
  ]

  // Content destinations — homes for entries that live outside the calendar, so
  // the calendar filters don't apply to them. Positioned with Favorites, below
  // the calendar card.
  const collectionItems = [
    { Icon: Inbox,       label: 'Backlog', active: pathname.startsWith('/backlog'), onClick: () => { close(); navigate({ to: '/backlog' }) } },
    { Icon: NotebookPen, label: 'Notes',   active: pathname.startsWith('/notes'),   onClick: () => { close(); navigate({ to: '/notes' }) } },
  ]

  return (
    <>
      <Sidebar style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
        <SidebarHeader className="h-[var(--th)] flex-row items-center gap-[10px] px-4 border-b border-sidebar-border shrink-0 py-0">
          <img
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            width="26" height="26"
            style={{ borderRadius: 5 }}
            alt="Meridian"
          />
          <span className="text-[18px] text-sidebar-foreground">Meridian</span>
        </SidebarHeader>

        <SidebarContent>
          {/* Calendar — views and their filters bound as one region so the
              "Show on calendar" toggles read as scoped to all three views,
              not to the Day row they happen to sit beneath. */}
          <SidebarGroup className="p-0 pt-3">
            <div className="mx-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 overflow-hidden">
              <SidebarGroupLabel className="h-auto px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider">Calendar</SidebarGroupLabel>
              <SidebarMenu>
                {navItems.map(({ Icon, label, active, onClick }) => (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={onClick}
                      className="gap-[14px] px-3 py-[11px] h-auto text-[14px] font-medium rounded-none"
                    >
                      <Icon className="size-[19px] stroke-[1.7] shrink-0" />
                      {label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>

              <SidebarSeparator className="mx-3 mt-2" />
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">Show on calendar</div>
              <div className="px-3 pb-2 flex flex-col">
                <label className="flex items-center gap-2 cursor-pointer py-[9px]">
                  <Checkbox
                    checked={showTasks}
                    onCheckedChange={() => toggleShowTasks()}
                    visualClassName="size-[18px] group-data-[state=checked]:bg-sidebar-foreground/70 group-data-[state=checked]:border-sidebar-foreground/70"
                  />
                  <span className="text-[13px]">Tasks</span>
                </label>
                {allParticipants.length > 0 && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer py-[9px]">
                      <Checkbox
                        checked={participantFilter.includes(NO_PARTICIPANT)}
                        onCheckedChange={() => toggleParticipantFilter(NO_PARTICIPANT)}
                        visualClassName="size-[18px] group-data-[state=checked]:bg-sidebar-foreground/70 group-data-[state=checked]:border-sidebar-foreground/70"
                      />
                      <span className="text-[13px] text-muted-foreground italic">No participants</span>
                    </label>
                    {allParticipants.map(p => (
                      <label key={p} className="flex items-center gap-2 cursor-pointer py-[9px]">
                        <Checkbox
                          checked={participantFilter.includes(p)}
                          onCheckedChange={() => toggleParticipantFilter(p)}
                          visualClassName="size-[18px] group-data-[state=checked]:bg-sidebar-foreground/70 group-data-[state=checked]:border-sidebar-foreground/70"
                        />
                        <span className="text-[13px]">{p}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            </div>
          </SidebarGroup>

          {favorites.length > 0 && (
            <SidebarGroup className="p-0 pt-3">
              <SidebarGroupLabel className="flex h-auto items-center px-5 py-1">
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider">Favorites</span>
                <button
                  className="hover:text-foreground p-0.5"
                  onClick={() => setEditingFavorites(e => !e)}
                  title={editingFavorites ? 'Done' : 'Reorder / remove'}
                >
                  {editingFavorites ? <Check size={13} /> : <Pencil size={13} />}
                </button>
              </SidebarGroupLabel>
              <SidebarMenu>
                {favorites.map((slug, idx) => {
                  const title = roots.get(slug)?.title ?? slug
                  return (
                    <SidebarMenuItem key={slug}>
                      {editingFavorites ? (
                        <div className="flex items-center gap-1 px-5 py-[11px] text-[14px] font-medium text-sidebar-foreground/60">
                          <span className="flex-1 truncate">{title}</span>
                          <button disabled={idx === 0} onClick={() => reorderFavorites(idx, idx - 1)} className="disabled:opacity-30 hover:text-sidebar-foreground" title="Move up"><ChevronUp size={13} /></button>
                          <button disabled={idx === favorites.length - 1} onClick={() => reorderFavorites(idx, idx + 1)} className="disabled:opacity-30 hover:text-sidebar-foreground" title="Move down"><ChevronDown size={13} /></button>
                          <button onClick={() => toggleFavorite(slug)} className="hover:text-destructive" title="Remove from favorites"><X size={13} /></button>
                        </div>
                      ) : (
                        <SidebarMenuButton
                          onClick={() => { close(); navigate(slugRoute(slug)) }}
                          className="px-5 h-auto py-[11px] text-[14px] font-medium rounded-none"
                        >
                          <span className="truncate">{title}</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
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
                    className="gap-[14px] px-5 py-[11px] h-auto text-[14px] font-medium rounded-none"
                  >
                    <Icon className="size-[18px] stroke-[1.7] shrink-0" />
                    {label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup className="p-0">
            <SidebarSeparator className="mb-2" />
            <SidebarGroupLabel className="px-5 h-8 text-[11px] font-semibold uppercase tracking-wider">Vaults</SidebarGroupLabel>
            <SidebarMenu>
              {vaults.map(vault => {
                const isActive       = vault.id === activeVaultId
                const needsReconnect = isActive && !!pendingDirReconnect && vault.kind === 'local'
                const VaultIcon      = vaultIcon(vault.kind)
                return (
                  <SidebarMenuItem key={vault.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => { close(); setActiveVault(vault.id) }}
                      className="gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none"
                    >
                      <VaultIcon className="size-[17px] stroke-[1.7] shrink-0" />
                      <span className="flex-1 truncate text-left">{vault.name}</span>
                      {needsReconnect && <span title="Permission needed — click to reconnect"><AlertCircle className="size-[14px] text-note shrink-0" /></span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
            <SidebarSeparator className="my-2" />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-tour="manage-vaults"
                  onClick={() => { close(); setSettingsOpen(true) }}
                  className="gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none"
                >
                  <Settings2 className="size-[17px] stroke-[1.7] shrink-0" />
                  Settings
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
