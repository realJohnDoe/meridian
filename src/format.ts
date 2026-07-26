import { addDays, addWeeks, addMonths, addYears, addMinutes, getDate, isSameDay, differenceInDays, differenceInMinutes } from 'date-fns'
import { parseDateString, parseDateTime, fmtISO, parseDuration, formatHHMM } from '@/model'
import type { Scheduled } from '@/types'

export { addDays, isSameDay as sameDay }

const thisYear = () => new Date().getFullYear()

export const fmtLong  = (d: Date): string => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long',  day: 'numeric', ...(d.getFullYear() !== thisYear() && { year: 'numeric' }) })
export const fmtShort = (d: Date): string => d.toLocaleDateString(undefined, {                  month: 'short', day: 'numeric', ...(d.getFullYear() !== thisYear() && { year: 'numeric' }) })

export function fmtTopBarDay(d: Date, today: Date): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

export function fmtTopBarMonth(d: Date, today: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'long' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

// ── Duration formatting ───────────────────────────────────────────────────────

function pluralize(n: number, unit: string): string {
  const units: Record<string, [string, string]> = {
    minute: ['minute', 'minutes'],
    hour: ['hour', 'hours'],
    day: ['day', 'days'],
    week: ['week', 'weeks'],
    month: ['month', 'months'],
    year: ['year', 'years'],
  }
  const entry = units[unit]
  if (!entry) return `${n} ${unit}`
  const [singular, plural] = entry
  return `${n} ${n === 1 ? singular : plural}`
}

// addMonths/addYears clamp to the last valid day of the target month (e.g. Jan 31 + 1
// month -> Feb 28). When that clamp happens, the clamped date is already the inclusive
// end of the period, so we must not subtract another day from it.
function inclusiveCalendarEnd(start: Date, exclusiveEnd: Date): Date {
  return getDate(exclusiveEnd) < getDate(start) ? exclusiveEnd : addDays(exclusiveEnd, -1)
}

export function durationToEndDate(startStr: string, duration: string): string {
  const start = parseDateString(startStr) ?? new Date()
  const p = parseDuration(duration)
  if (!p) return fmtISO(addDays(start, 1))
  if (p.unit === 'minutes') return fmtISO(start)
  if (p.unit === 'hours')   return fmtISO(addDays(start, Math.floor(p.n / 24)))
  if (p.unit === 'days')    return fmtISO(addDays(start, p.n - 1))
  if (p.unit === 'weeks')   return fmtISO(addDays(addWeeks(start, p.n), -1))
  if (p.unit === 'months')  return fmtISO(inclusiveCalendarEnd(start, addMonths(start, p.n)))
  if (p.unit === 'years')   return fmtISO(inclusiveCalendarEnd(start, addYears(start, p.n)))
  return fmtISO(addDays(start, 1))
}

export function durationToEndDateTime(startDateStr: string, startTimeStr: string, duration: string): { date: string; time: string } {
  const start = parseDateTime(startDateStr, startTimeStr) ?? new Date()
  const p = parseDuration(duration)
  const end = p
    ? p.unit === 'minutes' ? addMinutes(start, p.n)
    : p.unit === 'hours'   ? addMinutes(start, p.n * 60)
    : p.unit === 'days'    ? addDays(start, p.n)
    : p.unit === 'weeks'   ? addWeeks(start, p.n)
    : addMinutes(start, 60)
    : addMinutes(start, 60)
  return {
    date: fmtISO(end),
    time: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
  }
}

export function endDateToDuration(startStr: string, endDateStr: string): string | null {
  const start = parseDateString(startStr) ?? new Date()
  const end   = parseDateString(endDateStr) ?? new Date()
  const days  = differenceInDays(end, start) + 1  // end date is inclusive
  if (days <= 0) return null
  if (days % 365 === 0) { const y = days / 365; return pluralize(y, 'year') }
  if (days % 30  === 0) { const m = days / 30;  return pluralize(m, 'month') }
  if (days % 7   === 0) { const w = days / 7;   return pluralize(w, 'week') }
  return pluralize(days, 'day')
}

export function endDateTimeToDuration(startDateStr: string, startTimeStr: string, endDateStr: string, endTimeStr: string): string | null {
  const start = parseDateTime(startDateStr, startTimeStr) ?? new Date()
  const end   = parseDateTime(endDateStr, endTimeStr)     ?? new Date()
  const mins  = differenceInMinutes(end, start)
  if (mins <= 0) return null
  if (mins % (7 * 24 * 60) === 0) { const w = mins / (7*24*60); return pluralize(w, 'week') }
  if (mins % (24 * 60)     === 0) { const d = mins / (24*60);   return pluralize(d, 'day') }
  if (mins % 60            === 0) { const h = mins / 60;         return pluralize(h, 'hour') }
  return pluralize(mins, 'minute')
}

export function fmtEndDate(dateStr: string): string {
  const d = parseDateString(dateStr)
  return d ? d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', ...(d.getFullYear() !== thisYear() && { year: 'numeric' }) }) : dateStr
}

export function fmtEndTime(hhmm: string, hour12 = false): string {
  return formatHHMM(hhmm, hour12)
}

export function fmtDuration(duration: string): string {
  const p = parseDuration(duration)
  if (!p) return duration
  const { n, unit } = p
  if (unit === 'minutes' && n >= 60) {
    const h = Math.floor(n / 60), m = n % 60
    const hStr = pluralize(h, 'hour')
    return m > 0 ? `${hStr}, ${pluralize(m, 'minute')}` : hStr
  }
  if (unit === 'hours' && n >= 24) {
    const d = Math.floor(n / 24), h = n % 24
    const dStr = pluralize(d, 'day')
    return h > 0 ? `${dStr}, ${pluralize(h, 'hour')}` : dStr
  }
  return duration
}

export function fmtDurationCompact(duration: string): string {
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

export function formatDurationChip(duration: string, scheduled: Scheduled, hour12 = false): string {
  const display = fmtDuration(duration)
  if (scheduled.time) {
    const { time } = durationToEndDateTime(scheduled.date, scheduled.time, duration)
    return `until ${fmtEndTime(time, hour12)} (${display})`
  }
  const p = parseDuration(duration)
  if (!p || p.unit === 'minutes' || p.unit === 'hours') return display
  return `until ${fmtEndDate(durationToEndDate(scheduled.date, duration))} (${display})`
}
