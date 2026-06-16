import { format, isValid, parseISO, addDays } from 'date-fns'

/** Single source of truth for which day starts the week (1 = Monday). */
export const WEEK_STARTS_ON = 1 as const

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

export function fmtT(v: unknown): string | null {
  if (!v) return null
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5)
  if (v instanceof Date) {
    const h = v.getHours(), m = v.getMinutes()
    return (h || m) ? format(v, 'HH:mm') : null
  }
  return null
}

export function parseDateString(s: unknown): Date | null {
  if (!s) return null
  if (s instanceof Date) return isValid(s) ? s : null
  const dm = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dm) return new Date(+dm[1], +dm[2] - 1, +dm[3])
  const d = parseISO(String(s))
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
