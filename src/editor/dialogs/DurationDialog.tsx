import { useState } from 'react'
import { useIsTouchDevice, useResetOnChange } from '@/hooks'
import { addDays, differenceInMinutes, differenceInDays } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { parseDateString, parseDateTime, fmtISO } from '@/model'
import type { Scheduled } from '@/types'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import DatePickerDialog from './DatePickerDialog'
import TimePickerDialog from './TimePickerDialog'
import { parseDuration } from '@/model'
import { durationToEndDate, durationToEndDateTime, fmtEndDate, fmtEndTime } from '@/format'
import { useStore } from '@/store'

function fmtDurationCompact(duration: string): string {
  const p = parseDuration(duration)
  if (!p) return duration
  const { n, unit } = p
  if (unit === 'minutes') { if (n < 60) return `${n}m`; const h = Math.floor(n/60), m = n%60; return m ? `${h}h ${m}m` : `${h}h` }
  if (unit === 'hours')   { if (n < 24) return `${n}h`; const d = Math.floor(n/24), h = n%24; return h ? `${d}d ${h}h` : `${d}d` }
  if (unit === 'days')    return `${n}d`
  if (unit === 'weeks')   return `${n}w`
  if (unit === 'months')  return `${n}mo`
  if (unit === 'years')   return `${n}y`
  return duration
}

// ── Types / data ──────────────────────────────────────────────────────────────
const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof UNITS[number]
type Tab  = 'interval' | 'endDate'

const PRESETS: { label: string; value: string }[] = [
  { label: '15m', value: '15 minutes' },
  { label: '30m', value: '30 minutes' },
  { label: '45m', value: '45 minutes' },
  { label: '1h',  value: '1 hour'    },
  { label: '2h',  value: '2 hours'   },
]

// ── Local helpers ─────────────────────────────────────────────────────────────
function serialise(n: number, unit: Unit): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

