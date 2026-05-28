import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { ScrollColumn } from './ui/ScrollColumn'

// ── Data ──────────────────────────────────────────────────────────────────────
const HOURS:   number[] = Array.from({ length: 24 }, (_, i) => i)      // 0–23
const MINUTES: number[] = Array.from({ length: 12 }, (_, i) => i * 5)  // 0,5,…,55

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTime(hhmm: string): { h: number; m: number } {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { h: 9, m: 0 }
  return {
    h: parseInt(match[1], 10) % 24,
    m: Math.round(parseInt(match[2], 10) / 5) * 5 % 60,
  }
}

function formatTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

export default function TimePickerDialog({ open, value, onConfirm, onRemove, onClose }: Props) {
  const [hour,   setHour]   = useState(9)
  const [minute, setMinute] = useState(0)

  useEffect(() => {
    if (open) {
      const p = parseTime(value || '09:00')
      setHour(p.h)
      setMinute(p.m)
    }
  }, [open, value])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Time</DialogTitle>
          <DialogDescription className="sr-only">
            Select a time using the scroll wheels
          </DialogDescription>
        </DialogHeader>

        {/* Scroll wheels */}
        <div className="flex items-center justify-center gap-1 py-2">
          <ScrollColumn
            items={HOURS}
            value={hour}
            onChange={setHour}
            format={(h) => String(h).padStart(2, '0')}
            className="w-16"
          />
          <span className="text-2xl font-mono text-muted-foreground select-none pb-0.5">:</span>
          <ScrollColumn
            items={MINUTES}
            value={minute}
            onChange={setMinute}
            format={(m) => String(m).padStart(2, '0')}
            className="w-16"
          />
        </div>

        {/* Footer: Remove on left, Cancel + Set on right */}
        <div className="flex items-center justify-between pt-2">
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
            <Button size="sm" onClick={() => { onConfirm(formatTime(hour, minute)); onClose() }}>
              Set
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
