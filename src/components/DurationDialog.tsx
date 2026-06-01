import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
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
/** Find the nearest value in an array */
function nearest(items: number[], target: number): number {
  return items.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a)
}

/** "2 hours" → { n: 2, unit: 'hours' }. Falls back to { 30, 'minutes' }. */
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
  /** Serialised duration string e.g. "2 hours", "30 minutes", or "" */
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-xs p-5">
        <DialogHeader>
          <DialogTitle>Duration</DialogTitle>
          <DialogDescription className="sr-only">
            Select a duration using the number input and unit select dropdown
          </DialogDescription>
        </DialogHeader>

        {/* Number input + unit selector */}
        <div className="flex gap-2 py-3">
          <input
            type="number"
            min={1}
            className="w-20 bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 py-1.5 text-xs font-mono text-foreground transition-colors"
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

        {/* Footer: Remove on left, Cancel + Set on right */}
        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => { onRemove(); onClose() }}
          >
            Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => { onConfirm(serialise(n, unit)); onClose() }}>
              Set
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
