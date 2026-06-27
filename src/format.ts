import { addDays, addMinutes, isSameDay } from 'date-fns'
import { parseDateString, parseDateTime, fmtISO } from '@/model'
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

const DURATION_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type DurationUnit = typeof DURATION_UNITS[number]

export function parseDurationStr(s: string): { n: number; unit: DurationUnit } | null {
  const m = s.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i)
  if (!m) return null
  const raw  = m[2].replace(/s$/, '').toLowerCase()
  const unit = DURATION_UNITS.find(u => u.replace(/s$/, '') === raw) ?? 'hours'
  return { n: parseInt(m[1], 10), unit: unit as DurationUnit }
}

export function durationToEndDate(startStr: string, duration: string): string {
  const start = parseDateString(startStr) ?? new Date()
  const p = parseDurationStr(duration)
  if (!p) return fmtISO(addDays(start, 1))
  if (p.unit === 'minutes') return fmtISO(start)
  if (p.unit === 'hours')   return fmtISO(addDays(start, Math.floor(p.n / 24)))
  if (p.unit === 'days')    return fmtISO(addDays(start, p.n - 1))
  if (p.unit === 'weeks')   return fmtISO(addDays(start, p.n * 7 - 1))
  if (p.unit === 'months')  return fmtISO(addDays(start, p.n * 30 - 1))
  if (p.unit === 'years')   return fmtISO(addDays(start, p.n * 365 - 1))
  return fmtISO(addDays(start, 1))
}

export function durationToEndDateTime(startDateStr: string, startTimeStr: string, duration: string): { date: string; time: string } {
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

export function fmtEndDate(dateStr: string): string {
  const d = parseDateString(dateStr)
  return d ? d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', ...(d.getFullYear() !== thisYear() && { year: 'numeric' }) }) : dateStr
}

export function fmtEndTime(hhmm: string, hour12 = false): string {
  if (!hour12) return hhmm.slice(0, 5)
  const [h, min] = hhmm.slice(0, 5).split(':').map(Number)
  const d = new Date(); d.setHours(h, min, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function fmtDuration(duration: string): string {
  const p = parseDurationStr(duration)
  if (!p) return duration
  const { n, unit } = p
  if (unit === 'minutes' && n >= 60) {
    const h = Math.floor(n / 60), m = n % 60
    const hStr = `${h} ${h === 1 ? 'hour' : 'hours'}`
    return m > 0 ? `${hStr}, ${m} ${m === 1 ? 'minute' : 'minutes'}` : hStr
  }
  if (unit === 'hours' && n >= 24) {
    const d = Math.floor(n / 24), h = n % 24
    const dStr = `${d} ${d === 1 ? 'day' : 'days'}`
    return h > 0 ? `${dStr}, ${h} ${h === 1 ? 'hour' : 'hours'}` : dStr
  }
  return duration
}

export function formatDurationChip(duration: string, scheduled: Scheduled, hour12 = false): string {
  const display = fmtDuration(duration)
  if (scheduled.time) {
    const { time } = durationToEndDateTime(scheduled.date, scheduled.time, duration)
    return `until ${fmtEndTime(time, hour12)} (${display})`
  }
  const p = parseDurationStr(duration)
  if (!p || p.unit === 'minutes' || p.unit === 'hours') return display
  return `until ${fmtEndDate(durationToEndDate(scheduled.date, duration))} (${display})`
}
