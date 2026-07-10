import { useEffect, useRef, useState } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { useHorizontalSwipe } from './useHorizontalSwipe'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'

import { parseDurationDays, weekStartsOn } from '@/model'
import { sameDay } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { computeMultidayLanes } from './computeMultidayLanes'

const EMPTY: Occurrence[] = []
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday, useCalendarFilter } from '@/hooks'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import { dvBlockVariants } from '@/components/ui/occurrence-variants'
import { ContinuationChevron } from '@/components/ui/continuation-chevron'

// Cell-chrome class strings, shared between CalCell and the invisible chrome
// sentinel so the bar overlay's top offset can be MEASURED from a real replica
// rather than hand-computed — the day-number badge, cell padding, or the flex
// gap can change without silently breaking bar↔row alignment (see `barTop`).
const CELL_CLASS = 'flex-col items-stretch p-[3px_2px_2px] rounded-[var(--r)] transition-colors overflow-hidden min-h-0 w-full'
const BADGE_CLASS = 'text-xs font-medium text-dim w-5 h-5 flex items-center justify-center rounded-full shrink-0 mb-px'
const OCC_LIST_CLASS = 'flex flex-col gap-0.5 flex-1 overflow-hidden'

// Fallback for the occurrence-list start offset until it's measured (cell top padding
// 3px + badge h-5 20px + badge mb-px 1px + the 8px flex gap inherited from Button).
const BAR_TOP_FALLBACK = 32
// Conservative reservation for badge + cell padding, used only to estimate
// how many occurrence rows fit in the remaining cell height — doesn't need to be exact.
const CELL_CHROME = 26
const ROW_GAP = 2 // gap-0.5 between stacked rows (occurrence rows and bars share this)
const MAX_BAR_LANES = 2 // stacked multiday bars per week row before overflow

// ── CalCell ───────────────────────────────────────────────────
interface CalCellProps {
  date: Date
  other: boolean
  dayOccs: Occurrence[]
  today: Date
  maxVisible: number
  rowH: number
  reservedLanes: number
  hiddenBarCount: number
  barCoverCount: number
  onDayClick: (date: Date) => void
}

