import { useState, useEffect } from 'react'
import { Flag } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle, DrawerActions } from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Priority } from '@/types'

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
  const [pending, setPending] = useState<Priority | null>(value)

  // Sync pending to current value whenever the drawer opens
  useEffect(() => { if (open) setPending(value) }, [open, value])

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3">

        <DrawerTitle>Priority</DrawerTitle>
        <Separator />

        <div className="flex gap-2 px-4 pt-4 pb-4">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              onClick={() => setPending(p.value)}
              aria-pressed={pending === p.value}
              className={cn(badgeVariants({ variant: 'chip' }), 'flex-1 justify-center', PRIORITY_CLASS[p.value])}
            >
              <Flag size={13} />
              {p.label}
            </button>
          ))}
        </div>

        <DrawerActions
          onRemove={() => { onSelect(null); onClose() }}
          onCancel={onClose}
          onSet={() => { onSelect(pending); onClose() }}
        />

      </DrawerContent>
    </Drawer>
  )
}
