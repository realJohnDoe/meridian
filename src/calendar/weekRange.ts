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

/** ISO-8601 week number (1-53) for the calendar row starting at `weekStart`
 * — pinned to the Monday that falls within that row, not to `weekStart`
 * itself, matching how Google Calendar labels a row regardless of its
 * "start of week" setting: a Sunday-start row's number flips over on the
 * Monday inside it, not on the Sunday the row visually begins with (which
 * ISO 8601 would otherwise still count as part of the *previous* week). */
export function weekNumberFor(weekStart: Date): number {
  const daysToMonday = (1 - weekStart.getDay() + 7) % 7
  return getISOWeek(addDays(weekStart, daysToMonday))
}

/** True when `date` falls within the 7-day span starting at `weekStart`, compared at day granularity (ignores time-of-day on either argument). */
export function weekContains(weekStart: Date, date: Date): boolean {
  const d = startOfDay(date).getTime()
  const start = startOfDay(weekStart).getTime()
  const end = startOfDay(addDays(weekStart, 6)).getTime()
  return d >= start && d <= end
}

/**
 * The start of the first week that belongs to `monthStart` (the 1st of a
 * month) rather than trailing in from the previous one — i.e. `weekStartFor`
 * with the backward-rounding case pushed forward by a week instead. Whenever
 * the 1st doesn't itself fall on the locale's week-start weekday,
 * `weekStartFor(monthStart, ws)` rounds *backward* into the previous month
 * (e.g. Aug 1 2026 is a Saturday, so a Monday-start week rounds back to Jul
 * 27) — fine for "which week contains this day", wrong for "land me on this
 * month": the resulting week's own month no longer matches the one just
 * browsed to, which is exactly what desynced the week view's topbar label
 * from its quick-nav month strip (both read off this same computed week
 * start elsewhere). Always lands within `monthStart`'s month: the pushed-
 * forward week start is at most 6 days after the 1st, and every month has at
 * least 28 days.
 */
export function firstWeekStartInMonth(monthStart: Date, ws: 0 | 1 | 6): Date {
  const start = weekStartFor(monthStart, ws)
  return start < monthStart ? addDays(start, 7) : start
}
