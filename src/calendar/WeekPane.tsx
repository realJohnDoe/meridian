import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { fmtT, fmtISO, parseDurationDays, dayRange } from '@/model'
import { sameDay, fmtShort } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { OccurrencePill } from './OccurrencePill'
import { AllDayOverflowToggle, ALL_DAY_THRESHOLD } from './AllDayOverflowToggle'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday } from '@/hooks'
import { useFilteredOccs } from './useCalendarFilter'
import { useNow } from './useNow'
import { computeColumns } from './computeColumns'
import { computeMultidayLanes, compactRowLanes } from './computeMultidayLanes'
import { TimedBlock } from './TimedBlock'
import { weekDays, weekContains, weekNumberFor } from './weekRange'
import { GUTTER, COL_RIGHT_PAD, BADGE_CLASS, BADGE_H } from './timelineGeometry'
import { TimelineScroller, HourCells, HourStripes, NowLine } from './timelineScaffold'

// Fixed row height for the all-day strip's bars/pills — unlike MonthGrid's
// rowH (measured via ResizeObserver so it can track responsive font/padding
// changes), the strip here doesn't need to line up with anything else on the
// page, so a literal pixel height keeps the marginTop reservation below
// trivially correct with no measurement machinery.
const ALLDAY_ROW_H = BADGE_H // same height as the day-number badge

interface LiveWeekAllDayStripProps {
  weekStart: Date
  days: Date[]
  clockValue: Date
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  allDayExpanded: boolean
  setAllDayExpanded: Dispatch<SetStateAction<boolean>>
}

