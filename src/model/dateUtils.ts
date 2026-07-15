import { format, isValid, parseISO, addDays } from 'date-fns'

import type { LocalePrefs } from '@/types'
import { scalarToString } from '@/types'

/** Convert a LocalePrefs firstDayOfWeek (Intl convention) to date-fns/react-day-picker convention (0=Sun, 1=Mon, 6=Sat). */
export function weekStartsOn(prefs: LocalePrefs): 0 | 1 | 6 {
  if (prefs.firstDayOfWeek === 7) return 0
  if (prefs.firstDayOfWeek === 6) return 6
  return 1
}

export function fmtISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** Format a Date as `YYYY-MM` for use in calendar route params. */
export function fmtMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Parse a `YYYY-MM` calendar route param into the first day of that month. */
export function parseMonth(s: string): Date {
  const [y, m] = s.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

function toHour12(h: number, m: number): string {
  const d = new Date(); d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Format an `HH:mm`-prefixed string per locale, either as 24h (sliced as-is) or 12h with AM/PM. */
export function formatHHMM(hhmm: string, hour12: boolean): string {
  const hh = hhmm.slice(0, 5)
  if (!hour12) return hh
  const [h, m] = hh.split(':').map(Number)
  return toHour12(h, m)
}

export function fmtT(v: unknown, hour12 = false): string | null {
  if (!v) return null
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) {
    if (hour12) {
      const [hStr, mStr] = v.slice(0, 5).split(':')
      if (!parseInt(hStr, 10) && !parseInt(mStr, 10)) return null
    }
    return formatHHMM(v, hour12)
  }
  if (v instanceof Date) {
    const h = v.getHours(), m = v.getMinutes()
    if (!h && !m) return null
    if (hour12) return toHour12(h, m)
    return format(v, 'HH:mm')
  }
  return null
}

export function parseDateString(s: unknown): Date | null {
  if (!s) return null
  if (s instanceof Date) return isValid(s) ? s : null
  const str = scalarToString(s)
  if (str === undefined) return null
  const dm = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dm) return new Date(+dm[1], +dm[2] - 1, +dm[3])
  const d = parseISO(str)
  return isValid(d) ? d : null
}

/** Parse a date string + optional time string into a Date, or null if the date is invalid. */
export function parseDateTime(date: string, time: string | null): Date | null {
  const d = parseDateString(date)
  if (!d) return null
  if (time) {
    const tm = time.match(/^(\d{1,2}):(\d{2})/)
    if (tm) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +tm[1], +tm[2], 0, 0)
  }
  return d
}

/** Return the ISO date string for the day before `dateStr`. */
export function dayBefore(dateStr: string): string {
  const d = parseDateString(dateStr)
  return fmtISO(addDays(d ?? new Date(dateStr), -1))
}
