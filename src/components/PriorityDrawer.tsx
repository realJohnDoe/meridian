import { Flag, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle, DrawerFooter } from './ui/drawer'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import type { Priority } from '../types'

interface Props {
  open: boolean
  value: Priority | null
  onSelect: (p: Priority | null) => void
  onClose: () => void
}

// Priority option config — keeps JSX clean
const PRIORITIES: { value: Priority; label: string; color: string; bg: string; border: string }[] = [
  { value: 'high',   label: 'High',   color: 'var(--p1)', bg: 'rgba(248,113,113,.12)', border: 'rgba(248,113,113,.4)' },
  { value: 'medium', label: 'Medium', color: 'var(--p2)', bg: 'rgba(251,146,60,.12)',  border: 'rgba(251,146,60,.4)'  },
  { value: 'low',    label: 'Low',    color: 'var(--p3)', bg: 'rgba(250,204,21,.12)',  border: 'rgba(250,204,21,.4)'  },
]

export default function PriorityDrawer({ open, value, onSelect, onClose }: Props) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3 pb-6">

        <DrawerTitle>Priority</DrawerTitle>
        <Separator />

        <div className="px-4 pt-4 pb-4 flex flex-col gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              onClick={() => onSelect(p.value)}
              style={{ background: p.bg, color: p.color, borderColor: p.border }}
              className="flex items-center justify-center gap-2 w-full h-11 rounded-xl
                         text-sm font-medium border transition-opacity
                         active:opacity-70"
            >
              <Flag size={14} />
              {p.label}
              {value === p.value && (
                <span className="ml-auto mr-1 text-xs opacity-60">✓</span>
              )}
            </button>
          ))}
        </div>

        <Separator />

        <DrawerFooter>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onSelect(null)}
          >
            <X size={13} />
            None
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>

      </DrawerContent>
    </Drawer>
  )
}
