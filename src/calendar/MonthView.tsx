import { memo, useMemo, useEffect, useRef } from 'react'
import { useHorizontalSwipe } from './useHorizontalSwipe'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'

import { multidayDisplayTitle, weekStartsOn } from '@/model'
import { sameDay } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'

const EMPTY: Occurrence[] = []
import { useToday, useCalendarFilter, useExpandWithMultiday } from '@/hooks'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import { dvBlockVariants } from '@/components/ui/occurrence-variants'
import { KindIcon } from '@/components'


// ── CalCell ───────────────────────────────────────────────────
interface CalCellProps {
  date: Date
  other: boolean
  dayOccs: Occurrence[]
  today: Date
  onDayClick: (date: Date) => void
}

const CalCell = memo(function CalCell({ date, other, dayOccs, today, onDayClick }: CalCellProps) {
  const isToday = sameDay(date, today)

  const occCount = dayOccs.length
  const ariaLabel = [
    date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) }),
    isToday ? 'today' : '',
    occCount ? `${occCount} event${occCount !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ')

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
        {(() => {
          const bars: React.ReactNode[] = []
          dayOccs.slice(0, 3).forEach((o, i) => {
            bars.push(
              <div key={i} className={cn(dvBlockVariants({ state: occState(o) }), 'flex items-center gap-0.5 sm:gap-1 rounded-sm px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium w-full overflow-hidden')}>
                <KindIcon item={o} size={10} className="shrink-0 opacity-70 hidden sm:block" />
                <span className="truncate min-w-0">{multidayDisplayTitle(o, date) ?? o.metadata.title}</span>
              </div>
            )
          })
          if (dayOccs.length > 3) bars.push(
            <div key="more" className="text-3xs sm:text-2xs text-muted-foreground px-0.5 sm:px-1">+{dayOccs.length - 3}</div>
          )
          return bars
        })()}
      </div>
    </SurfaceButton>
  )
})

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
  const weekdayLabels = useMemo(() => {
    const sunday = new Date(2025, 0, 5)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday)
      d.setDate(5 + (ws + i) % 7)
      return d.toLocaleDateString(undefined, { weekday: 'short' })
    })
  }, [ws])

  const m = month.getMonth()
  const y = month.getFullYear()

  const monthRef = useRef(month)
  useEffect(() => { monthRef.current = month }, [month])

  // useExpandWithMultiday caches by (fromMs, toMs, items structure, roots) so
  // non-structural edits (done-toggle, priority change) skip re-expansion here
  // just as they do in Agenda and Day views.
  const allOccs = useExpandWithMultiday(items, roots, new Date(y, m, 1), new Date(y, m + 1, 0, 23, 59, 59))

  // Cell grid depends only on month shape and locale week-start — independent of occurrences.
  const cells = useMemo(() => {
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
  }, [y, m, ws])

  const occsByDay = useMemo(() => {
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
  }, [allOccs, filterOccs])

  const wrapRef = useRef<HTMLDivElement>(null)
  useHorizontalSwipe(
    wrapRef,
    () => { const d = monthRef.current; onNavigateMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1)) },
    () => { const d = monthRef.current; onNavigateMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1)) },
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden pb-10" ref={wrapRef}>
      <div className="grid grid-cols-7 px-1 shrink-0 pt-2">
        {weekdayLabels.map((d, i) => <div key={i} className="text-center text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground py-0.75">{d}</div>)}
      </div>

      <div className="flex-1 overflow-hidden px-1 pb-1 flex flex-col">
        <div className="grid grid-cols-7 gap-0.5 flex-1">
          {cells.map(({ date, other }) => {
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            return (
              <CalCell
                key={key}
                date={date}
                other={other}
                dayOccs={occsByDay.get(key) ?? EMPTY}
                today={today}
                onDayClick={onDayClick}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
