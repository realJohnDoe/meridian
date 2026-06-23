import { useState, useEffect } from 'react'
import { AlignLeft, CalendarDays, CalendarClock, Settings2, AlertCircle, Pencil, Check, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useStore } from '@/store'
import { setActiveVault } from '@/storage/vaultRegistry'
import { fmtISO, fmtMonth } from '@/model/dateUtils'
import { useToday } from '@/hooks/useToday'
import { vaultIcon } from './vaultIcon'
import SettingsDialog from './SettingsDialog'
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
import { slugRoute } from '@/routes/-entryRoute'

export default function AppSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingFavorites, setEditingFavorites] = useState(false)

  const navigate  = useNavigate()
  const pathname  = useRouterState({ select: s => s.location.pathname })
  const today     = useToday()
  const { isMobile, setOpenMobile } = useSidebar()

  const vaults              = useStore(s => s.vaults)
  const activeVaultId       = useStore(s => s.activeVaultId)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)
  const favorites           = useStore(s => s.favorites)
  const roots               = useStore(s => s.roots)
  const toggleFavorite      = useStore(s => s.toggleFavorite)
  const reorderFavorites    = useStore(s => s.reorderFavorites)

  useEffect(() => { setEditingFavorites(false) }, [activeVaultId])

  const isDayView = pathname.startsWith('/day/')

  const close = () => { if (isMobile) setOpenMobile(false) }

  const navItems = [
    { Icon: AlignLeft,     label: 'Agenda', active: pathname === '/',                 onClick: () => { close(); navigate({ to: '/' }) } },
    { Icon: CalendarDays,  label: 'Month',  active: pathname.startsWith('/calendar'), onClick: () => { close(); navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } }) } },
    { Icon: CalendarClock, label: 'Day',    active: isDayView,                        onClick: () => { close(); navigate({ to: '/day/$date', params: { date: fmtISO(today) } }) } },
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
          <span className="font-[family-name:var(--disp)] italic text-[16px] text-sidebar-foreground">Meridian</span>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="p-0 pt-2" data-tour="nav-group">
            <SidebarMenu>
              {navItems.map(({ Icon, label, active, onClick }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    isActive={active}
                    onClick={onClick}
                    className="gap-[14px] px-5 py-[13px] h-auto text-[14px] font-medium rounded-none"
                    size="lg"
                  >
                    <Icon className="size-[19px] stroke-[1.7] shrink-0" />
                    {label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          {favorites.length > 0 && (
            <>
              <SidebarSeparator />
              <SidebarGroup className="p-0">
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
            </>
          )}

          <SidebarSeparator />
          <SidebarGroup className="p-0">
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
