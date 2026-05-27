import { useState, useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Calendar } from './ui/calendar'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

// ── Date helpers ────────────────────────────────────────────────
function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)   // local time, avoids UTC-offset day shift
}

function dateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ── Component ───────────────────────────────────────────────────
interface Props {
  open: boolean
  /** ISO "YYYY-MM-DD" of the currently scheduled date, or "" if unset */
  initialDate: string
  onConfirm: (dateStr: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function DatePickerDialog({ open, initialDate, onConfirm, onRemove, onClose }: Props) {
  const today    = startOfToday()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

  const [selected, setSelected] = useState<Date | undefined>(isoToDate(initialDate))
  const [month,    setMonth]    = useState<Date>(isoToDate(initialDate) ?? today)

  // Sync calendar to the entry's date whenever the dialog opens
  useEffect(() => {
    if (open) {
      const d = isoToDate(initialDate)
      setSelected(d)
      setMonth(d ?? today)
    }
  }, [open, initialDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle Today / Tomorrow — selects in calendar, navigates month if needed
  function selectDate(date: Date) {
    setSelected(date)
    setMonth(date)
  }

  function handleSet() {
    if (selected) onConfirm(dateToIso(selected))
    onClose()
  }

  // Active state for shortcut toggles
  const isToday    = !!selected && dateToIso(selected) === dateToIso(today)
  const isTomorrow = !!selected && dateToIso(selected) === dateToIso(tomorrow)

  // ── Radix primitives used directly so we can position as a bottom sheet ──
  // No forceMount — when closed the portal is simply not in the DOM, so nothing
  // can block interaction. The open (slide-up) animation still plays because Radix
  // sets data-state="open" in a separate frame after the portal mounts.
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>

        {/* Backdrop */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[200] bg-black/70 transition-opacity duration-200 data-[state=open]:opacity-100 data-[state=closed]:opacity-0"
        />

        {/* Bottom-sheet panel */}
        <DialogPrimitive.Content
          className={cn(
            'fixed bottom-0 left-1/2 z-[200] -translate-x-1/2',
            'w-full max-w-[430px]',
            'bg-background border-t border-border rounded-t-[24px]',
            'pt-3 pb-6 focus:outline-none',
            'translate-y-full transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]',
            'data-[state=open]:translate-y-0',
          )}
        >
          {/* Title */}
          <DialogPrimitive.Title className="text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground px-[18px] pt-1 pb-2 border-b border-border">
            Date
          </DialogPrimitive.Title>

          <div className="px-4">

            {/* Calendar — fixedWeeks keeps height constant across 5- and 6-week months */}
            <Calendar
              mode="single"
              fixedWeeks
              selected={selected}
              onSelect={setSelected}
              month={month}
              onMonthChange={setMonth}
              className="w-full [--cell-size:2.25rem]"
            />

            {/* Shortcut toggles — same shape as action buttons, filled when selected */}
            <div className="flex gap-2 pb-3">
              <Button
                variant={isToday ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => selectDate(today)}
              >
                Today
              </Button>
              <Button
                variant={isTomorrow ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => selectDate(tomorrow)}
              >
                Tomorrow
              </Button>
            </div>

            {/* Action row */}
            <div className="flex justify-between items-center pt-2 border-t border-border">
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
                <Button size="sm" onClick={handleSet} disabled={!selected}>
                  Set
                </Button>
              </div>
            </div>

          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
