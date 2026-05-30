import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { WheelColumn } from './ui/carousel'

// ── Data ──────────────────────────────────────────────────────────────────────
const ALL_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof ALL_UNITS[number]

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

/** "2 hours" → { n: 2, unit: 'hours' }. Falls back to { 1, 'hours' }. */
function parseDuration(s: string, units: readonly Unit[]): { n: number; unit: Unit } {
  const defaultUnit = units.includes('hours') ? 'hours' : units[0]
  if (!s) return { n: 1, unit: defaultUnit }
  const match = s.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i)
  if (!match) return { n: 1, unit: defaultUnit }
  const raw  = match[2].toLowerCase()
  const unit = (ALL_UNITS.find(u => raw.startsWith(u.slice(0, -1)) || raw === u) ?? defaultUnit) as Unit
  const resolved = units.includes(unit) ? unit : defaultUnit
  return { n: nearest(UNIT_ITEMS[resolved], parseInt(match[1], 10)), unit: resolved }
}

function serialise(n: number, unit: Unit): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  title?: string
  /** Serialised duration string e.g. "2 hours", "30 minutes", or "" */
  value: string
  /** Subset of units to show. Defaults to all units. */
  units?: readonly Unit[]
  onConfirm: (duration: string) => void
  /** If omitted the Remove button is hidden */
  onRemove?: () => void
  onClose: () => void
}

export default function DurationDialog({
  open,
  title = 'Duration',
  value,
  units = ALL_UNITS,
  onConfirm,
  onRemove,
  onClose,
}: Props) {
  const [n,    setN]    = useState(() => parseDuration(value, units).n)
  const [unit, setUnit] = useState<Unit>(() => parseDuration(value, units).unit)

  useEffect(() => {
    if (open) {
      const p = parseDuration(value, units)
      setN(p.n)
      setUnit(p.unit)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleUnitChange(u: Unit) {
    setUnit(u)
    setN(nearest(UNIT_ITEMS[u], n))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-xs p-5">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Select a duration using the scroll wheels
          </DialogDescription>
        </DialogHeader>

        {/* Wheel pickers */}
        <div className="flex items-center justify-center gap-2 py-2">
          {/* Number column — remount when unit changes so embla re-initialises */}
          <WheelColumn
            key={unit}
            items={UNIT_ITEMS[unit]}
            value={n}
            onChange={setN}
            format={(v) => String(v)}
            className="w-16"
          />
          <WheelColumn
            items={units as Unit[]}
            value={unit}
            onChange={handleUnitChange}
            format={(u) => n === 1 ? u.replace(/s$/, '') : u}
            className="flex-1"
          />
        </div>

        {/* Footer: Remove on left (optional), Cancel + Set on right */}
        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          {onRemove ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => { onRemove(); onClose() }}
            >
              Remove
            </Button>
          ) : <span />}
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
