import { useState, useEffect } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { addDays, addMinutes, differenceInMinutes, differenceInDays } from 'date-fns'
import { CalendarIcon, Clock, ChevronLeft } from 'lucide-react'
import { parseDateString, parseDateTime, fmtISO, WEEK_STARTS_ON } from '@/model/dateUtils'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
} from '@/components/ui/responsive-modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Calendar } from '@/components/ui/calendar'
import { TimeWheels } from '@/components/ui/TimeWheels'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

// ── Types / data ──────────────────────────────────────────────────────────────
const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof UNITS[number]
type Tab  = 'interval' | 'endDate'
type View = 'main' | 'datePicker' | 'timePicker'

const PRESETS: { label: string; value: string }[] = [
  { label: '15m', value: '15 minutes' },
  { label: '30m', value: '30 minutes' },
  { label: '45m', value: '45 minutes' },
  { label: '1h',  value: '1 hour'    },
  { label: '2h',  value: '2 hours'   },
]

interface Scheduled { date: string; time: string }

// ── Interval helpers ──────────────────────────────────────────────────────────
function parseDurationStr(s: string): { n: number; unit: Unit } | null {
  const m = s.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i)
  if (!m) return null
  const raw  = m[2].replace(/s$/, '').toLowerCase()
  const unit = UNITS.find(u => u.replace(/s$/, '') === raw) ?? 'hours'
  return { n: parseInt(m[1], 10), unit: unit as Unit }
}

function serialise(n: number, unit: Unit): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

// ── End-date helpers ──────────────────────────────────────────────────────────
function durationToEndDate(startStr: string, duration: string): string {
  const start = parseDateString(startStr) ?? new Date()
  const p = parseDurationStr(duration)
  if (!p) return fmtISO(addDays(start, 1))
  if (p.unit === 'minutes') return fmtISO(start)
  if (p.unit === 'hours')   return fmtISO(addDays(start, Math.floor(p.n / 24)))
  if (p.unit === 'days')    return fmtISO(addDays(start, p.n))
  if (p.unit === 'weeks')   return fmtISO(addDays(start, p.n * 7))
  if (p.unit === 'months')  return fmtISO(addDays(start, p.n * 30))
  if (p.unit === 'years')   return fmtISO(addDays(start, p.n * 365))
  return fmtISO(addDays(start, 1))
}

function durationToEndDateTime(startDateStr: string, startTimeStr: string, duration: string): { date: string; time: string } {
  const start = parseDateTime(startDateStr, startTimeStr) ?? new Date()
  const p = parseDurationStr(duration)
  const end = p
    ? p.unit === 'minutes' ? addMinutes(start, p.n)
    : p.unit === 'hours'   ? addMinutes(start, p.n * 60)
    : p.unit === 'days'    ? addMinutes(start, p.n * 24 * 60)
    : p.unit === 'weeks'   ? addMinutes(start, p.n * 7 * 24 * 60)
    : addMinutes(start, 60)
    : addMinutes(start, 60)
  return {
    date: fmtISO(end),
    time: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
  }
}

