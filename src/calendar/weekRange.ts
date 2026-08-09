import { startOfWeek, addDays, startOfDay } from 'date-fns'

/** First day (local midnight) of the week containing `date`, per the locale's
 * week-start convention — see weekStartsOn in model/dateUtils for the 0=Sun,
 * 1=Mon, 6=Sat convention `ws` follows. */
export function weekStartFor(date: Date, ws: 0 | 1 | 6): Date {
  return startOfWeek(date, { weekStartsOn: ws })
}

/** The 7 calendar days of the week starting at `weekStart` (inclusive). */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** True when `date` falls within the 7-day span starting at `weekStart`, compared at day granularity (ignores time-of-day on either argument). */
export function weekContains(weekStart: Date, date: Date): boolean {
  const d = startOfDay(date).getTime()
  const start = startOfDay(weekStart).getTime()
  const end = startOfDay(addDays(weekStart, 6)).getTime()
  return d >= start && d <= end
}
