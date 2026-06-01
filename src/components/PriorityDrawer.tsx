import { Flag, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle, DrawerFooter } from './ui/drawer'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import { badgeVariants } from './ui/badge'
import { cn } from '../lib/utils'
import type { Priority } from '../types'

// Same token-backed classes used by the priority chip in EntryEditor
const PRIORITY_CLASS: Record<string, string> = {
  high:   'aria-[pressed=true]:bg-p1/15 aria-[pressed=true]:border-p1 aria-[pressed=true]:text-p1',
  medium: 'aria-[pressed=true]:bg-p2/15 aria-[pressed=true]:border-p2 aria-[pressed=true]:text-p2',
  low:    'aria-[pressed=true]:bg-p3/15 aria-[pressed=true]:border-p3 aria-[pressed=true]:text-p3',
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'high',   label: 'High'   },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low'    },
]

interface Props {
  open: boolean
  value: Priority | null
  onSelect: (p: Priority | null) => void
  onClose: () => void
}

export default function PriorityDrawer({ open, value, onSelect, onClose }: Props) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3 pb-6">

        <DrawerTitle>Priority</DrawerTitle>
        <Separator />

        <div className="flex gap-2 px-4 pt-4 pb-4">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              onClick={() => onSelect(p.value)}
              aria-pressed={value === p.value}
              className={cn(badgeVariants({ variant: 'chip' }), 'flex-1 justify-center', PRIORITY_CLASS[p.value])}
            >
              <Flag size={13} />
              {p.label}
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
