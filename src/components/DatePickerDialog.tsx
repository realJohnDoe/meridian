import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetTitle, SheetFooter } from './ui/sheet'
import { Calendar } from './ui/calendar'
import { Button } from './ui/button'

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

  // Selecting Today / Tomorrow highlights in the grid without closing
  function selectDate(date: Date) {
    setSelected(date)
    setMonth(date)
  }

  function handleSet() {
    if (selected) onConfirm(dateToIso(selected))
    onClose()
  }

  const isToday    = !!selected && dateToIso(selected) === dateToIso(today)
  const isTomorrow = !!selected && dateToIso(selected) === dateToIso(tomorrow)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="pt-3 pb-6">

        <SheetTitle>Date</SheetTitle>

        <div className="px-4">

          {/* Calendar — fixedWeeks keeps 6 rows always, so height never jumps */}
          <Calendar
            mode="single"
            fixedWeeks
            selected={selected}
            onSelect={setSelected}
            month={month}
            onMonthChange={setMonth}
            className="w-full [--cell-size:2.25rem]"
          />

          {/* Shortcut toggles — filled when that day is selected in the grid */}
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
          <SheetFooter className="pt-2">
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
          </SheetFooter>

        </div>
      </SheetContent>
    </Sheet>
  )
}