function endDateToDuration(startStr: string, endDateStr: string): string | null {
  const start = parseDateString(startStr) ?? new Date()
  const end   = parseDateString(endDateStr) ?? new Date()
  const days  = differenceInDays(end, start) + 1  // end date is inclusive
  if (days <= 0) return null
  if (days % 365 === 0) { const y = days / 365; return `${y} ${y === 1 ? 'year'  : 'years'}` }
  if (days % 30  === 0) { const m = days / 30;  return `${m} ${m === 1 ? 'month' : 'months'}` }
  if (days % 7   === 0) { const w = days / 7;   return `${w} ${w === 1 ? 'week'  : 'weeks'}` }
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function endDateTimeToDuration(startDateStr: string, startTimeStr: string, endDateStr: string, endTimeStr: string): string | null {
  const start = parseDateTime(startDateStr, startTimeStr) ?? new Date()
  const end   = parseDateTime(endDateStr, endTimeStr)     ?? new Date()
  const mins  = differenceInMinutes(end, start)
  if (mins <= 0) return null
  if (mins % (7 * 24 * 60) === 0) { const w = mins / (7*24*60); return `${w} ${w === 1 ? 'week'  : 'weeks'}` }
  if (mins % (24 * 60)     === 0) { const d = mins / (24*60);   return `${d} ${d === 1 ? 'day'   : 'days'}` }
  if (mins % 60            === 0) { const h = mins / 60;         return `${h} ${h === 1 ? 'hour'  : 'hours'}` }
  return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  value: string
  scheduled: Scheduled | null
  itemType: 'task' | 'event' | 'note'
  onConfirm: (duration: string) => void
  onRemove: () => void
  onClose: () => void
}

export default function DurationDialog({ open, value, scheduled, itemType, onConfirm, onRemove, onClose }: Props) {
  const hour12  = useStore(s => s.localePrefs.hour12)
  const hasTime = !!scheduled?.time

  function defaultTab(): Tab {
    return (!scheduled || itemType === 'task') ? 'interval' : 'endDate'
  }

  const [tab,  setTab]  = useState<Tab>(defaultTab)
  const [n,    setN]    = useState(1)
  const [unit, setUnit] = useState<Unit>('hours')
  const [endDate, setEndDate] = useState('')   // YYYY-MM-DD
  const [endTime, setEndTime] = useState('')   // HH:MM
  const [dateDlgOpen, setDateDlgOpen] = useState(false)
  const [timeDlgOpen, setTimeDlgOpen] = useState(false)
  const isTouch = useIsTouchDevice()

  useResetOnChange([open, value, scheduled?.date, scheduled?.time], () => {
    if (!open) return
    const parsed = value ? parseDuration(value) : null
    setN(parsed?.n ?? 1)
    setUnit(parsed?.unit ?? 'hours')
    setTab(defaultTab())
    if (!scheduled) return
    if (hasTime) {
      const end = value
        ? durationToEndDateTime(scheduled.date, scheduled.time, value)
        : durationToEndDateTime(scheduled.date, scheduled.time, '1 hour')
      setEndDate(end.date)
      setEndTime(end.time)
    } else {
      setEndDate(value
        ? durationToEndDate(scheduled.date, value)
        : fmtISO(addDays(parseDateString(scheduled.date) ?? new Date(), 1)))
    }
  })

  function switchTab(next: Tab) {
    if (next === tab || !scheduled) return
    if (next === 'endDate') {
      const dur = serialise(Math.max(1, n), unit)
      if (hasTime) {
        const end = durationToEndDateTime(scheduled.date, scheduled.time, dur)
        setEndDate(end.date); setEndTime(end.time)
      } else {
        const converted = durationToEndDate(scheduled.date, dur)
        setEndDate(converted !== scheduled.date
          ? converted
          : fmtISO(addDays(parseDateString(scheduled.date) ?? new Date(), 1)))
      }
    } else {
      const dur = hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endTime)
        : endDateToDuration(scheduled.date, endDate)
      const p = dur ? parseDuration(dur) : null
      setN(p?.n ?? 1); setUnit(p?.unit ?? 'hours')
    }
    setTab(next)
  }

  const computedDuration = scheduled
    ? (hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endTime)
        : endDateToDuration(scheduled.date, endDate))
    : null

  function getChipLabel(t: Tab): string {
    if (t === tab || !scheduled) return t === 'interval' ? 'Interval' : endDateTabLabel
    if (t === 'endDate' && n >= 1) {
      const dur = serialise(n, unit)
      if (hasTime) {
        const end = durationToEndDateTime(scheduled.date, scheduled.time, dur)
        return `${endDateTabLabel} (${fmtEndDate(end.date)} ${fmtEndTime(end.time, hour12)})`
      }
      const endDateStr = durationToEndDate(scheduled.date, dur)
      if (endDateStr !== scheduled.date) return `${endDateTabLabel} (${fmtEndDate(endDateStr)})`
    }
    if (t === 'interval' && computedDuration) {
      return `Interval (${fmtDurationCompact(computedDuration)})`
    }
    return t === 'interval' ? 'Interval' : endDateTabLabel
  }

  function handleSet() {
    const dur = tab === 'interval' ? serialise(Math.max(1, n), unit) : computedDuration
    if (!dur) return
    onConfirm(dur); onClose()
  }

  const endDateTabLabel = hasTime ? 'End date & time' : 'End date'

  return (
    <>
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent>
        <ResponsiveModalTitle>Duration</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          Set a duration by entering an interval or picking an end date
        </ResponsiveModalDescription>

        <div className="px-4 pt-4 pb-4 space-y-4">

          {/* Select-by toggle — only shown when a date is set */}
          {scheduled && <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Select by</p>
            <ToggleGroup
              type="single"
              value={tab}
              onValueChange={(v) => { if (v) switchTab(v as Tab) }}
              className="flex gap-0.75 bg-secondary rounded-full p-0.75 border border-input w-fit"
            >
              {(['interval', 'endDate'] as Tab[]).map(t => (
                <ToggleGroupItem
                  key={t}
                  value={t}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground',
                    'cursor-pointer transition-all whitespace-nowrap h-auto min-w-0',
                    'data-[state=on]:bg-background data-[state=on]:text-secondary-foreground data-[state=on]:[box-shadow:0_1px_4px_rgb(0_0_0/.35)]',
                  )}
                >
                  {getChipLabel(t)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>}

          {/* Quick presets — interval tab only */}
          {tab === 'interval' && (
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <button
                  key={p.value}
                  className={cn(
                    badgeVariants({ variant: 'chip' }),
                    'cursor-pointer',
                    serialise(Math.max(1, n), unit) === p.value && 'bg-primary/20 text-primary border-primary',
                  )}
                  onClick={() => { onConfirm(p.value); onClose() }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Interval */}
          {tab === 'interval' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  className="w-20 bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-xs font-mono text-foreground transition-colors"
                  value={n === 0 ? '' : n}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = e.target.value
                    setN(v === '' ? 0 : Math.max(1, parseInt(v, 10) || 1))
                  }}
                />
                <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => (
                      <SelectItem key={u} value={u}>{n === 1 ? u.replace(/s$/, '') : u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* End date — popover date picker + time input */}
          {tab === 'endDate' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  className="flex-1 flex items-center justify-between bg-background border border-border/50 hover:border-border focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-normal text-foreground transition-colors"
                  onClick={() => setDateDlgOpen(true)}
                >
                  <span className={endDate ? '' : 'text-muted-foreground'}>
                    {endDate ? fmtEndDate(endDate) : 'End date'}
                  </span>
                  <CalendarIcon size={13} className="text-muted-foreground shrink-0" />
                </button>

                {hasTime && isTouch && (
                  <button
                    className="bg-background border border-border/50 hover:border-border focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-mono text-foreground transition-colors"
                    onClick={() => setTimeDlgOpen(true)}
                  >
                    {endTime || '—'}
                  </button>
                )}
                {hasTime && !isTouch && (
                  <input
                    type="time"
                    step={300}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="bg-background border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-mono text-foreground transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                  />
                )}
              </div>
              {!computedDuration && endDate && (
                <p className="text-xs text-destructive">End must be after start</p>
              )}
            </div>
          )}
        </div>

        <ResponsiveModalActions
          onRemove={() => { onRemove(); onClose() }}
          onCancel={onClose}
          onSet={handleSet}
          setDisabled={tab === 'endDate' ? !computedDuration : n < 1}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
    <DatePickerDialog
      open={dateDlgOpen}
      initialDate={endDate || scheduled?.date || ''}
      onConfirm={(d) => setEndDate(d)}
      onRemove={() => setEndDate('')}
      onClose={() => setDateDlgOpen(false)}
      forceDialog
    />
    <TimePickerDialog
      open={timeDlgOpen}
      value={endTime || '09:00'}
      onConfirm={(t) => setEndTime(t)}
      onRemove={() => setEndTime('')}
      onClose={() => setTimeDlgOpen(false)}
    />
    </>
  )
}
