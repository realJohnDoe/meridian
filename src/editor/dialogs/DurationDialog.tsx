import { useState, useEffect } from 'react'
import { addDays, addMinutes, differenceInMinutes, differenceInDays } from 'date-fns'
import { parseDateString, parseDateTime, WEEK_STARTS_ON } from '@/model/dateUtils'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import { Calendar } from '@/components/ui/calendar'
import { ScrollColumn } from '@/components/ui/ScrollColumn'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Scheduled { date: string; time: string }

// ── Duration ↔ end-datetime helpers ──────────────────────────────────────────
const HOURS:   number[] = Array.from({ length: 24 }, (_, i) => i)
const MINUTES: number[] = Array.from({ length: 12 }, (_, i) => i * 5)

function parseDurationStr(s: string): { amount: number; unit: string } | null {
  const m = s.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i)
  if (!m) return null
  return { amount: parseInt(m[1], 10), unit: m[2].replace(/s$/, '').toLowerCase() }
}

function durationToEndDate(startStr: string, duration: string): Date {
  const start = parseDateString(startStr) ?? new Date()
  const p = parseDurationStr(duration)
  if (!p) return addDays(start, 1)
  if (p.unit === 'day')   return addDays(start, p.amount)
  if (p.unit === 'week')  return addDays(start, p.amount * 7)
  if (p.unit === 'month') return addDays(start, p.amount * 30)
  if (p.unit === 'year')  return addDays(start, p.amount * 365)
  return addDays(start, 1)
}

function durationToEndDateTime(startDateStr: string, startTimeStr: string, duration: string): Date {
  const start = parseDateTime(startDateStr, startTimeStr) ?? new Date()
  const p = parseDurationStr(duration)
  if (!p) return addMinutes(start, 60)
  if (p.unit === 'minute') return addMinutes(start, p.amount)
  if (p.unit === 'hour')   return addMinutes(start, p.amount * 60)
  if (p.unit === 'day')    return addMinutes(start, p.amount * 24 * 60)
  if (p.unit === 'week')   return addMinutes(start, p.amount * 7 * 24 * 60)
  return addMinutes(start, 60)
}

function endDateToDuration(startStr: string, endDate: Date): string | null {
  const start = parseDateString(startStr) ?? new Date()
  const days = differenceInDays(endDate, start)
  if (days <= 0) return null
  if (days % 7 === 0) {
    const weeks = days / 7
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
  }
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function endDateTimeToDuration(
  startDateStr: string, startTimeStr: string,
  endDate: Date, endHour: number, endMinute: number,
): string | null {
  const start = parseDateTime(startDateStr, startTimeStr) ?? new Date()
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), endHour, endMinute, 0, 0)
  const totalMinutes = differenceInMinutes(end, start)
  if (totalMinutes <= 0) return null
  if (totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`
}

/** Format duration chip label: "until 3 pm (2 hours)" or "until 12/31 (3 days)" */
export function formatDurationChip(duration: string, scheduled: Scheduled): string {
  if (scheduled.time) {
    const end = durationToEndDateTime(scheduled.date, scheduled.time, duration)
    const h = end.getHours()
    const m = end.getMinutes()
    const period = h < 12 ? 'am' : 'pm'
    const h12 = h % 12 === 0 ? 12 : h % 12
    const timeStr = m === 0
      ? `${h12} ${period}`
      : `${h12}:${String(m).padStart(2, '0')} ${period}`
    return `until ${timeStr} (${duration})`
  } else {
    const end = durationToEndDate(scheduled.date, duration)
    return `until ${end.getMonth() + 1}/${end.getDate()} (${duration})`
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  value: string
  scheduled: Scheduled | null
  onConfirm: (duration: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function DurationDialog({ open, value, scheduled, onConfirm, onRemove, onClose }: Props) {
  const hasTime  = !!scheduled?.time
  const startDate = scheduled ? (parseDateString(scheduled.date) ?? new Date()) : new Date()

  const [endDate,   setEndDate]   = useState<Date>(addDays(startDate, 1))
  const [endMonth,  setEndMonth]  = useState<Date>(addDays(startDate, 1))
  const [endHour,   setEndHour]   = useState(10)
  const [endMinute, setEndMinute] = useState(0)

  // Sync to current value whenever dialog opens or start changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !scheduled) return
    const sd = parseDateString(scheduled.date) ?? new Date()
    if (hasTime) {
      const start = parseDateTime(scheduled.date, scheduled.time)!
      const end = value
        ? durationToEndDateTime(scheduled.date, scheduled.time, value)
        : addMinutes(start, 60)
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
      setEndDate(endDay)
      setEndMonth(endDay)
      setEndHour(end.getHours())
      setEndMinute(Math.round(end.getMinutes() / 5) * 5 % 60)
    } else {
      const end = value ? durationToEndDate(scheduled.date, value) : addDays(sd, 1)
      setEndDate(end)
      setEndMonth(end)
    }
  }, [open, value, scheduled?.date, scheduled?.time])

  const computedDuration = scheduled
    ? (hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endHour, endMinute)
        : endDateToDuration(scheduled.date, endDate))
    : null

  function handleSet() {
    if (!computedDuration) return
    onConfirm(computedDuration)
    onClose()
  }

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent>
        <ResponsiveModalTitle>End {hasTime ? 'time' : 'date'}</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          Pick an end {hasTime ? 'date and time' : 'date'} to set the duration
        </ResponsiveModalDescription>

        <div className="px-4 pt-4 pb-4">
          <Calendar
            mode="single"
            fixedWeeks
            weekStartsOn={WEEK_STARTS_ON}
            selected={endDate}
            onSelect={(d) => { if (d) { setEndDate(d); setEndMonth(d) } }}
            month={endMonth}
            onMonthChange={setEndMonth}
            disabled={(d) => hasTime ? d < startDate : d <= startDate}
            className="w-full [--cell-size:2.25rem] p-0"
          />

          {hasTime && (
            <div className="flex items-center justify-center gap-1 pt-3">
              <ScrollColumn
                items={HOURS}
                value={endHour}
                onChange={setEndHour}
                format={(h) => String(h).padStart(2, '0')}
                className="w-16"
              />
              <span className="text-2xl font-mono text-muted-foreground select-none pb-0.5">:</span>
              <ScrollColumn
                items={MINUTES}
                value={endMinute}
                onChange={setEndMinute}
                format={(m) => String(m).padStart(2, '0')}
                className="w-16"
              />
            </div>
          )}

          <p className={`text-center text-xs mt-3 ${computedDuration ? 'text-muted-foreground' : 'text-destructive'}`}>
            {computedDuration ?? 'End must be after start'}
          </p>
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={handleSet}
          setDisabled={!computedDuration}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
