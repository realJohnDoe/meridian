import { useState, useEffect } from 'react'
import { addDays, startOfToday } from 'date-fns'
import { fmtISO, parseDateString, weekStartsOn } from '@/model'
import { useStore } from '@/store'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'

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
  const localePrefs = useStore(s => s.localePrefs)
  const today    = startOfToday()
  const tomorrow = addDays(today, 1)

  const [selected, setSelected] = useState<Date | undefined>(parseDateString(initialDate) ?? undefined)
  const [month,    setMonth]    = useState<Date>(parseDateString(initialDate) ?? today)

  // Sync calendar to the entry's date whenever the dialog opens
  useEffect(() => {
    if (open) {
      const d = parseDateString(initialDate)
      setSelected(d ?? undefined)
      setMonth(d ?? today)
    }
  }, [open, initialDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting Today / Tomorrow highlights in the grid without closing
  function selectDate(date: Date) {
    setSelected(date)
    setMonth(date)
  }

  function handleSet() {
    if (selected) onConfirm(fmtISO(selected))
    onClose()
  }

  const isToday    = !!selected && fmtISO(selected) === fmtISO(today)
  const isTomorrow = !!selected && fmtISO(selected) === fmtISO(tomorrow)

  // ── Spacing contract ────────────────────────────────────────────
  // DrawerTitle  owns: text-to-separator gap (pb-2)
  // Separator    owns: nothing — it is a pure 1 px line
  // Content div  owns: gap below separator (pt-4) and gap above next separator (pb-4)
  // DrawerFooter owns: gap below separator (pt-4, built into component) and px-4
  return (
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent>

        <ResponsiveModalTitle>Date</ResponsiveModalTitle>

        {/* pt-4: gap from separator to first content (calendar)
            pb-4: gap from last content (Today/Tomorrow) to next separator   */}
        <div className="px-4 pt-4 pb-4">
          {/* pt-0 cancels Calendar's built-in p-3 top — separator-to-calendar
              gap is owned entirely by the content div's pt-4 above            */}
          <Calendar
            mode="single"
            fixedWeeks
            weekStartsOn={weekStartsOn(localePrefs)}
            selected={selected}
            onSelect={setSelected}
            month={month}
            onMonthChange={setMonth}
            className="w-full [--cell-size:2.25rem] p-0"
          />

          {/* Shortcut toggles — filled when that day is selected in the grid.
              Calendar's pb-3 (12 px) keeps these closer to the grid than to
              the separator below (16 px from content div pb-4).               */}
          <div className="flex gap-2 mt-3">
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
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={handleSet}
          setDisabled={!selected}
        />

      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
