import { useState, useEffect } from 'react'
import { AlignLeft, CalendarDays, CalendarClock, Settings2, AlertCircle, Pencil, Check, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useStore } from '../store'
import { setActiveVault } from '../storage/vaultRegistry'
import { fmtISO, fmtMonth } from '../model/dateUtils'
import { useToday } from '../hooks/useToday'
import { vaultIcon } from '../lib/vaultIcon'
import SettingsDialog from './SettingsDialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { slugRoute } from '../routes/-entryRoute'

interface SidebarProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function Sidebar({ open, onOpenChange }: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingFavorites, setEditingFavorites] = useState(false)

  const navigate  = useNavigate()
  const pathname  = useRouterState({ select: s => s.location.pathname })
  const today     = useToday()

  const vaults              = useStore(s => s.vaults)
  const activeVaultId       = useStore(s => s.activeVaultId)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)
  const favorites           = useStore(s => s.favorites)
  const roots               = useStore(s => s.roots)
  const toggleFavorite      = useStore(s => s.toggleFavorite)
  const reorderFavorites    = useStore(s => s.reorderFavorites)

  useEffect(() => { setEditingFavorites(false) }, [activeVaultId])

  const isDayView = pathname.startsWith('/day/')

  const navItems = [
    { Icon: AlignLeft,     label: 'Agenda', active: pathname === '/',                 onClick: () => { onOpenChange(false); navigate({ to: '/' }) } },
    { Icon: CalendarDays,  label: 'Month',  active: pathname.startsWith('/calendar'), onClick: () => { onOpenChange(false); navigate({ to: '/calendar/$month', params: { month: fmtMonth(today) } }) } },
    { Icon: CalendarClock, label: 'Day',    active: isDayView,                        onClick: () => { onOpenChange(false); navigate({ to: '/day/$date', params: { date: fmtISO(today) } }) } },
  ]

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
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

            {favorites.length > 0 && (
              <>
                <div className="flex items-center px-5 pt-5 pb-1 border-t border-sidebar-border mt-2">
                  <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-dim">Favorites</span>
                  <button
                    className="text-dim hover:text-foreground p-0.5"
                    onClick={() => setEditingFavorites(e => !e)}
                    title={editingFavorites ? 'Done' : 'Reorder / remove'}
                  >
                    {editingFavorites ? <Check size={13} /> : <Pencil size={13} />}
                  </button>
                </div>

                {favorites.map((slug, idx) => {
                  const title = roots.get(slug)?.title ?? slug
                  return (
                    <div key={slug} className="flex items-center">
                      {editingFavorites ? (
                        <div className="flex-1 flex items-center gap-1 px-5 py-[11px] text-[14px] font-medium text-dim">
                          <span className="flex-1 truncate">{title}</span>
                          <button
                            disabled={idx === 0}
                            onClick={() => reorderFavorites(idx, idx - 1)}
                            className="disabled:opacity-30 hover:text-foreground"
                            title="Move up"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            disabled={idx === favorites.length - 1}
                            onClick={() => reorderFavorites(idx, idx + 1)}
                            className="disabled:opacity-30 hover:text-foreground"
                            title="Move down"
                          >
                            <ChevronDown size={13} />
                          </button>
                          <button
                            onClick={() => toggleFavorite(slug)}
                            className="hover:text-destructive"
                            title="Remove from favorites"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => { onOpenChange(false); navigate(slugRoute(slug)) }}
                          className="w-full justify-start px-5 h-auto py-[11px] text-[14px] font-medium rounded-none text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        >
                          <span className="truncate">{title}</span>
                        </Button>
                      )}
                    </div>
                  )
                })}
              </>
            )}

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
                  onClick={() => { onOpenChange(false); setActiveVault(vault.id) }}
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

            <div className="border-t border-sidebar-border mt-2">
              <Button
                data-tour="manage-vaults"
                variant="ghost"
                onClick={() => { onOpenChange(false); setSettingsOpen(true) }}
                className="w-full justify-start gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <Settings2 className="size-[17px] stroke-[1.7] shrink-0" />
                Settings
              </Button>
            </div>
          </nav>
        </SheetContent>
      </Sheet>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
