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
