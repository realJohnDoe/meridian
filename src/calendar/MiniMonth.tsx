import { useMemo, useState } from 'react'
import { type DayButton } from 'react-day-picker'
import { endOfMonth, startOfMonth } from 'date-fns'
import type { StoreItem, Roots, Occurrence } from '@/types'
import { useStore } from '@/store'
import { fmtISO, fmtMonth, parseMonth } from '@/model'
import { useResetOnChange } from '@/hooks'
import { cn } from '@/lib/cn'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useCalendarFilter } from './useCalendarFilter'
import { dayDotsFor, DOT_COLOR, type DotCategory } from './dayDots'
import { CALENDAR_FORMATTERS, useCalendarWeekStartsOn } from './calendarLocale'
import { useCarousel } from './useCarousel'
import { PANE_COUNT } from './snapCarousel'
import MonthStrip from './MonthStrip'

const CENTER_PANE = Math.floor(PANE_COUNT / 2)

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

interface PaneProps {
  monthKey: string
  highlightDates: Date[]
  onSelectDay: (iso: string) => void
  onMonthChange: (d: Date) => void
  items: StoreItem[]
  roots: Roots
  filterOccs: (occs: Occurrence[]) => Occurrence[]
  ws: 0 | 1 | 6
}

/** One month's day grid — kept as its own component so React can key panes by
 * month string (see MonthView/DayView's identical pattern) and so each pane's
 * occurrence-dot computation only reruns for its own month. */
function MiniMonthPane({ monthKey, highlightDates, onSelectDay, onMonthChange, items, roots, filterOccs, ws }: PaneProps) {
  const month = parseMonth(monthKey)
  const allOccs = useExpandWithMultiday(items, roots, startOfMonth(month), endOfMonth(month))
  const dotsByDay = useMemo(() => dayDotsFor(filterOccs(allOccs)), [allOccs, filterOccs])
  const DayButtonWithDots = useMemo(() => makeDayButton(dotsByDay), [dotsByDay])

  return (
    <Calendar
      month={month}
      onMonthChange={onMonthChange}
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
      // The grid's own month/year caption and prev/next arrows are hidden —
      // MonthStrip (rendered above the carousel, see MiniMonth below) is the
      // one month-paging control now, so the two would otherwise duplicate
      // each other.
      classNames={{ nav: 'hidden', month_caption: 'hidden' }}
      className="w-full [--cell-size:2.25rem] p-3 pt-1"
    />
  )
}

interface Props {
  /**
   * Whether the panel this grid lives in is currently open. The grid's own
   * browsed month re-syncs to `anchorMonth` each time this flips to true —
   * see the mount-only `month` state below — and stays put otherwise, so a
   * parent re-render while the panel is open can't yank a paged-to month
   * back out from under the user.
   */
  open: boolean
  /** The month to show when the panel opens — the main view's own month, not wherever the grid's own paging has since moved it to (see the component's own `month` state below). */
  anchorMonth: Date
  /** Day(s) to visually mark as the calling view's current focus — one date for day/agenda, the seven dates of the active week for week view. */
  highlightDates: Date[]
  onSelectDay: (iso: string) => void
}

/**
 * The topbar's quick-nav panel for day, week and agenda views: a month-chip
 * row (MonthStrip, the same one month view's own quick-nav panel uses) above
 * a dotted mini month grid, opened by the same disclosure button month
 * view's MonthStrip uses (see `_app.tsx`). Tapping a day jumps the calendar
 * there; tapping a chip or swiping the grid itself just pages which month the
 * grid is browsing, mirroring month view's own chip-driven navigation.
 *
 * **Trap.** The grid's own paging — chips and swipes alike — moves a *local*
 * month; it must never navigate the main view or relabel the topbar, which is
 * why `month` is local state here rather than a prop, and only ever reset
 * from `anchorMonth` on open (see `useResetOnChange` below).
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

  const { emblaRef, paneKeys } = useCarousel({
    unitKey: fmtMonth(month),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1)),
    onCommit: key => setMonth(parseMonth(key)),
    onPreview: () => {},
  })

  return (
    <div>
      <MonthStrip activeMonth={month} onNavigateMonth={setMonth} />
      {/* Embla viewport → container → panes, same shape as DayView/MonthView's
          own carousels (see useCarousel). touch-pan-y hands vertical drags to
          the browser (there's nothing to scroll vertically here, but this
          keeps the axis-locking behavior consistent with the other two). */}
      <div ref={emblaRef} className="overflow-hidden touch-pan-y">
        <div className="flex">
          {paneKeys.map((key, i) => (
            <div key={key} className="flex-[0_0_100%] min-w-0" inert={i === CENTER_PANE ? undefined : true}>
              <MiniMonthPane
                monthKey={key}
                highlightDates={highlightDates}
                onSelectDay={onSelectDay}
                onMonthChange={setMonth}
                items={items}
                roots={roots}
                filterOccs={filterOccs}
                ws={ws}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
