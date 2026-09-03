import { startTransition, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { endOfMonth, startOfMonth } from 'date-fns'
import type { StoreItem, Roots, Occurrence } from '@/types'
import { useStore } from '@/store'
import { fmtISO, fmtMonth, parseMonth } from '@/model'
import { sameDay } from '@/format'
import { useResetOnChange, useToday } from '@/hooks'
import { cn } from '@/lib/cn'
import { SurfaceButton } from '@/components/primitives/surface-button'
import { IconButton } from '@/components/primitives/icon-button'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useCalendarFilter } from './useCalendarFilter'
import { dayDotsFor, DOT_COLOR, type DotCategory } from './dayDots'
import { CALENDAR_FORMATTERS, useCalendarWeekStartsOn, weekdayShortNames } from './calendarLocale'
import { monthGridCells, type MonthCell } from './monthGridCells'
import { useCarousel } from './useCarousel'
import { useCarouselPreview } from './useCarouselPreview'
import MonthStrip from './MonthStrip'

// Deliberately not the day/week/month views' own PANE_COUNT (5): each pane
// here mounts its own day grid plus its own occurrence-expansion computation,
// and this carousel exists for a lower-stakes, local browsing gesture that
// doesn't need to absorb a rapid multi-month fling — one buffer pane either
// side of center is enough to keep a single swipe smooth. Must stay odd (a
// well-defined center pane), same requirement as PANE_COUNT.
const PANE_COUNT = 3
const CENTER_PANE = Math.floor(PANE_COUNT / 2)

// Always 6 rows (42 cells), matching the old react-day-picker `fixedWeeks`
// behaviour — so paging between a 5-row and a 6-row month doesn't jump the
// panel's height.
const FIXED_WEEKS = 6

const EMPTY_DOTS: DotCategory[] = []

// This grid used to be a full `Calendar` (react-day-picker) instance per
// pane — the right tool for DatePickerDialog's actual date-input control
// (range modes, keyboard roving-tabindex, ARIA grid semantics), badly
// mismatched to a widget that's swiped continuously and mounts three of
// itself at once. Profiling the "still a short freeze after the day/week
// hour-grid fix" report traced it here: react-day-picker's own per-cell
// formatting/modifier/measurement machinery, not this app's code, was the
// remaining cost — see MonthGrid's own comment on why a 42-cell month pane
// never needed DayPane/WeekPane's live/skeleton split either.
//
// The replacement mirrors MonthGrid's own CalCell/`cells` pattern instead
// (see monthGridCells.ts, extracted from MonthGrid so the two don't
// duplicate the same date math): a plain grid of buttons, no external
// calendar library, cheap enough that — like MonthGrid — it never needed
// PR1's live/skeleton split either.
//
// Accessibility tradeoff, called out deliberately rather than left silent:
// react-day-picker's roving-tabindex let arrow keys walk day-to-day across
// the grid. This grid doesn't reimplement that — each day is just a plain,
// independently tabbable button, so keyboard users still reach every day,
// just via Tab rather than arrow keys. DatePickerDialog (still on the real
// `Calendar`) is where that richer keyboard-grid affordance actually
// matters, as a form control; this is a read-mostly quick-nav widget.

interface DayProps {
  date: Date
  other: boolean
  isToday: boolean
  highlight: boolean
  dots: DotCategory[]
  onSelectDay: (iso: string) => void
}

const DAY_BUTTON_CLASS = cn(
  'group/day relative flex aspect-square w-full min-w-(--cell-size) flex-col items-center justify-center gap-1 rounded-md text-sm font-normal leading-none',
  'hover:bg-accent hover:text-accent-foreground',
)

// No memo() here, mirroring CalCell's own comment in MonthGrid.tsx: every
// prop is read directly in the body, and the React Compiler's own per-prop
// memoization already skips this render when nothing relevant changed.
function MiniMonthDay({ date, other, isToday, highlight, dots, onSelectDay }: DayProps) {
  const iso = fmtISO(date)
  // Terser than CalCell's own aria-label (no event count — a dot row already
  // conveys "something's here" without a number), mirroring the same
  // uncached-toLocaleDateString-per-cell pattern CalCell uses: 42 cells here
  // (FIXED_WEEKS) is the same order of magnitude as CalCell's month pane,
  // already established as cheap (see MonthGrid's own comment on why it
  // never needed a live/skeleton split).
  const ariaLabel = [
    date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
    isToday ? 'today' : '',
  ].filter(Boolean).join(', ')

  return (
    <SurfaceButton
      type="button"
      data-day={iso}
      aria-label={ariaLabel}
      onClick={() => onSelectDay(iso)}
      className={cn(
        DAY_BUTTON_CLASS,
        other && 'text-muted-foreground',
        // Today always reads as primary, even when it's also the
        // highlighted/selected day. A highlighted day that isn't today gets
        // a primary tint ringed in primary instead: a flat `bg-accent` fill
        // is near-invisible on the light themes, where --accent sits a hair
        // off --background (see index.css), so the selected day was easy to
        // lose in a grid of 35+ cells. The tint/outline split keeps it
        // plainly distinct from today's solid fill.
        isToday && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        highlight && !isToday && 'bg-primary/15 text-foreground font-semibold ring-2 ring-inset ring-primary hover:bg-primary/25',
      )}
    >
      {date.getDate()}
      {dots.length > 0 && (
        <div className="flex gap-0.5" aria-hidden>
          {dots.map(category => (
            <span key={category} data-dot={category} className={cn('size-1.5 rounded-full', DOT_COLOR[category])} />
          ))}
        </div>
      )}
    </SurfaceButton>
  )
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
  monthNav: 'strip' | 'buttons'
  today: Date
}