// No memo() here — all props are read directly in the body (no unused
// "force refresh" prop like OccurrenceRow's `tick`), and `dayOccs`/`today`
// stay reference-stable across unrelated MonthView renders (the compiler
// auto-caches occsByDay, and useToday only updates at midnight), so the
// React Compiler's own per-prop memoization already skips this render when
// nothing relevant changed.
function CalCell({ date, other, dayOccs, today, maxVisible, rowH, reservedLanes, hiddenBarCount, barCoverCount, onDayClick }: CalCellProps) {
  const isToday = sameDay(date, today)

  const occCount = dayOccs.length + barCoverCount
  const ariaLabel = [
    date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) }),
    isToday ? 'today' : '',
    occCount ? `${occCount} event${occCount !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ')

  // Reserve the last visible slot for the "+N more" line once there's overflow,
  // so the total number of rendered lines never exceeds what CalCell measured as fitting.
  const capacity = Math.max(1, maxVisible - reservedLanes)
  const overflowing = dayOccs.length > capacity || hiddenBarCount > 0
  const shown = overflowing ? Math.max(0, capacity - 1) : dayOccs.length
  const hiddenCount = (dayOccs.length - shown) + hiddenBarCount

  return (
    <SurfaceButton
      className={cn(CELL_CLASS, 'hover:bg-accent', other && 'opacity-25')}
      onClick={() => onDayClick(date)}
      aria-label={ariaLabel}
    >
      <span className={cn(
        BADGE_CLASS,
        isToday && 'bg-primary text-primary-foreground font-bold',
      )}>{date.getDate()}</span>
      <div
        className={OCC_LIST_CLASS}
        style={reservedLanes ? { marginTop: reservedLanes * (rowH + ROW_GAP) } : undefined}
      >
        {dayOccs.slice(0, shown).map(o => (
          <div key={`${o.fileSlug}-${o.date}`} className={cn(dvBlockVariants({ state: occState(o) }), 'flex items-center rounded-xs sm:rounded-sm px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium w-full overflow-hidden')}>
            <span className="truncate min-w-0">{o.metadata.title}</span>
          </div>
        ))}
        {overflowing && (
          <div className="text-3xs sm:text-2xs text-foreground px-0.5 sm:px-1">+{hiddenCount}</div>
        )}
      </div>
    </SurfaceButton>
  )
}

// ── MonthView ─────────────────────────────────────────────────
interface Props {
  month: Date
  onNavigateMonth: (d: Date) => void
  onDayClick: (date: Date) => void
}

export default function MonthView({ month, onNavigateMonth, onDayClick }: Props) {
  const today       = useToday()
  const items       = useStore(s => s.items)
  const roots       = useStore(s => s.roots)
  const localePrefs = useStore(s => s.localePrefs)
  const { filterOccs } = useCalendarFilter()

  const ws = weekStartsOn(localePrefs) // 0=Sun, 1=Mon, 6=Sat

  // Locale-aware weekday header labels starting from the locale's first day of week.
  // Jan 5 2025 is a Sunday; offset by ws to get each day's label.
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    const sunday = new Date(2025, 0, 5)
    const d = new Date(sunday)
    d.setDate(5 + (ws + i) % 7)
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  })

  const m = month.getMonth()
  const y = month.getFullYear()

  const monthRef = useRef(month)
  useEffect(() => { monthRef.current = month }, [month])

  // useExpandWithMultiday caches by (fromMs, toMs, items structure, roots) so
  // non-structural edits (done-toggle, priority change) skip re-expansion here
  // just as they do in Agenda and Day views. Multiday events emit both a root
  // occurrence (start day) and one virtual occurrence per subsequent covered
  // day (see expandWithMultiday) — we partition those below rather than
  // switching data sources, since the shared cache already has everything we need.
  const allOccs = useExpandWithMultiday(items, roots, new Date(y, m, 1), new Date(y, m + 1, 0, 23, 59, 59))

  // Cell grid depends only on month shape and locale week-start — independent of occurrences.
  const cells = (() => {
    const rawFirst = new Date(y, m, 1).getDay()
    const first    = (rawFirst - ws + 7) % 7
    const dim      = new Date(y, m + 1, 0).getDate()
    const prev     = new Date(y, m, 0).getDate()
    const nc       = (7 - (first + dim) % 7) % 7

    const out: Array<{ date: Date; other: boolean }> = []
    for (let i = first - 1; i >= 0; i--)  out.push({ date: new Date(y, m - 1, prev - i), other: true })
    for (let d = 1; d <= dim; d++)         out.push({ date: new Date(y, m, d),             other: false })
    for (let d = 1; d <= nc; d++)          out.push({ date: new Date(y, m + 1, d),          other: true })
    return out
  })()

  // Partition into single-day occurrences (bucketed per day, as occurrence rows) and
  // multiday occurrences (one root entry per event, deduped from the root +
  // per-day-virtual-occurrence set expandWithMultiday produces).
  const { occsByDay, multidayLanes } = (() => {
    const dayMap = new Map<string, Occurrence[]>()
    const rootsById = new Map<string, Occurrence>()

    for (const o of filterOccs(allOccs)) {
      const days = parseDurationDays(o.metadata.duration) ?? 1
      if (days < 2) {
        if (!o.metadata.jsTime) continue
        const d = o.metadata.jsTime
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
        const arr = dayMap.get(key)
        if (arr) arr.push(o)
        else dayMap.set(key, [o])
        continue
      }
      const existing = rootsById.get(o.id)
      if (!existing || (o.metadata.jsTime?.getTime() ?? 0) < (existing.metadata.jsTime?.getTime() ?? 0)) {
        rootsById.set(o.id, o)
      }
    }
    for (const [k, arr] of dayMap) dayMap.set(k, sortOccs(arr))
    return { occsByDay: dayMap, multidayLanes: computeMultidayLanes([...rootsById.values()]) }
  })()

  const wrapRef = useRef<HTMLDivElement>(null)
  useHorizontalSwipe(
    wrapRef,
    () => { const d = monthRef.current; onNavigateMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1)) },
    () => { const d = monthRef.current; onNavigateMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1)) },
  )

  // How many occurrence rows fit in a cell before falling back to "+N more" —
  // measured live so taller cells (more vertical space per week row) show more
  // than the historical hardcoded 3. gridRef gives the per-cell height (grid
  // height / week rows); rowSentinelRef is an invisible row rendered with the
  // exact same classes as a real one, so its measured height already reflects
  // the current breakpoint's font-size/padding without hardcoding it here.
  // rowH (the same measured height) also sizes the multiday bar segments, so
  // bars and occurrence rows always line up at the same row height.
  const weekRows = Math.ceil(cells.length / 7)
  const weekRowsArr = Array.from({ length: weekRows }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  const gridRef = useRef<HTMLDivElement>(null)
  const rowSentinelRef = useRef<HTMLDivElement>(null)
  const chromeSentinelRef = useRef<HTMLButtonElement>(null)
  const occListRef = useRef<HTMLDivElement>(null)
  const [maxVisible, setMaxVisible] = useState(3)
  const [rowH, setRowH] = useState(0)
  const [barTop, setBarTop] = useState(BAR_TOP_FALLBACK)

  useEffect(() => {
    const gridEl = gridRef.current
    const rowEl = rowSentinelRef.current
    if (!gridEl || !rowEl) return

    const compute = () => {
      const measuredRowH = rowEl.offsetHeight
      if (!measuredRowH) return
      setRowH(measuredRowH)
      const cellH = gridEl.clientHeight / weekRows
      const available = cellH - CELL_CHROME
      const n = Math.floor((available + ROW_GAP) / (measuredRowH + ROW_GAP))
      setMaxVisible(Math.min(8, Math.max(1, n)))

      // Measure where the occurrence list starts within a cell (from an invisible
      // replica) so the bar overlay lines up with real single-day occurrence rows.
      const chromeEl = chromeSentinelRef.current
      const occListEl = occListRef.current
      if (chromeEl && occListEl) {
        const offset = occListEl.getBoundingClientRect().top - chromeEl.getBoundingClientRect().top
        if (offset > 0) setBarTop(offset)
      }
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(gridEl)
    ro.observe(rowEl)
    return () => ro.disconnect()
  }, [weekRows])

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden pb-10" ref={wrapRef}>
      <div className="grid grid-cols-7 px-1 shrink-0 pt-2">
        {weekdayLabels.map(d => <div key={d} className="text-center text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground py-0.75">{d}</div>)}
      </div>

      <div
        ref={rowSentinelRef}
        aria-hidden
        className="invisible absolute pointer-events-none flex items-center rounded-xs sm:rounded-sm px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium"
      >
        &nbsp;
      </div>

      {/* Invisible cell replica: measures the offset from the cell top to where
          the occurrence list begins, so the bar overlay aligns with real rows. */}
      <SurfaceButton ref={chromeSentinelRef} aria-hidden tabIndex={-1} className={cn('invisible absolute pointer-events-none', CELL_CLASS)}>
        <span className={BADGE_CLASS}>0</span>
        <div ref={occListRef} className={OCC_LIST_CLASS} />
      </SurfaceButton>

      <div className="flex-1 overflow-hidden px-1 pb-1 flex flex-col">
        <div ref={gridRef} className="flex flex-col gap-0.5 flex-1">
          {weekRowsArr.map(row => {
            const rowStart = row[0].date
            const rowEnd = row[6].date
            const rowKey = `${rowStart.getFullYear()}-${rowStart.getMonth()}-${rowStart.getDate()}`
            const rowBars = multidayLanes
              .filter(l => l.startD <= rowEnd && l.endD >= rowStart)
              .map(l => ({
                ...l,
                startCol: Math.max(0, differenceInCalendarDays(l.startD, rowStart)),
                endCol: Math.min(6, differenceInCalendarDays(l.endD, rowStart)),
                continuesLeft: l.startD < rowStart,
                continuesRight: l.endD > rowEnd,
              }))
            const shownBars = rowBars.filter(b => b.lane < MAX_BAR_LANES)

            return (
              <div key={rowKey} className="relative flex-1">
                <div className="grid grid-cols-7 gap-0.5 h-full">
                  {row.map(({ date, other }) => {
                    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
                    const col = differenceInCalendarDays(date, rowStart)
                    const dayBars = rowBars.filter(b => b.startCol <= col && col <= b.endCol)
                    // Reserve blank lanes per-day based only on the bars that cover
                    // THIS day, so a day past the end of a multiday bar reclaims that
                    // lane for its own single-day occurrence rows instead of leaving it blank.
                    const dayLaneCount = dayBars.reduce((max, b) => Math.max(max, b.lane + 1), 0)
                    const reservedLanes = Math.min(MAX_BAR_LANES, dayLaneCount)
                    const hiddenBarCount = dayBars.filter(b => b.lane >= reservedLanes).length
                    return (
                      <CalCell
                        key={key}
                        date={date}
                        other={other}
                        dayOccs={occsByDay.get(key) ?? EMPTY}
                        today={today}
                        maxVisible={maxVisible}
                        rowH={rowH}
                        reservedLanes={reservedLanes}
                        hiddenBarCount={hiddenBarCount}
                        barCoverCount={dayBars.length}
                        onDayClick={onDayClick}
                      />
                    )
                  })}
                </div>
                {shownBars.length > 0 && (
                  <div
                    className="absolute inset-x-0 pointer-events-none grid grid-cols-7 gap-0.5"
                    style={{ top: barTop, gridAutoRows: rowH || undefined }}
                  >
                    {shownBars.map(b => (
                      <div
                        key={b.occ.id}
                        style={{ gridColumn: `${b.startCol + 1} / span ${b.endCol - b.startCol + 1}`, gridRow: b.lane + 1 }}
                        className={cn(
                          dvBlockVariants({ state: occState({ ...b.occ, metadata: { ...b.occ.metadata, jsTime: b.endD } }) }),
                          // mx-0.5 mirrors the day cell's 2px horizontal padding so a
                          // single-column bar aligns exactly with a single-day occurrence row.
                          'relative flex items-center mx-0.5 rounded-xs sm:rounded-sm px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium overflow-hidden',
                          // 5 (20px) clears the chevron's own ~12px footprint (2px inset
                          // + 10px icon) with a deliberate gap to the title.
                          b.continuesLeft && 'sm:pl-5',
                          b.continuesRight && 'sm:pr-5',
                        )}
                      >
                        {b.continuesLeft && <ContinuationChevron side="left" />}
                        <span className="truncate min-w-0">{b.occ.metadata.title}</span>
                        {b.continuesRight && <ContinuationChevron side="right" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
