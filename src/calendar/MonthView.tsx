import { memo, useMemo, useEffect, useRef } from 'react'
import { useHorizontalSwipe } from './useHorizontalSwipe'
import { useStore } from '../store'
import type { Occurrence } from '../types'

import { expandWithMultiday, multidayDisplayTitle } from '../model/expansion'
import { sameDay, sortOccs, occState } from '../presentation'

const EMPTY: Occurrence[] = []
import { useToday } from '../hooks/useToday'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '../lib/utils'
import { ccBarVariants } from '@/components/ui/occurrence-variants'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su']

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
    `${MONTHS[date.getMonth()]} ${date.getDate()}`,
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
      <div className="flex flex-col gap-px flex-1 overflow-hidden">
        {(() => {
          const bars: React.ReactNode[] = []
          dayOccs.slice(0, 4).forEach((o, i) => {
            bars.push(<div key={i} className={ccBarVariants({ state: occState(o) })}>{multidayDisplayTitle(o, date) ?? o.metadata.title}</div>)
          })
          if (dayOccs.length > 4) bars.push(
            <div key="more" className="text-3xs text-muted-foreground px-0.5">+{dayOccs.length - 4}</div>
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
  const today = useToday()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const m = month.getMonth()
  const y = month.getFullYear()

  const monthRef = useRef(month)
  useEffect(() => { monthRef.current = month }, [month])

  const { cells, occsByDay } = useMemo(() => {
    const rawFirst = new Date(y, m, 1).getDay()
    const first    = (rawFirst + 6) % 7
    const dim      = new Date(y, m + 1, 0).getDate()
    const prev     = new Date(y, m, 0).getDate()
    const nc       = (7 - (first + dim) % 7) % 7

    const cells: Array<{ date: Date; other: boolean }> = []
    for (let i = first - 1; i >= 0; i--)  cells.push({ date: new Date(y, m - 1, prev - i), other: true })
    for (let d = 1; d <= dim; d++)         cells.push({ date: new Date(y, m, d),             other: false })
    for (let d = 1; d <= nc; d++)          cells.push({ date: new Date(y, m + 1, d),          other: true })

    const from = new Date(y, m, 1)
    const to   = new Date(y, m + 1, 0, 23, 59, 59)
    const occs = expandWithMultiday(items, roots, from, to)

    const occsByDay = new Map<string, Occurrence[]>()
    for (const o of occs) {
      if (!o.metadata.jsTime) continue
      const d = o.metadata.jsTime
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const arr = occsByDay.get(key)
      if (arr) arr.push(o)
      else occsByDay.set(key, [o])
    }
    for (const [k, arr] of occsByDay) occsByDay.set(k, sortOccs(arr))

    return { cells, occsByDay }
  }, [items, roots, y, m])

  const wrapRef = useRef<HTMLDivElement>(null)
  useHorizontalSwipe(
    wrapRef,
    () => { const d = monthRef.current; onNavigateMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1)) },
    () => { const d = monthRef.current; onNavigateMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1)) },
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden" ref={wrapRef}>
      <div className="grid grid-cols-7 px-1 shrink-0 pt-2">
        {DAYS.map(d => <div key={d} className="text-center text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground py-0.75">{d}</div>)}
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
