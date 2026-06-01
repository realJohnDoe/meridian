import { useState, useEffect } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerActions,
} from './ui/drawer'
import { Separator } from './ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

// ── Data ──────────────────────────────────────────────────────────────────────
const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof UNITS[number]

const UNIT_ITEMS: Record<Unit, number[]> = {
  minutes: Array.from({ length: 12  }, (_, i) => (i + 1) * 5),  // 5,10,…,60
  hours:   Array.from({ length: 24  }, (_, i) => i + 1),          // 1–24
  days:    Array.from({ length: 100 }, (_, i) => i + 1),          // 1–100
  weeks:   Array.from({ length: 52  }, (_, i) => i + 1),          // 1–52
  months:  Array.from({ length: 12  }, (_, i) => i + 1),          // 1–12
  years:   Array.from({ length: 100 }, (_, i) => i + 1),          // 1–100
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function nearest(items: number[], target: number): number {
  return items.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a)
}

function parseDuration(s: string): { n: number; unit: Unit } {
  if (!s) return { n: 1, unit: 'hours' }
  const match = s.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i)
  if (!match) return { n: 1, unit: 'hours' }
  const raw  = match[2].toLowerCase()
  const unit = (UNITS.find(u => raw.startsWith(u.slice(0, -1)) || raw === u) ?? 'minutes') as Unit
  return { n: nearest(UNIT_ITEMS[unit], parseInt(match[1], 10)), unit }
}

function serialise(n: number, unit: Unit): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  value: string
  onConfirm: (duration: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function DurationDialog({ open, value, onConfirm, onRemove, onClose }: Props) {
  const initial = parseDuration(value)
  const [n,    setN]    = useState(initial.n)
  const [unit, setUnit] = useState<Unit>(initial.unit)

  useEffect(() => {
    if (open) {
      const p = parseDuration(value)
      setN(p.n)
      setUnit(p.unit)
    }
  }, [open, value])

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader className="px-4 pt-3 pb-0">
          <DrawerTitle>Duration</DrawerTitle>
          <DrawerDescription className="sr-only">
            Set a duration using the number input and unit selector
          </DrawerDescription>
          <Separator className="mt-2" />
        </DrawerHeader>

        {/* Number input + unit selector */}
        <div className="flex gap-2 px-4 py-4">
          <input
            type="number"
            min={1}
            className="w-20 bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-xs font-mono text-foreground transition-colors"
            value={n}
            onChange={(e) => setN(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map(u => (
                <SelectItem key={u} value={u}>
                  {n === 1 ? u.replace(/s$/, '') : u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DrawerActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={() => { onConfirm(serialise(n, unit)); onClose() }}
        />
      </DrawerContent>
    </Drawer>
  )
}
