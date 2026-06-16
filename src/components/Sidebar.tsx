import { useState } from 'react'
import { AlignLeft, CalendarDays, CalendarClock, Settings2, AlertCircle } from 'lucide-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useStore } from '../store'
import { setActiveVault } from '../storage/vaultRegistry'
import { fmtISO, fmtMonth } from '../model/dateUtils'
import { useToday } from '../hooks/useToday'
import { vaultIcon } from '../lib/vaultIcon'
import ManageVaultsDialog from '@/vaults/ManageVaultsDialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

interface SidebarProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function Sidebar({ open, onOpenChange }: SidebarProps) {
  const [addVaultOpen, setAddVaultOpen] = useState(false)

  const navigate  = useNavigate()
  const pathname  = useRouterState({ select: s => s.location.pathname })
  const today     = useToday()

  const vaults              = useStore(s => s.vaults)
  const activeVaultId       = useStore(s => s.activeVaultId)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)

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

            <Button
              data-tour="manage-vaults"
              variant="ghost"
              onClick={() => { onOpenChange(false); setAddVaultOpen(true) }}
              className="w-full justify-start gap-[14px] px-5 h-auto py-[11px] text-[14px] font-medium rounded-none text-dim hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Settings2 className="size-[17px] stroke-[1.7] shrink-0" />
              Manage vaults
            </Button>
          </nav>
        </SheetContent>
      </Sheet>

      <ManageVaultsDialog open={addVaultOpen} onOpenChange={setAddVaultOpen} />
    </>
  )
}
