import { useState, useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Calendar } from './ui/calendar'
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

  function quickSelect(date: Date) {
    onConfirm(dateToIso(date))
    onClose()
  }

  function handleSet() {
    if (selected) onConfirm(dateToIso(selected))
    onClose()
  }

  // ── Radix primitives used directly so we can position as a bottom sheet ──
  // forceMount keeps the portal in the DOM so CSS transitions play on close.
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal forceMount>

        {/* Backdrop */}
        <DialogPrimitive.Overlay
          forceMount
          className={cn(
            'fixed inset-0 z-[200] bg-black/70',
            'transition-opacity duration-200',
            'data-[state=open]:opacity-100',
            'data-[state=closed]:opacity-0 data-[state=closed]:pointer-events-none',
          )}
        />

        {/* Bottom-sheet panel */}
        <DialogPrimitive.Content
          forceMount
          className={cn(
            'fixed bottom-0 left-1/2 z-[200] -translate-x-1/2',
            'w-full max-w-[430px]',
            'bg-background border-t border-border rounded-t-[24px]',
            'pt-3 pb-10 focus:outline-none',
            'transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]',
            'data-[state=open]:translate-y-0',
            'data-[state=closed]:translate-y-full',
          )}
        >
          {/* Drag handle */}
          <div className="w-8 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-3" />

          {/* Title */}
          <DialogPrimitive.Title className="text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground px-[18px] pb-2.5 border-b border-border mb-2">
            Date
          </DialogPrimitive.Title>

          <div className="px-4">

            {/* Quick-select row */}
            <div className="flex gap-2 pt-1 mb-3">
              <button
                className="flex-1 py-2 text-sm rounded-lg bg-accent text-accent-foreground hover:bg-accent/70 transition-colors"
                onClick={() => quickSelect(today)}
              >
                Today
              </button>
              <button
                className="flex-1 py-2 text-sm rounded-lg bg-accent text-accent-foreground hover:bg-accent/70 transition-colors"
                onClick={() => quickSelect(tomorrow)}
              >
                Tomorrow
              </button>
            </div>

            {/* Calendar */}
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setSelected}
              month={month}
              onMonthChange={setMonth}
              className="w-full"
            />

            {/* Action row */}
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-border">
              <button
                className="text-xs text-destructive px-3 py-2 rounded-full hover:bg-destructive/10 transition-colors"
                onClick={() => { onRemove(); onClose() }}
              >
                Remove
              </button>
              <div className="flex gap-2">
                <button
                  className="text-sm text-muted-foreground px-3.5 py-2 rounded-full hover:bg-accent transition-colors"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  className="text-sm font-semibold text-primary-foreground bg-primary px-5 py-2 rounded-full disabled:opacity-40 transition-opacity"
                  onClick={handleSet}
                  disabled={!selected}
                >
                  Set
                </button>
              </div>
            </div>

          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
