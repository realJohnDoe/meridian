import { useState, useEffect } from 'react'
import { Drawer, DrawerContent, DrawerTitle, DrawerFooter } from './ui/drawer'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import { ScrollColumn } from './ui/ScrollColumn'

// ── Data ──────────────────────────────────────────────────────────────────────
const NUMBERS: number[] = Array.from({ length: 60 }, (_, i) => i + 1)   // 1..60
const UNITS   = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof UNITS[number]

// ── Serialise / parse ─────────────────────────────────────────────────────────
/** "2 hours" → { n: 2, unit: 'hours' }. Falls back to { 30, 'minutes' }. */
function parseDuration(s: string): { n: number; unit: Unit } {
  if (!s) return { n: 30, unit: 'minutes' }
  const match = s.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i)
  if (!match) return { n: 30, unit: 'minutes' }
  const raw = match[2].toLowerCase()
  // normalise singular to plural
  const unit = (UNITS.find(u => raw.startsWith(u.slice(0, -1)) || raw === u) ?? 'minutes') as Unit
  const n = Math.max(1, Math.min(60, parseInt(match[1], 10)))
  return { n, unit }
}

function serialise(n: number, unit: Unit): string {
  // Use singular for 1
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

// Optional: when changing unit, try to keep a sensible number
function convertNumber(n: number, from: Unit, to: Unit): number {
  const toMinutes: Record<Unit, number> = {
    minutes: 1, hours: 60, days: 1440, weeks: 10080, months: 43200, years: 525960,
  }
  const mins = n * toMinutes[from]
  const converted = Math.round(mins / toMinutes[to])
  return Math.max(1, Math.min(60, converted))
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  /** Serialised duration string, e.g. "2 hours", "30 minutes" or "" */
  value: string
  onConfirm: (duration: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function DurationDrawer({ open, value, onConfirm, onRemove, onClose }: Props) {
  const initial = parseDuration(value)
  const [n,    setN]    = useState<number>(initial.n)
  const [unit, setUnit] = useState<Unit>(initial.unit)

  // Re-sync whenever the drawer opens
  useEffect(() => {
    if (open) {
      const p = parseDuration(value)
      setN(p.n)
      setUnit(p.unit)
    }
  }, [open, value])

  function handleUnitChange(next: Unit) {
    setN(prev => convertNumber(prev, unit, next))
    setUnit(next)
  }

  function handleSet() {
    onConfirm(serialise(n, unit))
    onClose()
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3 pb-6">

        <DrawerTitle>Duration</DrawerTitle>
        <Separator />

        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-center gap-4">

            {/* Number column */}
            <ScrollColumn
              items={NUMBERS}
              value={n}
              onChange={setN}
              className="w-16"
            />

            {/* Unit column — wider to fit labels */}
            <ScrollColumn
              items={[...UNITS]}
              value={unit}
              onChange={handleUnitChange as (v: string | number) => void}
              className="w-28"
            />

          </div>
        </div>

        <Separator />

        <DrawerFooter>
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
            <Button size="sm" onClick={handleSet}>
              Set
            </Button>
          </div>
        </DrawerFooter>

      </DrawerContent>
    </Drawer>
  )
}