// The all-day/multiday strip, occurrence expansion included — only mounted
// for a live pane (see WeekPane's `live` comment), so a skeleton pane never
// pays for it. Unlike DayPane's strip, this one is entirely absent (not just
// empty) when there's nothing to show, so a skeleton pane looks exactly like
// a live pane that happens to have no all-day content this week — the one
// case this doesn't cover, a skeleton pane for a week that *does* have
// all-day content, briefly shows a shorter header until it goes live.
function LiveWeekAllDayStrip({ weekStart, days, clockValue, onOpen, allDayExpanded, setAllDayExpanded }: LiveWeekAllDayStripProps) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const { from, to } = dayRange(weekStart, days[6]!)
  const wOccs = useFilteredOccs(useExpandWithMultiday(items, roots, from, to))

  // Multiday roots (deduped, earliest occurrence kept) — independent of the
  // clock, so kept out of the clockValue-dependent memo below to avoid
  // recomputing bar lanes on every minute tick.
  const multidayRoots = useMemo(() => {
    const rootsById = new Map<string, Occurrence>()
    for (const o of wOccs) {
      if ((parseDurationDays(o.metadata.duration) ?? 1) < 2) continue
      const existing = rootsById.get(o.id)
      if (!existing || (o.metadata.jsTime?.getTime() ?? 0) < (existing.metadata.jsTime?.getTime() ?? 0)) {
        rootsById.set(o.id, o)
      }
    }
    return [...rootsById.values()]
  }, [wOccs])

  // Untimed single-day occurrences, bucketed per day — these go in the
  // all-day strip below whatever bars cover that day. Timed single-day
  // occurrences (the hour timeline) are LiveWeekDayColumns's concern, not
  // this component's — the two never share a hook call, only the same
  // underlying window (cache-shared via useExpandWithMultiday).
  const untimedByDay = useMemo(() => {
    const untimedMap = new Map<string, Occurrence[]>()
    for (const o of wOccs) {
      if ((parseDurationDays(o.metadata.duration) ?? 1) >= 2) continue
      if (!o.metadata.jsTime) continue
      if (fmtT(o.time)) continue
      const key = fmtISO(o.metadata.jsTime)
      const arr = untimedMap.get(key)
      if (arr) arr.push(o); else untimedMap.set(key, [o])
    }
    const untimedByDay = new Map<string, Occurrence[]>()
    for (const [k, arr] of untimedMap) untimedByDay.set(k, sortOccs(arr, clockValue))
    return untimedByDay
  }, [wOccs, clockValue])

  // All-day strip bar layout — one row spanning the whole week (unlike
  // MonthGrid, which repeats this per week-row of a month). No lane cap: see
  // the file header comment for why multiday events are never hidden here.
  const bars = useMemo(() => {
    const rowStart = days[0]!
    const rowEnd = days[6]!
    const rawLanes = computeMultidayLanes(multidayRoots).filter(l => l.startD <= rowEnd && l.endD >= rowStart)
    const laneMap = compactRowLanes(rawLanes.map(l => l.lane))
    return rawLanes.map(l => ({
      ...l,
      lane: laneMap.get(l.lane)!,
      startCol: Math.max(0, differenceInCalendarDays(l.startD, rowStart)),
      endCol: Math.min(6, differenceInCalendarDays(l.endD, rowStart)),
      continuesLeft: l.startD < rowStart,
      continuesRight: l.endD > rowEnd,
    }))
  }, [multidayRoots, days])

  const hasAllDayContent = bars.length > 0 || untimedByDay.size > 0

  // Splits the strip's bars/pills into an always-visible portion (the first
  // ALL_DAY_THRESHOLD rows) and an overflow portion folded behind the same
  // expand/collapse toggle DayPane uses for its all-day list — see
  // AllDayOverflowToggle. Bars are never capped per-day (a spanning bar's
  // lane is shared by every day it covers), but once a day's own pills would
  // push it past ALL_DAY_THRESHOLD rows — or a bar overflows onto it — its
  // last visible slot is reserved for a "+N" label instead of an item
  // (labelByDay), mirroring CalCell's reserved slot in MonthGrid.
  const {
    visibleBars, overflowBars,
    visiblePillsByDay, overflowPillsByDay,
    labelByDay,
    hiddenCount,
  } = useMemo(() => {
    const visibleBars: ((typeof bars)[number] & { row: number })[] = []
    const overflowBars: ((typeof bars)[number] & { row: number })[] = []
    for (const b of bars) {
      if (b.lane < ALL_DAY_THRESHOLD) visibleBars.push({ ...b, row: b.lane })
      else overflowBars.push({ ...b, row: b.lane - ALL_DAY_THRESHOLD })
    }

    // Pills start right after the lanes THIS day's own bars actually occupy
    // (mirrors MonthGrid's dayLaneCount), not the week's global lane count —
    // a day with no bar over it (or a bar only in a lower lane) reclaims the
    // blank rows above instead of leaving them empty while the pill is
    // pushed below every lane used anywhere in the week. Once that leaves
    // room for fewer than ALL_DAY_THRESHOLD items — or a bar overflows onto
    // this day — the day's last visible slot is reserved for a "+N" label
    // instead of an item (labelByDay), mirroring CalCell's reserved slot in
    // MonthGrid.
    const visiblePillsByDay = new Map<string, { o: Occurrence; row: number }[]>()
    const overflowPillsByDay = new Map<string, { o: Occurrence; row: number }[]>()
    const labelByDay = new Map<string, { row: number; hidden: number }>()
    let hiddenPillCount = 0

    days.forEach((d, col) => {
      const key = fmtISO(d)
      const dayPills = untimedByDay.get(key) ?? []
      const dayBars = bars.filter(b => b.startCol <= col && col <= b.endCol)
      const visRowStart = dayBars.reduce((max, b) => b.lane < ALL_DAY_THRESHOLD ? Math.max(max, b.lane + 1) : max, 0)
      const ovfRowStart = dayBars.reduce((max, b) => b.lane >= ALL_DAY_THRESHOLD ? Math.max(max, b.lane - ALL_DAY_THRESHOLD + 1) : max, 0)
      const barOverflowForDay = dayBars.filter(b => b.lane >= ALL_DAY_THRESHOLD).length

      const pillCapacity = Math.max(0, ALL_DAY_THRESHOLD - visRowStart)
      const overflowing = dayPills.length > pillCapacity || barOverflowForDay > 0
      const shown = overflowing ? Math.max(0, pillCapacity - 1) : dayPills.length

      if (shown > 0) {
        visiblePillsByDay.set(key, dayPills.slice(0, shown).map((o, i) => ({ o, row: visRowStart + i })))
      }
      if (dayPills.length > shown) {
        overflowPillsByDay.set(key, dayPills.slice(shown).map((o, i) => ({ o, row: ovfRowStart + i })))
        hiddenPillCount += dayPills.length - shown
      }
      const hiddenForDay = (dayPills.length - shown) + barOverflowForDay
      if (hiddenForDay > 0) labelByDay.set(key, { row: visRowStart + shown, hidden: hiddenForDay })
    })

    return {
      visibleBars, overflowBars, visiblePillsByDay, overflowPillsByDay, labelByDay,
      hiddenCount: overflowBars.length + hiddenPillCount,
    }
  }, [bars, untimedByDay, days])

  if (!hasAllDayContent) return null

  // Chevrons show at every viewport width here, unlike MonthGrid's bars
  // (which hide them below `sm:`). A month cell is a fixed 1/7 width no
  // matter the span, and its bar competes with the day's own chips for a few
  // lines of text; a week bar is the only thing in its lane and usually
  // spans several columns. Even the narrowest case — a bar clipped to a
  // single column, e.g. a Sun→Fri event seen from the week it starts in —
  // carries at most one chevron (a bar continuing past *both* edges by
  // definition covers all 7 columns), so the reserve costs 16px on one side
  // of that column. That title truncates at this width regardless, and
  // dropping the cue was the whole complaint: the same event shows its
  // chevron in the day view, so a week bar going bare looked like a bug.
  const renderBar = (b: (typeof bars)[number] & { row: number }) => (
    <OccurrencePill
      key={b.occ.id}
      style={{ gridColumn: `${b.startCol + 1} / span ${b.endCol - b.startCol + 1}`, gridRow: b.row + 1 }}
      state={occState({ ...b.occ, metadata: { ...b.occ.metadata, jsTime: b.endD } })}
      title={b.occ.metadata.title}
      onClick={() => onOpen(b.occ)}
      continuesLeft={b.continuesLeft}
      continuesRight={b.continuesRight}
      className="px-0.5 sm:px-1.5 text-3xs sm:text-xs"
    />
  )

  const renderPill = (o: Occurrence, col: number, row: number) => (
    <OccurrencePill
      key={`${o.entryKey}-${o.date}`}
      style={{ gridColumn: col + 1, gridRow: row + 1 }}
      state={occState(o)}
      title={o.metadata.title}
      onClick={() => onOpen(o)}
      className="px-0.5 sm:px-1.5 text-3xs sm:text-xs w-full"
    />
  )

  return (
    // All-day / multiday strip — gutter (expand/collapse chevron,
    // bottom-aligned so it sits right above the border into the hourly
    // grid, matching the hour-label gutter's width) + a grid-cols-7 grid
    // holding both the spanning bars and each day's own untimed pills. A
    // day's pills start right after the lanes its own bars occupy (see
    // the visiblePillsByDay/overflowPillsByDay memo above), so the two
    // never share a cell regardless of container overflow — no
    // absolute-positioned overlay needed (unlike MonthGrid, whose bars
    // overlay a separately-measured cell grid). Rows at/beyond
    // ALL_DAY_THRESHOLD are split into a second grid and folded behind
    // the chevron in the gutter — see AllDayOverflowToggle. Each day with
    // its own hidden items additionally gets a "+N" label in its own
    // column (labelByDay), which also expands the strip.
    <div className="flex border-b border-input bg-card shrink-0 shadow-md relative z-10">
      <div style={{ width: GUTTER }} className="shrink-0 flex flex-col justify-end pb-1">
        <AllDayOverflowToggle
          hiddenCount={hiddenCount}
          expanded={allDayExpanded}
          onToggle={() => setAllDayExpanded(v => !v)}
          className="h-5 w-full p-0"
        />
      </div>
      {/* pr-0.5 = COL_RIGHT_PAD, matching the gap-0.5 gap between the
          grid's own columns, so its day columns share a right edge with
          the header above and the hourly grid below. */}
      <div className="flex-1 py-1 min-w-0 pr-0.5">
        <div className="grid grid-cols-7 gap-0.5" style={{ gridAutoRows: ALLDAY_ROW_H }}>
          {visibleBars.map(renderBar)}
          {days.map((d, col) =>
            (visiblePillsByDay.get(fmtISO(d)) ?? []).map(p => renderPill(p.o, col, p.row)),
          )}
          {days.map((d, col) => {
            const key = fmtISO(d)
            const label = labelByDay.get(key)
            if (!label) return null
            if (allDayExpanded) {
              // Backfill the label's own cell with the first hidden pill
              // instead of leaving it blank once the "+N" button
              // disappears — keeps the day's stack contiguous instead of
              // opening a gap where the label used to sit. A day whose
              // overflow is bar-only (no hidden pill to promote — a
              // spanning bar can't be squeezed into one day's column)
              // just leaves the cell empty, same as before.
              const first = overflowPillsByDay.get(key)?.[0]
              return first ? renderPill(first.o, col, label.row) : null
            }
            return (
              <button
                key={`ovf-${key}`}
                type="button"
                onClick={() => setAllDayExpanded(true)}
                style={{ gridColumn: col + 1, gridRow: label.row + 1 }}
                className="text-3xs sm:text-2xs text-muted-foreground hover:text-secondary-foreground text-left px-0.5 sm:px-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                +{label.hidden}
              </button>
            )
          })}
        </div>

        {hiddenCount > 0 && (
          <div className={cn('dv-adoverflow', allDayExpanded && 'open')}>
            <div className="grid grid-cols-7 gap-0.5 mt-0.5" style={{ gridAutoRows: ALLDAY_ROW_H }}>
              {overflowBars.map(renderBar)}
              {days.map((d, col) => {
                const key = fmtISO(d)
                const list = overflowPillsByDay.get(key) ?? []
                // The label's cell above already took the first item
                // once expanded (see the backfill above) — drop it here
                // too and shift the rest up a row so this grid starts
                // flush instead of repeating a leading blank row.
                const rest = allDayExpanded && labelByDay.has(key)
                  ? list.slice(1).map(p => ({ ...p, row: p.row - 1 }))
                  : list
                return rest.map(p => renderPill(p.o, col, p.row))
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface LiveWeekDayColumnsProps {
  days: Date[]
  clockValue: Date
  today: Date
  now: Date
  onCreate?: (date: Date, time: string, duration: string) => void
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  hour12: boolean
}

// The hour timeline's day columns, occurrence expansion included — only
// mounted for a live pane. See WeekPane's `live` comment for why this (and
// LiveWeekAllDayStrip above) are separate mounts from TimelineScroller rather
// than a hook call inside WeekPane itself: TimelineScroller has to stay the
// same instance across a live/skeleton toggle, so the occurrence-dependent
// content around it has to live in components that mount/unmount on their own.
function LiveWeekDayColumns({ days, clockValue, today, now, onCreate, onOpen, hour12 }: LiveWeekDayColumnsProps) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const { from, to } = dayRange(days[0]!, days[6]!)
  const wOccs = useFilteredOccs(useExpandWithMultiday(items, roots, from, to))

  // Timed single-day occurrences, bucketed per day and column-packed — the
  // hour timeline's concern. Untimed/multiday occurrences are
  // LiveWeekAllDayStrip's, computed from the same (cache-shared) window.
  const colsByDay = useMemo(() => {
    const timedMap = new Map<string, Occurrence[]>()
    for (const o of wOccs) {
      if ((parseDurationDays(o.metadata.duration) ?? 1) >= 2) continue
      if (!o.metadata.jsTime) continue
      if (!fmtT(o.time)) continue
      const key = fmtISO(o.metadata.jsTime)
      const arr = timedMap.get(key)
      if (arr) arr.push(o); else timedMap.set(key, [o])
    }
    const colsByDay = new Map<string, ReturnType<typeof computeColumns>>()
    for (const [k, arr] of timedMap) colsByDay.set(k, computeColumns(sortOccs(arr, clockValue)))
    return colsByDay
  }, [wOccs, clockValue])

  return (
    // Day columns — each one is its own positioning context for its hour
    // cells and event blocks, so TimedBlock's column-relative geometry needs
    // no shared gutter-inset wrapper the way DayPane's does (there,
    // "columns" are overlapping events within one day; here they're the days
    // themselves). That's also why HourCells and NowLine are repeated seven
    // times here and rendered once there.
    <div className="absolute inset-y-0 flex gap-0.5 divide-x divide-border/60" style={{ left: GUTTER, right: COL_RIGHT_PAD }}>
      {days.map(d => {
        const dKey = fmtISO(d)
        const isToday = sameDay(d, today)
        const cols = colsByDay.get(dKey) ?? []
        // Hoisted out of the hourAriaLabel closure below, which HourCells
        // calls once per hour cell: fmtShort is an Intl date format, and
        // leaving it inside meant 7 columns × HOURS × PANE_COUNT panes of
        // them — profiled at ~740ms of the frame that froze a swipe. The
        // label is per column, so it only ever needed computing here.
        const dayLabel = fmtShort(d)
        return (
          <div key={dKey} className="relative flex-1 min-w-0">
            <HourCells
              date={d}
              hour12={hour12}
              onCreate={onCreate}
              hourAriaLabel={t => `Create event on ${dayLabel} at ${t}`}
            />

            {/* Current-time indicator, scoped to today's own column —
                the default full span of whatever container it sits in,
                which here is one day column rather than DayPane's canvas. */}
            {isToday && <NowLine now={now} />}

            {/* Timed event blocks for this day */}
            {cols.flat().map(({ occ, dh, colIndex, totalCols }) => (
              <TimedBlock
                key={occ.id}
                o={occ}
                dh={dh}
                colIndex={colIndex}
                totalCols={totalCols}
                hour12={hour12}
                onOpen={onOpen}
                compact
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── WeekPane ──────────────────────────────────────────────────
// One pane of the week carousel — self-contained so React can key panes by
// week-start string and preserve/discard instances independently as the
// carousel scrolls, mirroring DayPane. Owns its own store subscriptions and
// its own vertical scroller — see WeekView for how scroll position is
// mirrored across panes so it carries over a swipe.
//
// Three occurrence classes get three different treatments:
//   - multiday events -> spanning bars in the all-day strip (never hidden —
//     see compactRowLanes; unlike MonthGrid there's no lane cap here, since
//     the strip scrolls past ~4 lanes instead of boxing into a fixed cell)
//   - untimed single-day occurrences -> single-column pills in the strip,
//     stacked below whatever bars cover that day
//   - timed single-day occurrences -> positioned on the hour timeline, one
//     independently-packed column-group per day (computeColumns per day)
interface Props {
  weekStartKey: string // YYYY-MM-DD, already normalized to the week start
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  /** Called when the user clicks empty timeline space to start a new event at that time. */
  onCreate?: (date: Date, time: string, duration: string) => void
  onDayClick: (date: Date) => void
  registerScroller: (key: string, el: HTMLDivElement | null) => void
  onVerticalScroll: (key: string, scrollTop: number) => void
  getInitialScrollTop: () => number
  /**
   * Whether this is the carousel's centre pane. Defaults to `true` — see
   * DayPane's matching prop for the full rationale (non-centre panes are
   * already `inert`, so dropping their per-hour DOM and occurrence work is
   * unobservable; the toggle is driven off this prop, not a `key`, so
   * TimelineScroller's own instance survives it). WeekView passes
   * `i === CENTER_PANE`.
   */
  live?: boolean
}

export default function WeekPane(props: Props) {
  const { weekStartKey, onOpen, onCreate, onDayClick, registerScroller, onVerticalScroll, getInitialScrollTop } = props
  const live = props.live ?? true

  const weekStart = useMemo(() => {
    const [y = NaN, m = NaN, d = NaN] = weekStartKey.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [weekStartKey])
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const weekNum = weekNumberFor(weekStart)

  const today  = useToday()
  const hour12 = useStore(s => s.localePrefs.hour12)

  // Only ticks for the pane showing today — other panes don't need a live
  // clock for the current-time indicator below, and keep whatever value they
  // mounted with for clockValue's sake. Mirrors DayPane's own guard.
  const showsToday = weekContains(weekStart, today)
  const now = useNow(60_000, showsToday)
  const clockValue = showsToday ? now : today

  const [allDayExpanded, setAllDayExpanded] = useState(false)

  return (
    <>
      {/* Day headers — gutter (week-number badge) + 7 day columns, aligned
          with the grid below. No occurrence dependency, so this stays
          unconditional regardless of `live`. */}
      <div className="flex shrink-0 border-b border-input">
        <div style={{ width: GUTTER }} className="shrink-0 flex items-center justify-center">
          <span className={BADGE_CLASS} aria-label={`Week ${weekNum}`}>{weekNum}</span>
        </div>
        {/* pr-0.5 = COL_RIGHT_PAD, matching the gap-0.5 gap between day
            buttons, so this row's columns line up with the all-day strip and
            hourly grid below (see COL_RIGHT_PAD). */}
        <div className="flex flex-1 gap-0.5 pr-0.5">
          {days.map(d => {
            const isToday = sameDay(d, today)
            return (
              <button
                key={fmtISO(d)}
                type="button"
                onClick={() => onDayClick(d)}
                className="flex-1 min-w-0 flex flex-col items-center gap-0.5 py-1.5 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-label={fmtShort(d)}
              >
                <span className="text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className={cn(BADGE_CLASS, isToday && 'bg-primary text-primary-foreground font-bold')}>
                  {d.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {live && (
        <LiveWeekAllDayStrip
          weekStart={weekStart}
          days={days}
          clockValue={clockValue}
          onOpen={onOpen}
          allDayExpanded={allDayExpanded}
          setAllDayExpanded={setAllDayExpanded}
        />
      )}

      {/* Scrollable timeline — the scroller, canvas and hour labels are the
          scaffold DayPane shares; what differs is only what's positioned
          against the canvas below. */}
      <TimelineScroller
        paneKey={weekStartKey}
        registerScroller={registerScroller}
        onVerticalScroll={onVerticalScroll}
        getInitialScrollTop={getInitialScrollTop}
        hour12={hour12}
      >
        {live ? (
          <LiveWeekDayColumns
            days={days}
            clockValue={clockValue}
            today={today}
            now={now}
            onCreate={onCreate}
            onOpen={onOpen}
            hour12={hour12}
          />
        ) : (
          <div className="absolute inset-y-0" style={{ left: GUTTER, right: COL_RIGHT_PAD }}>
            <HourStripes />
          </div>
        )}
      </TimelineScroller>
    </>
  )
}
