import { startOfWeek, addDays, startOfDay, getISOWeek } from 'date-fns'

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

/** ISO-8601 week number (1-53) for the week containing `date` — Monday-based
 * regardless of the locale's own week-start, matching the "week N" convention
 * most calendar apps show. Good enough as a rough orientation label even for
 * a Sunday/Saturday-start week, since it never drifts by more than a day
 * from the locale's own week boundary. */
export function weekNumberFor(date: Date): number {
  return getISOWeek(date)
}

/** True when `date` falls within the 7-day span starting at `weekStart`, compared at day granularity (ignores time-of-day on either argument). */
export function weekContains(weekStart: Date, date: Date): boolean {
  const d = startOfDay(date).getTime()
  const start = startOfDay(weekStart).getTime()
  const end = startOfDay(addDays(weekStart, 6)).getTime()
  return d >= start && d <= end
}
