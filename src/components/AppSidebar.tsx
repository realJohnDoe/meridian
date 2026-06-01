import { AlignLeft, CalendarDays, CalendarClock } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useStore } from '../store'
import type { PrimaryView } from '../store'

const NAV_ITEMS: { view: PrimaryView; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { view: 'agenda',   label: 'Agenda', Icon: AlignLeft },
  { view: 'calendar', label: 'Month',  Icon: CalendarDays },
  { view: 'day',      label: 'Day',    Icon: CalendarClock },
]

export function AppSidebar() {
  const primaryView = useStore(s => s.primaryView)
  const topOverlay  = useStore(s => s.overlayStack[s.overlayStack.length - 1])
  const setPrimary  = useStore(s => s.setPrimaryView)
  const { setOpen, setOpenMobile } = useSidebar()

  const navTo = (v: PrimaryView) => {
    setOpen(false)
    setOpenMobile(false)
    setPrimary(v)
  }

  return (
    <Sidebar collapsible="offcanvas">
      {/* Header — matches topbar height, horizontal layout */}
      <SidebarHeader className="h-[var(--th)] flex-row items-center gap-2.5 px-4 py-0 border-b">
        <img
          src={`${import.meta.env.BASE_URL}icon-192.png`}
          width="26"
          height="26"
          style={{ borderRadius: 5 }}
          alt="Meridian"
        />
        <span style={{ fontFamily: 'var(--disp)', fontStyle: 'italic', fontSize: 16 }}>
          Meridian
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map(({ view, label, Icon }) => (
              <SidebarMenuItem key={view}>
                <SidebarMenuButton
                  size="lg"
                  isActive={primaryView === view && !topOverlay}
                  onClick={() => navTo(view)}
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
