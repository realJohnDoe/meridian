import { useMemo, useState } from 'react'
import { type DayButton } from 'react-day-picker'
import { endOfMonth, startOfMonth } from 'date-fns'
import { useStore } from '@/store'
import { fmtISO, fmtMonth } from '@/model'
import { useResetOnChange } from '@/hooks'
import { cn } from '@/lib/cn'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useCalendarFilter } from './useCalendarFilter'
import { dayDotsFor, DOT_COLOR, type DotCategory } from './dayDots'
import { CALENDAR_FORMATTERS, useCalendarWeekStartsOn } from './calendarLocale'

/**
 * Builds the `DayButton` override once per `dotsByDay` change — a plain
 * per-render closure would work too, but would also throw away the
 * CalendarDayButton focus-ref effect's continuity on every keystroke-free
 * render for no reason.
 */
function makeDayButton(dotsByDay: Map<string, DotCategory[]>) {
  return function MiniMonthDayButton({ className, children, ...rest }: React.ComponentProps<typeof DayButton>) {
    const dots = dotsByDay.get(fmtISO(rest.day.date)) ?? []
    return (
      <CalendarDayButton
        {...rest}
        className={cn(
          rest.modifiers.highlight &&
            'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
          className,
        )}
      >
        {/* Bare text, not wrapped in a span: CalendarDayButton's own base
            classes carry a dormant `[&>span]:text-xs [&>span]:opacity-70`
            rule (meant for a future range-mode child it doesn't render
            today) that would otherwise silently fade the day number the
            moment it gained a span wrapper. The dot row below uses a div for
            the same reason. */}
        {children}
        {dots.length > 0 && (
          <div className="flex gap-0.5" aria-hidden>
            {dots.map(category => (
              <span key={category} data-dot={category} className={cn('size-1.5 rounded-full', DOT_COLOR[category])} />
            ))}
          </div>
        )}
      </CalendarDayButton>
    )
  }
}

interface Props {
  /**
   * Whether the panel this grid lives in is currently open. The grid's own
   * browsed month re-syncs to `anchorMonth` each time this flips to true —
   * see the mount-only `month` state below — and stays put otherwise, so a
   * parent re-render while the panel is open can't yank a caption-arrow page
   * back out from under the user.
   */
  open: boolean
  /** The month to show when the panel opens — the main view's own month, not wherever the grid's own caption arrows have since paged it to (see the component's own `month` state below). */
  anchorMonth: Date
  /** Day(s) to visually mark as the calling view's current focus — one date for day/agenda, the seven dates of the active week for week view. */
  highlightDates: Date[]
  onSelectDay: (iso: string) => void
}

/**
 * The topbar's quick-nav panel for day, week and agenda views: a dotted mini
 * month grid, opened by the same disclosure button month view's MonthStrip
 * uses (see `_app.tsx`). Wraps `@/components/ui/calendar` with a `DayButton`
 * override that draws each day's occurrence dots underneath its number.
 *
 * **Trap.** The grid's own caption arrows page a *local* month — they must
 * never navigate the main view or relabel the topbar, which is why `month`
 * is local state here rather than a prop, and only ever reset from
 * `anchorMonth` on open (see `useResetOnChange` below).
 */
export default function MiniMonth({ open, anchorMonth, highlightDates, onSelectDay }: Props) {
  const [month, setMonth] = useState(anchorMonth)

  useResetOnChange([open, fmtMonth(anchorMonth)], () => {
    if (open) setMonth(anchorMonth)
  })

  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const { filterOccs } = useCalendarFilter()
  const ws = useCalendarWeekStartsOn()

  // Same cached-window hook the grid views use (see useExpandWithMultiday) —
  // one more (from, to) window in the shared LRU, keyed by whatever month
  // the mini grid is currently browsing rather than the main view's month.
  const allOccs = useExpandWithMultiday(items, roots, startOfMonth(month), endOfMonth(month))
  const dotsByDay = useMemo(() => dayDotsFor(filterOccs(allOccs)), [allOccs, filterOccs])
  const DayButtonWithDots = useMemo(() => makeDayButton(dotsByDay), [dotsByDay])

  return (
    <Calendar
      month={month}
      onMonthChange={setMonth}
      weekStartsOn={ws}
      fixedWeeks
      formatters={CALENDAR_FORMATTERS}
      // Highlight styling reads modifiers.highlight directly inside
      // MiniMonthDayButton rather than via modifiersClassNames — react-day-picker
      // only applies modifiersClassNames to the day *cell* (the <td>), not to
      // the DayButton inside it, so it can't fill the button's background.
      modifiers={{ highlight: highlightDates }}
      onDayClick={date => onSelectDay(fmtISO(date))}
      components={{ DayButton: DayButtonWithDots }}
      className="w-full [--cell-size:2.25rem] p-3"
    />
  )
}