/** One month's day grid — kept as its own component so React can key panes by
 * month string (see MonthView/DayView's identical pattern) and so each pane's
 * occurrence-dot computation only reruns for its own month. */
function MiniMonthPane({ monthKey, highlightDates, onSelectDay, onMonthChange, items, roots, filterOccs, ws, monthNav, today }: PaneProps) {
  const month = useMemo(() => parseMonth(monthKey), [monthKey])
  const y = month.getFullYear()
  const m = month.getMonth()

  const allOccs = useExpandWithMultiday(items, roots, startOfMonth(month), endOfMonth(month))
  const dotsByDay = useMemo(() => dayDotsFor(filterOccs(allOccs)), [allOccs, filterOccs])

  const cells = useMemo<MonthCell[]>(() => monthGridCells(y, m, ws, FIXED_WEEKS), [y, m, ws])
  const weekdayNames = weekdayShortNames(ws)
  const highlightKeys = useMemo(() => new Set(highlightDates.map(fmtISO)), [highlightDates])

  return (
    // data-slot="calendar" mirrors the shadcn Calendar's own marker — kept so
    // this pane is still findable the same way (tests, dev tooling) even
    // though it's no longer that component.
    <div data-slot="calendar" className="w-full [--cell-size:2.25rem] p-3 pb-1">
      {/* 'strip': hidden — MonthStrip (rendered below the carousel, see
          MiniMonth below) is the one month-paging control. 'buttons': the
          only paging control, since no MonthStrip is rendered at all (see
          MiniMonth below). */}
      {monthNav === 'buttons' && (
        <div className="relative mb-2 flex h-9 w-full items-center justify-center">
          <span className="select-none text-sm font-medium">{CALENDAR_FORMATTERS.formatCaption(month)}</span>
          <IconButton
            variant="ghost"
            label="Go to the Previous Month"
            className="absolute left-0 text-dim"
            onClick={() => onMonthChange(new Date(y, m - 1, 1))}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            variant="ghost"
            label="Go to the Next Month"
            className="absolute right-0 text-dim"
            onClick={() => onMonthChange(new Date(y, m + 1, 1))}
          >
            <ChevronRight size={18} />
          </IconButton>
        </div>
      )}
      <div className="grid grid-cols-7 gap-0.5 mb-1" aria-hidden>
        {weekdayNames.map(name => (
          <div key={name} className="flex items-center justify-center text-[0.8rem] font-normal text-muted-foreground">
            {name}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map(({ date, other }) => (
          <MiniMonthDay
            key={fmtISO(date)}
            date={date}
            other={other}
            isToday={sameDay(date, today)}
            highlight={highlightKeys.has(fmtISO(date))}
            dots={dotsByDay.get(fmtISO(date)) ?? EMPTY_DOTS}
            onSelectDay={onSelectDay}
          />
        ))}
      </div>
    </div>
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
  /** Day(s) to visually mark as the calling view's current focus — one date for day/agenda, and the active week's start date for week view. */
  highlightDates: Date[]
  onSelectDay: (iso: string) => void
  /**
   * Called with the 1st of the month once the grid's own browsed month
   * *settles* — a chevron tap, a MonthStrip chip tap, or a swipe reaching
   * commit (not preview — see onBrowseMonthPreview below). The caller
   * navigates the underlying view there (without closing the panel, unlike
   * `onSelectDay`), so browsing months here keeps the main view, its
   * highlighted day, and this grid's own highlight all in step, without
   * requiring an explicit day tap.
   */
  onBrowseMonth: (d: Date) => void
  /**
   * Like `onBrowseMonth`, but fired on *preview* — the swipe's target
   * locking in, mid-gesture, well before it settles — rather than on
   * commit. Optional: omit it for a caller with nothing cheap to do on
   * preview (there's still `onBrowseMonth` on commit).
   *
   * This exists so a caller whose "browse to this month" action would
   * otherwise be a real navigation (a route change — see day/week's own
   * wiring in `_app.tsx`) can update cheap, decoupled preview state instead
   * of firing that navigation on every swipe frame. A caller whose action is
   * already cheap (agenda's `requestScrollToDate`) can just pass the same
   * callback for both.
   */
  onBrowseMonthPreview?: (d: Date) => void
  /**
   * How the browsed month is paged. 'strip' (default) shows MonthStrip's
   * scrollable month-chip row below the grid — the mobile/inline panel's
   * shape. 'buttons' drops MonthStrip entirely and leaves each pane's own
   * caption + prev/next chevrons (normally hidden, see MiniMonthPane) as the
   * one paging control instead — a plain jump-by-one control that reads
   * better inside a popover's tighter width than a full chip strip does.
   */
  monthNav?: 'strip' | 'buttons'
}

/**
 * The topbar's quick-nav panel for day, week and agenda views: a dotted mini
 * month grid above a month-chip row (MonthStrip, the same one month view's
 * own quick-nav panel uses), opened by the same disclosure button month
 * view's MonthStrip uses (see `_app.tsx`). Tapping a day jumps the calendar
 * there; tapping a chip or swiping the grid itself pages which month the grid
 * is browsing *and* reports it via `onBrowseMonth`, mirroring month view's
 * own chip-driven navigation.
 *
 * Browsing is still locally tracked (`month` below) rather than driven
 * straight off `anchorMonth`, so a parent re-render mid-browse (e.g. the
 * `onBrowseMonth` navigation itself echoing back as a new `anchorMonth`)
 * can't yank the grid back to some earlier month — see `useResetOnChange`
 * below, which only ever resyncs `month` from `anchorMonth` on a fresh open
 * (or, for a swipe still in flight, once it settles — see browsePreview).
 */
export default function MiniMonth(props: Props) {
  const { open, anchorMonth, highlightDates, onSelectDay, onBrowseMonth, onBrowseMonthPreview } = props
  const monthNav = props.monthNav ?? 'strip'
  const [month, setMonthState] = useState(anchorMonth)
  // `YYYY-MM` the swipe carousel is settling toward, set on touchend so
  // MonthStrip's highlight below tracks the gesture immediately instead of
  // waiting for it to fully settle and `month` to commit — mirrors
  // MonthView's own monthPreview, just kept as local state (via
  // useCarouselPreview below) rather than in the shared calendarView store,
  // since MonthStrip is mounted right here as a child rather than in a
  // separate topbar component. Named distinctly from calendarView's own
  // monthPreview field — a different, unrelated piece of state — to avoid
  // conflating the two.
  const [browsePreview, setBrowsePreview] = useState<string | null>(null)
  const { onPreview: onBrowsePreview, onRecentered } = useCarouselPreview({
    get: () => browsePreview,
    set: setBrowsePreview,
  })

  // Reports every genuine browse (swipe commit, chevron tap, chip tap — see
  // the three setMonth call sites below) to the caller. useResetOnChange's
  // own re-sync below uses setMonthState directly instead, so reopening the
  // panel (or the echo of our own onBrowseMonth navigation landing back in
  // anchorMonth) never re-fires onBrowseMonth.
  const setMonth = (d: Date) => {
    setMonthState(d)
    // Wrapped in a transition so this can't block setMonthState itself
    // landing promptly, which the carousel's own recenter depends on (see
    // useCarousel). This is the only path that ever calls onBrowseMonth —
    // swipe commit, chip tap, and chevron tap all funnel through here; a
    // live preview during the swipe goes through onBrowseMonthPreview
    // instead (see the onPreview handler below), never this one.
    startTransition(() => onBrowseMonth(startOfMonth(d)))
  }

  useResetOnChange([open, fmtMonth(anchorMonth)], () => {
    // Also gated on browsePreview being clear: `month` (driving this
    // carousel's own pane recentering) must stay put for the duration of a
    // swipe still in flight, or the recenter would fire mid-animation — see
    // useCarousel. anchorMonth is not expected to change mid-swipe in the
    // ordinary case (onBrowseMonthPreview below updates decoupled preview
    // state precisely so it doesn't echo back here — see that prop's own
    // doc comment), but this guard is cheap insurance against anchorMonth
    // moving for some unrelated reason while browsing; it'll resync once the
    // preview clears anyway, since onCommit sets `month` to the same value.
    if (open && browsePreview === null) setMonthState(anchorMonth)
  })

  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const { filterOccs } = useCalendarFilter()
  const ws = useCalendarWeekStartsOn()
  const today = useToday()

  const { emblaRef, paneKeys } = useCarousel({
    unitKey: fmtMonth(month),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1)),
    onCommit: key => setMonth(parseMonth(key)),
    // Reports the browsed month to the caller here too (not just on commit
    // below) via onBrowseMonthPreview — cheap, decoupled preview state, not
    // a navigation (see that prop's own doc comment on why) — so the main
    // view sitting behind this panel can still track the swipe as soon as
    // its target locks in, without waiting for the mini-grid's own snap
    // animation to settle. Deliberately does *not* also update `month` yet:
    // `month` drives this carousel's own pane recentering (see useCarousel),
    // which has to wait for the real commit below or the recenter would
    // fire mid-animation.
    onPreview: key => {
      onBrowsePreview(key)
      onBrowseMonthPreview?.(startOfMonth(parseMonth(key)))
    },
    onRecentered,
  })

  return (
    <div>
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
                monthNav={monthNav}
                today={today}
              />
            </div>
          ))}
        </div>
      </div>
      {monthNav === 'strip' && (
        <MonthStrip activeMonth={browsePreview ? parseMonth(browsePreview) : month} onNavigateMonth={setMonth} />
      )}
    </div>
  )
}
