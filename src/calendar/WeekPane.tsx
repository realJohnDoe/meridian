import { useMemo, useLayoutEffect, useRef, useState, useCallback, type MouseEvent } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { fmtT, fmtISO, parseDurationDays } from '@/model'
import { sameDay, fmtShort } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { occRadius } from '@/components/primitives/occurrence-variants'
import { OccurrencePill } from './OccurrencePill'
import { AllDayOverflowToggle, ALL_DAY_THRESHOLD } from './AllDayOverflowToggle'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday } from '@/hooks'
import { useFilteredOccs } from './useCalendarFilter'
import { useNow } from './useNow'
import { computeColumns } from './computeColumns'
import { computeMultidayLanes, compactRowLanes } from './computeMultidayLanes'
import { EventBlock } from './EventBlock'
import { BADGE_CLASS } from './MonthGrid'
import { weekDays, weekContains } from './weekRange'
import {
  HOURS, HP, GUTTER, RIGHT_PAD, TOP_PAD, BOTTOM_PAD, DEFAULT_CREATE_DURATION,
  formatHourBoundary, snapCreateTime,
} from './timelineGeometry'

// Fixed row height for the all-day strip's bars/pills — unlike MonthGrid's
// rowH (measured via ResizeObserver so it can track responsive font/padding
// changes), the strip here doesn't need to line up with anything else on the
// page, so a literal pixel height keeps the marginTop reservation below
// trivially correct with no measurement machinery.
const ALLDAY_ROW_H = 20 // matches BADGE_CLASS's h-5

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
}

