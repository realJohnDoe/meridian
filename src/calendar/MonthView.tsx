import { useEffect, useRef, useState } from 'react'
import { useHorizontalSwipe } from './useHorizontalSwipe'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'

import { multidayDisplayTitle, weekStartsOn } from '@/model'
import { sameDay } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'

const EMPTY: Occurrence[] = []
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday, useCalendarFilter } from '@/hooks'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import { dvBlockVariants } from '@/components/ui/occurrence-variants'


// ── CalCell ───────────────────────────────────────────────────
interface CalCellProps {
  date: Date
  other: boolean
  dayOccs: Occurrence[]
  today: Date
  maxVisible: number
  onDayClick: (date: Date) => void
}

// No memo() here — all props are read directly in the body (no unused
// "force refresh" prop like OccurrenceRow's `tick`), and `dayOccs`/`today`
// stay reference-stable across unrelated MonthView renders (the compiler
// auto-caches occsByDay, and useToday only updates at midnight), so the
// React Compiler's own per-prop memoization already skips this render when
// nothing relevant changed.
function CalCell({ date, other, dayOccs, today, maxVisible, onDayClick }: CalCellProps) {
  const isToday = sameDay(date, today)

  const occCount = dayOccs.length
  const ariaLabel = [
    date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) }),
    isToday ? 'today' : '',
    occCount ? `${occCount} event${occCount !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ')

  // Reserve the last visible slot for the "+N more" line once there's overflow,
  // so the total number of rendered lines never exceeds what CalCell measured as fitting.
  const overflowing = dayOccs.length > maxVisible
  const shown = overflowing ? Math.max(0, maxVisible - 1) : dayOccs.length

  return (
    <SurfaceButton
      className={cn(
        'flex-col items-stretch p-[3px_2px_2px] rounded-[var(--r)] transition-colors overflow-hidden min-h-0 w-full',
        'hover:bg-accent',
        other && 'opacity-25',
      )}
      onClick={() => onDayClick(date)}
      aria-label={ariaLabel}
    >
      <span className={cn(
        'text-xs font-medium text-dim w-5 h-5 flex items-center justify-center rounded-full shrink-0 mb-px',
        isToday && 'bg-primary text-primary-foreground font-bold',
      )}>{date.getDate()}</span>
      <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
        {dayOccs.slice(0, shown).map(o => (
          <div key={`${o.fileSlug}-${o.date}`} className={cn(dvBlockVariants({ state: occState(o) }), 'flex items-center rounded-xs sm:rounded-sm px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium w-full overflow-hidden')}>
            <span className="truncate min-w-0">{multidayDisplayTitle(o, date) ?? o.metadata.title}</span>
          </div>
        ))}
        {overflowing && (
          <div className="text-3xs sm:text-2xs text-foreground px-0.5 sm:px-1">+{dayOccs.length - shown}</div>
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
  // just as they do in Agenda and Day views.
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

  const occsByDay = (() => {
    const map = new Map<string, Occurrence[]>()
    for (const o of filterOccs(allOccs)) {
      if (!o.metadata.jsTime) continue
      const d = o.metadata.jsTime
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const arr = map.get(key)
      if (arr) arr.push(o)
      else map.set(key, [o])
    }
    for (const [k, arr] of map) map.set(k, sortOccs(arr))
    return map
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
  const weekRows = Math.ceil(cells.length / 7)
  const gridRef = useRef<HTMLDivElement>(null)
  const rowSentinelRef = useRef<HTMLDivElement>(null)
  const [maxVisible, setMaxVisible] = useState(3)

  useEffect(() => {
    const gridEl = gridRef.current
    const rowEl = rowSentinelRef.current
    if (!gridEl || !rowEl) return

    const CELL_CHROME = 26 // day-number badge (h-5=20px) + mb-px + cell padding (p-[3px_2px_2px])
    const ROW_GAP = 2      // gap-0.5 between rows

    const compute = () => {
      const rowH = rowEl.offsetHeight
      if (!rowH) return
      const cellH = gridEl.clientHeight / weekRows
      const available = cellH - CELL_CHROME
      const n = Math.floor((available + ROW_GAP) / (rowH + ROW_GAP))
      setMaxVisible(Math.min(8, Math.max(1, n)))
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

      <div className="flex-1 overflow-hidden px-1 pb-1 flex flex-col">
        <div ref={gridRef} className="grid grid-cols-7 gap-0.5 flex-1">
          {cells.map(({ date, other }) => {
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            return (
              <CalCell
                key={key}
                date={date}
                other={other}
                dayOccs={occsByDay.get(key) ?? EMPTY}
                today={today}
                maxVisible={maxVisible}
                onDayClick={onDayClick}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