function endDateToDuration(startStr: string, endDateStr: string): string | null {
  const start = parseDateString(startStr) ?? new Date()
  const end   = parseDateString(endDateStr) ?? new Date()
  const days  = differenceInDays(end, start)
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

// ── Display helpers ───────────────────────────────────────────────────────────
function parseHHMM(hhmm: string): { h: number; m: number } {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { h: 9, m: 0 }
  return { h: parseInt(match[1], 10) % 24, m: Math.round(parseInt(match[2], 10) / 5) * 5 % 60 }
}

function fmtHHMM(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fmtEndDate(dateStr: string): string {
  const d = parseDateString(dateStr)
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : dateStr
}

function fmtEndTime(hhmm: string): string {
  const { h, m } = parseHHMM(hhmm)
  const period = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// ── Chip label (used by EntryEditor) ─────────────────────────────────────────
export function formatDurationChip(duration: string, scheduled: Scheduled): string {
  if (scheduled.time) {
    const { time } = durationToEndDateTime(scheduled.date, scheduled.time, duration)
    return `until ${fmtEndTime(time)} (${duration})`
  }
  const p = parseDurationStr(duration)
  if (!p || p.unit === 'minutes' || p.unit === 'hours') return duration
  return `until ${fmtEndDate(durationToEndDate(scheduled.date, duration))} (${duration})`
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
  const hasTime = !!scheduled?.time
  const isTouch = useMediaQuery('(pointer: coarse)')

  // ── View ──
  const [view, setView] = useState<View>('main')

  // ── Tab ──
  const [tab, setTab] = useState<Tab>('endDate')

  // ── Interval state ──
  const [n,    setN]    = useState(1)
  const [unit, setUnit] = useState<Unit>('hours')

  // ── End-date state ──
  const [endDate, setEndDate] = useState('')   // YYYY-MM-DD
  const [endTime, setEndTime] = useState('')   // HH:MM

  // ── Date-picker sub-view ──
  const [pendingDate,  setPendingDate]  = useState<Date | undefined>(undefined)
  const [pendingMonth, setPendingMonth] = useState<Date>(new Date())

  // ── Time-picker sub-view ──
  const [pendingHour,   setPendingHour]   = useState(9)
  const [pendingMinute, setPendingMinute] = useState(0)

  // Sync when dialog opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !scheduled) return
    setView('main')
    const parsed = value ? parseDurationStr(value) : null
    setN(parsed?.n ?? 1)
    setUnit(parsed?.unit ?? 'hours')
    if (hasTime) {
      const end = value
        ? durationToEndDateTime(scheduled.date, scheduled.time, value)
        : durationToEndDateTime(scheduled.date, scheduled.time, '1 hour')
      setEndDate(end.date)
      setEndTime(end.time)
      const d = parseDateString(end.date)
      if (d) { setPendingDate(d); setPendingMonth(d) }
    } else {
      const ed = value
        ? durationToEndDate(scheduled.date, value)
        : fmtISO(addDays(parseDateString(scheduled.date) ?? new Date(), 1))
      setEndDate(ed)
      const d = parseDateString(ed)
      if (d) { setPendingDate(d); setPendingMonth(d) }
    }
  }, [open, value, scheduled?.date, scheduled?.time])

  // ── Tab switching ──
  function switchTab(next: Tab) {
    if (next === tab || !scheduled) return
    if (next === 'endDate') {
      const dur = serialise(Math.max(1, n), unit)
      if (hasTime) {
        const end = durationToEndDateTime(scheduled.date, scheduled.time, dur)
        setEndDate(end.date); setEndTime(end.time)
      } else {
        // Sub-day intervals don't map meaningfully to date-only mode — default to next day
        const converted = durationToEndDate(scheduled.date, dur)
        setEndDate(converted !== scheduled.date
          ? converted
          : fmtISO(addDays(parseDateString(scheduled.date) ?? new Date(), 1)))
      }
    } else {
      const dur = hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endTime)
        : endDateToDuration(scheduled.date, endDate)
      const p = dur ? parseDurationStr(dur) : null
      setN(p?.n ?? 1); setUnit(p?.unit ?? 'hours')
    }
    setTab(next)
  }

  // ── Sub-view navigation ──
  function openDatePicker() {
    const d = parseDateString(endDate) ?? parseDateString(scheduled?.date ?? '') ?? new Date()
    setPendingDate(d); setPendingMonth(d)
    setView('datePicker')
  }

  function openTimePicker() {
    const { h, m } = parseHHMM(endTime || '09:00')
    setPendingHour(h); setPendingMinute(m)
    setView('timePicker')
  }

  function commitDate() {
    if (pendingDate) setEndDate(fmtISO(pendingDate))
    setView('main')
  }

  function commitTime() {
    setEndTime(fmtHHMM(pendingHour, pendingMinute))
    setView('main')
  }

  // ── Computed values ──
  const computedDuration = scheduled
    ? (hasTime
        ? endDateTimeToDuration(scheduled.date, scheduled.time, endDate, endTime)
        : endDateToDuration(scheduled.date, endDate))
    : null

  const intervalEndPreview = (() => {
    if (!scheduled || n < 1) return null
    const dur = serialise(n, unit)
    if (hasTime) {
      const { time } = durationToEndDateTime(scheduled.date, scheduled.time, dur)
      return `Ends at ${fmtEndTime(time)}`
    }
    const endDateStr = durationToEndDate(scheduled.date, dur)
    return endDateStr !== scheduled.date ? `Ends on ${fmtEndDate(endDateStr)}` : null
  })()

  // ── Set ──
  function handleSet() {
    const dur = tab === 'interval' ? serialise(Math.max(1, n), unit) : computedDuration
    if (!dur) return
    onConfirm(dur); onClose()
  }

  const endDateTabLabel = hasTime ? 'End date & time' : 'End date'
  const startDate = parseDateString(scheduled?.date ?? '') ?? new Date()

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveModalContent>

        {/* Title */}
        <ResponsiveModalTitle>
          {view !== 'main' ? (
            <span className="flex items-center gap-0.5 -ml-1">
              <button
                onClick={() => setView('main')}
                className="p-1 rounded hover:text-foreground transition-colors normal-case font-normal text-base tracking-normal leading-none"
              >
                <ChevronLeft size={16} />
              </button>
              {view === 'datePicker' ? 'End date' : 'End time'}
            </span>
          ) : 'Duration'}
        </ResponsiveModalTitle>
        <ResponsiveModalDescription>
          {view === 'main'
            ? 'Set a duration by entering an interval or picking an end date'
            : view === 'datePicker' ? 'Pick the end date' : 'Pick the end time'}
        </ResponsiveModalDescription>

        {/* Content — keyed for fade-in on view change */}
        <div key={view} className="animate-in fade-in duration-150">

          {/* ── Main view ── */}
          {view === 'main' && (
            <div className="px-4 pt-4 pb-4 space-y-4">

              {/* Select-by toggle */}
              <div className="space-y-1.5">
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
                      {t === 'interval' ? 'Interval' : endDateTabLabel}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

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
                  {intervalEndPreview && (
                    <p className="text-xs text-muted-foreground">{intervalEndPreview}</p>
                  )}
                </div>
              )}

              {/* End date — desktop: inline calendar + time input; touch: chips → sub-views */}
              {tab === 'endDate' && !isTouch && (
                <div className="space-y-3">
                  <Calendar
                    mode="single"
                    fixedWeeks
                    weekStartsOn={WEEK_STARTS_ON}
                    selected={pendingDate}
                    onSelect={(d) => { if (d) { setPendingDate(d); setPendingMonth(d); setEndDate(fmtISO(d)) } }}
                    month={pendingMonth}
                    onMonthChange={setPendingMonth}
                    disabled={(d) => hasTime ? d < startDate : d <= startDate}
                    className="w-full [--cell-size:2.25rem] p-0"
                  />
                  {hasTime && (
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full bg-background border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-sm font-mono text-foreground transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                    />
                  )}
                  <p className={`text-xs ${computedDuration ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {computedDuration ?? 'End must be after start'}
                  </p>
                </div>
              )}
              {tab === 'endDate' && isTouch && (
                <div className="space-y-2">
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      className={cn(badgeVariants({ variant: 'chip' }), 'cursor-pointer', endDate && 'bg-primary/20 text-primary border-primary')}
                      onClick={openDatePicker}
                    >
                      <CalendarIcon size={13} />
                      {endDate ? fmtEndDate(endDate) : 'End date'}
                    </button>
                    {hasTime && (
                      <button
                        className={cn(badgeVariants({ variant: 'chip' }), 'cursor-pointer', endTime && 'bg-primary/20 text-primary border-primary')}
                        onClick={openTimePicker}
                      >
                        <Clock size={13} />
                        {endTime ? fmtEndTime(endTime) : 'End time'}
                      </button>
                    )}
                  </div>
                  <p className={`text-xs ${computedDuration ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {computedDuration ?? 'End must be after start'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Date picker view ── */}
          {view === 'datePicker' && (
            <div className="px-4 pt-4 pb-4">
              <Calendar
                mode="single"
                fixedWeeks
                weekStartsOn={WEEK_STARTS_ON}
                selected={pendingDate}
                onSelect={setPendingDate}
                month={pendingMonth}
                onMonthChange={setPendingMonth}
                disabled={(d) => hasTime ? d < startDate : d <= startDate}
                className="w-full [--cell-size:2.25rem] p-0"
              />
            </div>
          )}

          {/* ── Time picker view ── */}
          {view === 'timePicker' && (
            <div className="flex items-center justify-center py-6">
              <TimeWheels
                hour={pendingHour}
                minute={pendingMinute}
                onHourChange={setPendingHour}
                onMinuteChange={setPendingMinute}
              />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {view === 'main' && (
          <ResponsiveModalActions
            onRemove={() => { onRemove(); onClose() }}
            onCancel={onClose}
            onSet={handleSet}
            setDisabled={tab === 'endDate' ? !computedDuration : n < 1}
          />
        )}
        {view !== 'main' && (
          <>
            <Separator />
            <div className="flex justify-end gap-2 px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setView('main')}>Cancel</Button>
              <Button
                size="sm"
                disabled={view === 'datePicker' && !pendingDate}
                onClick={view === 'datePicker' ? commitDate : commitTime}
              >
                Done
              </Button>
            </div>
          </>
        )}

      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