export default function WeekPane({ weekStartKey, onOpen, onCreate, onDayClick, registerScroller, onVerticalScroll, getInitialScrollTop }: Props) {
  const weekStart = useMemo(() => {
    const [y = NaN, m = NaN, d = NaN] = weekStartKey.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [weekStartKey])
  const days = useMemo(() => weekDays(weekStart), [weekStart])

  const today  = useToday()
  const items  = useStore(s => s.items)
  const roots  = useStore(s => s.roots)
  const hour12 = useStore(s => s.localePrefs.hour12)

  const wFrom = weekStart
  const wTo   = new Date(days[6]!); wTo.setHours(23, 59, 59)
  const wOccs = useFilteredOccs(useExpandWithMultiday(items, roots, wFrom, wTo))

  // Only ticks for the pane showing today — other panes don't need a live
  // clock for the current-time indicator below, and keep whatever value they
  // mounted with for clockValue's sake. Mirrors DayPane's own guard.
  const showsToday = weekContains(weekStart, today)
  const now = useNow(60_000, showsToday)
  const clockValue = showsToday ? now : today

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

  // Single-day occurrences, bucketed per day and split into timed (goes on
  // the hour timeline, column-packed) vs untimed (goes in the all-day strip).
  const { colsByDay, untimedByDay } = useMemo(() => {
    const timedMap = new Map<string, Occurrence[]>()
    const untimedMap = new Map<string, Occurrence[]>()
    for (const o of wOccs) {
      if ((parseDurationDays(o.metadata.duration) ?? 1) >= 2) continue
      if (!o.metadata.jsTime) continue
      const key = fmtISO(o.metadata.jsTime)
      const map = fmtT(o.time) ? timedMap : untimedMap
      const arr = map.get(key)
      if (arr) arr.push(o); else map.set(key, [o])
    }
    const colsByDay = new Map<string, ReturnType<typeof computeColumns>>()
    for (const [k, arr] of timedMap) colsByDay.set(k, computeColumns(sortOccs(arr, clockValue)))
    const untimedByDay = new Map<string, Occurrence[]>()
    for (const [k, arr] of untimedMap) untimedByDay.set(k, sortOccs(arr, clockValue))
    return { colsByDay, untimedByDay }
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
  // AllDayOverflowToggle. Rows, not occurrence count, are the visible unit
  // here (a row can hold up to 7 items, one per day column), but hiddenCount
  // itself is still an occurrence count so the toggle's "N more" reads the
  // same way it does in DayPane.
  const {
    visibleBars, overflowBars,
    visiblePillsByDay, overflowPillsByDay,
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
    // pushed below every lane used anywhere in the week.
    const visiblePillsByDay = new Map<string, { o: Occurrence; row: number }[]>()
    const overflowPillsByDay = new Map<string, { o: Occurrence; row: number }[]>()
    let overflowPillCount = 0
    days.forEach((d, col) => {
      const key = fmtISO(d)
      const dayBars = bars.filter(b => b.startCol <= col && col <= b.endCol)
      let visRow = dayBars.reduce((max, b) => b.lane < ALL_DAY_THRESHOLD ? Math.max(max, b.lane + 1) : max, 0)
      let ovfRow = dayBars.reduce((max, b) => b.lane >= ALL_DAY_THRESHOLD ? Math.max(max, b.lane - ALL_DAY_THRESHOLD + 1) : max, 0)
      const vis: { o: Occurrence; row: number }[] = []
      const ovf: { o: Occurrence; row: number }[] = []
      for (const o of untimedByDay.get(key) ?? []) {
        if (visRow < ALL_DAY_THRESHOLD) vis.push({ o, row: visRow++ })
        else { ovf.push({ o, row: ovfRow++ }); overflowPillCount++ }
      }
      if (vis.length) visiblePillsByDay.set(key, vis)
      if (ovf.length) overflowPillsByDay.set(key, ovf)
    })

    return {
      visibleBars, overflowBars, visiblePillsByDay, overflowPillsByDay,
      hiddenCount: overflowBars.length + overflowPillCount,
    }
  }, [bars, untimedByDay, days])

  const [allDayExpanded, setAllDayExpanded] = useState(false)

  const scRef = useRef<HTMLDivElement | null>(null)
  const setScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scRef.current = el
    registerScroller(weekStartKey, el)
  }, [weekStartKey, registerScroller])

  // Seeds this pane's scroll position from the carousel's shared vertical
  // offset — see DayPane's own mount effect for the full rationale, mirrored
  // here verbatim.
  const getInitialScrollTopRef = useRef(getInitialScrollTop)
  useLayoutEffect(() => {
    const el = scRef.current
    if (!el) return
    el.scrollTop = getInitialScrollTopRef.current()
  }, [])

  // minutesWithinHour is 0 for keyboard-triggered activation (Enter/Space on
  // the hour button) — see DayPane's own createAt for the full rationale.
  const createAt = (day: Date, h: number, minutesWithinHour: number) => {
    onCreate?.(day, snapCreateTime(h, minutesWithinHour), DEFAULT_CREATE_DURATION)
  }

  const handleHourClick = (day: Date, h: number) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) { createAt(day, h, 0); return }
    const rect = e.currentTarget.getBoundingClientRect()
    createAt(day, h, ((e.clientY - rect.top) / HP) * 60)
  }

  // Unlike MonthGrid's bars (always narrow — a fixed 1/7-width cell no matter
  // the span), a week bar's rendered width scales with how many day columns
  // it covers, so only a single-day-wide bar is as cramped on mobile as a
  // month cell; anything wider has room for the chevron at any viewport size.
  const renderBar = (b: (typeof bars)[number] & { row: number }) => (
    <OccurrencePill
      key={b.occ.id}
      style={{ gridColumn: `${b.startCol + 1} / span ${b.endCol - b.startCol + 1}`, gridRow: b.row + 1 }}
      state={occState({ ...b.occ, metadata: { ...b.occ.metadata, jsTime: b.endD } })}
      title={b.occ.metadata.title}
      onClick={() => onOpen(b.occ)}
      continuesLeft={b.continuesLeft}
      continuesRight={b.continuesRight}
      chevronHiddenOnMobile={b.startCol === b.endCol}
      className="px-0.5 sm:px-1.5 text-3xs sm:text-xs"
    />
  )

  const renderPill = (o: Occurrence, col: number, row: number) => (
    <OccurrencePill
      key={`${o.fileSlug}-${o.date}`}
      style={{ gridColumn: col + 1, gridRow: row + 1 }}
      state={occState(o)}
      title={o.metadata.title}
      onClick={() => onOpen(o)}
      className="px-0.5 sm:px-1.5 text-3xs sm:text-xs w-full"
    />
  )

  return (
    <>
      {/* Day headers — gutter spacer + 7 day columns, aligned with the grid below. */}
      <div className="flex shrink-0 border-b border-input">
        <div style={{ width: GUTTER }} className="shrink-0" />
        <div className="flex flex-1 gap-0.5">
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

      {/* All-day / multiday strip — gutter spacer + a grid-cols-7 grid
          holding both the spanning bars and each day's own untimed pills.
          A day's pills start right after the lanes its own bars occupy (see
          the visiblePillsByDay/overflowPillsByDay memo above), so the two
          never share a cell regardless of container overflow — no
          absolute-positioned overlay needed (unlike MonthGrid, whose bars
          overlay a separately-measured cell grid). Rows at/beyond
          ALL_DAY_THRESHOLD are split into a second grid and folded behind
          the same expand/collapse toggle DayPane uses for its all-day list
          — see AllDayOverflowToggle. */}
      {hasAllDayContent && (
        <div className="flex border-b border-input bg-card shrink-0 shadow-md relative z-10">
          <div style={{ width: GUTTER }} className="shrink-0" />
          <div className="flex-1 py-1 min-w-0">
            <div className="grid grid-cols-7 gap-0.5" style={{ gridAutoRows: ALLDAY_ROW_H }}>
              {visibleBars.map(renderBar)}
              {days.map((d, col) =>
                (visiblePillsByDay.get(fmtISO(d)) ?? []).map(p => renderPill(p.o, col, p.row)),
              )}
            </div>

            {hiddenCount > 0 && (
              <div className={cn('dv-adoverflow', allDayExpanded && 'open')}>
                <div className="grid grid-cols-7 gap-0.5 mt-0.5" style={{ gridAutoRows: ALLDAY_ROW_H }}>
                  {overflowBars.map(renderBar)}
                  {days.map((d, col) =>
                    (overflowPillsByDay.get(fmtISO(d)) ?? []).map(p => renderPill(p.o, col, p.row)),
                  )}
                </div>
              </div>
            )}

            <AllDayOverflowToggle
              hiddenCount={hiddenCount}
              expanded={allDayExpanded}
              onToggle={() => setAllDayExpanded(v => !v)}
            />
          </div>
        </div>
      )}

      {/* Scrollable timeline. pb-5 (20px) matches the search-bar gradient
          height so the 24:00 boundary can scroll clear of the overlaid fade
          — mirrors DayPane. */}
      <div
        className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] relative pb-5"
        ref={setScrollerRef}
        onScroll={e => onVerticalScroll(weekStartKey, e.currentTarget.scrollTop)}
      >
        <div className="relative" style={{ height: HOURS * HP + TOP_PAD + BOTTOM_PAD }}>

          {/* Hour-boundary labels (0:00 … 24:00) */}
          {Array.from({ length: HOURS + 1 }, (_, h) => h).map(h => (
            <span
              key={h}
              className="absolute text-2xs font-mono text-muted-foreground text-right"
              style={{ top: h * HP + TOP_PAD, left: 0, width: GUTTER - 8, transform: 'translateY(-50%)' }}
            >
              {formatHourBoundary(h, hour12)}
            </span>
          ))}

          {/* Day columns — each one is its own positioning context for its
              hour cells and event blocks, so EventBlock's column-relative
              geometry needs no shared gutter-inset wrapper the way DayPane's
              does (there, "columns" are overlapping events within one day;
              here they're the days themselves). */}
          <div className="absolute inset-y-0 flex gap-0.5 divide-x divide-border/60" style={{ left: GUTTER, right: RIGHT_PAD }}>
            {days.map(d => {
              const dKey = fmtISO(d)
              const isToday = sameDay(d, today)
              const cols = colsByDay.get(dKey) ?? []
              const totalCols = Math.max(cols.length, 1)
              return (
                <div key={dKey} className="relative flex-1 min-w-0">
                  {/* Hour cells — one button per hour; click/tap or Enter/Space creates an event there */}
                  {Array.from({ length: HOURS }, (_, h) => h).map(h => (
                    <button
                      key={h}
                      type="button"
                      className={cn(occRadius, 'absolute inset-x-0 bg-muted/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                      style={{ top: h * HP + TOP_PAD + 1, height: HP - 2 }}
                      onClick={handleHourClick(d, h)}
                      aria-label={`Create event on ${fmtShort(d)} at ${formatHourBoundary(h, hour12)}`}
                    />
                  ))}

                  {/* Current-time indicator, scoped to today's own column
                      (not the .now-line default full-width span — left/right
                      overridden inline to size to this column instead) */}
                  {isToday && (() => {
                    const nh = now.getHours() + now.getMinutes() / 60
                    return (
                      <div className="now-line" style={{ top: nh * HP + TOP_PAD, left: 0, right: 0 }}>
                        <div className="now-dot" />
                      </div>
                    )
                  })()}

                  {/* Timed event blocks for this day */}
                  {cols.flatMap((col, ci) =>
                    col.map(({ occ, dh }) => (
                      <EventBlock
                        key={occ.id}
                        o={occ}
                        dh={dh}
                        colIndex={ci}
                        totalCols={totalCols}
                        hour12={hour12}
                        onOpen={onOpen}
                        compact
                      />
                    ))
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
