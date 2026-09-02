import { useStore } from '@/store'
import { weekStartsOn } from '@/model'

/**
 * react-day-picker formats weekday/caption text via date-fns with an enUS
 * default locale — these override it to match the localized
 * `toLocaleDateString` formatting used everywhere else in the app. Shared by
 * every `Calendar` instance (DatePickerDialog, MiniMonth) so the two grids
 * can't drift apart the way two hand-typed inline copies eventually would.
 */
export const CALENDAR_FORMATTERS = {
  formatWeekdayName: (date: Date) => date.toLocaleDateString(undefined, { weekday: 'short' }),
  formatCaption: (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
}

/** The locale's first day of week, read the same way at every `Calendar` call site. */
export function useCalendarWeekStartsOn(): 0 | 1 | 6 {
  return weekStartsOn(useStore(s => s.localePrefs))
}

// Memo table for weekdayShortNames, one entry per `ws` — the whole domain is
// 3 possible week-starts × 7 strings. Unlike CALENDAR_FORMATTERS.formatWeekdayName
// above (called once per weekday by a single-render DatePickerDialog, where
// memoizing wouldn't pay for itself), MiniMonth's quick-nav grid re-renders
// PANE_COUNT panes on every swipe frame — this is the same
// hoist-uncached-Intl-out-of-the-render-path fix as timelineGeometry.ts's
// formatHourBoundary and MonthStrip's buildMonths, for the same reason.
const weekdayNameCache = new Map<0 | 1 | 6, readonly string[]>()

/**
 * Localized short weekday names ("Mon", "Tue", ...), in display order
 * starting from locale week-start `ws` — e.g. MiniMonth's own header row.
 * Jan 4 1970 was a Sunday, so `4 + ws` is always that week's `ws`-th day.
 */
export function weekdayShortNames(ws: 0 | 1 | 6): readonly string[] {
  let names = weekdayNameCache.get(ws)
  if (!names) {
    names = Array.from({ length: 7 }, (_, i) =>
      new Date(1970, 0, 4 + ws + i).toLocaleDateString(undefined, { weekday: 'short' }))
    weekdayNameCache.set(ws, names)
  }
  return names
}
