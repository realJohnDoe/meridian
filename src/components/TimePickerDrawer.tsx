import { useState, useEffect } from 'react'
import { Drawer, DrawerContent, DrawerTitle, DrawerFooter } from './ui/drawer'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import { ScrollColumn } from './ui/ScrollColumn'

// ── Time arrays ───────────────────────────────────────────────────────────────
const HOURS:   number[] = Array.from({ length: 12 }, (_, i) => i + 1)   // 1..12
const MINUTES: number[] = Array.from({ length: 12 }, (_, i) => i * 5)   // 0,5,10..55
const AMPM:    string[] = ['AM', 'PM']

// ── 24h <-> 12h conversion ────────────────────────────────────────────────────
/** Parse "HH:MM" (24h) into 12h parts. Falls back to 12:00 AM. */
function parse24h(hhmm: string): { h: number; m: number; ampm: string } {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { h: 12, m: 0, ampm: 'AM' }
  const h24 = parseInt(match[1], 10)
  const m   = Math.round(parseInt(match[2], 10) / 5) * 5 % 60  // snap to 5-min
  const ampm = h24 < 12 ? 'AM' : 'PM'
  let h = h24 % 12
  if (h === 0) h = 12
  return { h, m, ampm }
}

/** Combine 12h parts into "HH:MM" (24h). */
function to24h(h: number, m: number, ampm: string): string {
  let h24 = h % 12
  if (ampm === 'PM') h24 += 12
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  /** Current value in "HH:MM" 24h format, or "" if unset */
  value: string
  onConfirm: (hhmm: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function TimePickerDrawer({ open, value, onConfirm, onRemove, onClose }: Props) {
  const parsed = parse24h(value || '12:00')
  const [hour,   setHour]   = useState<number>(parsed.h)
  const [minute, setMinute] = useState<number>(parsed.m)
  const [ampm,   setAmpm]   = useState<string>(parsed.ampm)

  // Re-sync whenever the drawer opens with a new value
  useEffect(() => {
    if (open) {
      const p = parse24h(value || '12:00')
      setHour(p.h)
      setMinute(p.m)
      setAmpm(p.ampm)
    }
  }, [open, value])

  function handleSet() {
    onConfirm(to24h(hour, minute, ampm))
    onClose()
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="pt-3 pb-6">

        <DrawerTitle>Time</DrawerTitle>
        <Separator />

        <div className="px-6 pt-6 pb-4">
          {/* Three scroll columns side-by-side */}
          <div className="flex items-center justify-center gap-1">

            {/* Hours */}
            <ScrollColumn
              items={HOURS}
              value={hour}
              onChange={setHour}
              className="w-16"
            />

            {/* Colon separator */}
            <span className="text-2xl font-mono text-muted-foreground mb-0.5 select-none">:</span>

            {/* Minutes */}
            <ScrollColumn
              items={MINUTES}
              value={minute}
              onChange={setMinute}
              format={(m) => String(m).padStart(2, '0')}
              className="w-16"
            />

            {/* Spacer */}
            <span className="w-4" />

            {/* AM / PM */}
            <ScrollColumn
              items={AMPM}
              value={ampm}
              onChange={setAmpm}
              className="w-14"
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
