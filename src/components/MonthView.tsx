import { useMemo, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'

import { expandWithMultiday, multidayDisplayTitle } from '../model/expansion'
import { sameDay, sortOccs, ccBarClass } from '../presentation'
import { TODAY } from '../constants'
import { SurfaceButton } from './ui/surface-button'
import { cn } from '../lib/utils'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su']

// ── CalCell ───────────────────────────────────────────────────
interface CalCellProps {
  date: Date
  other: boolean
  occs: Occurrence[]
  onDayClick: (date: Date) => void
}

function CalCell({ date, other, occs, onDayClick }: CalCellProps) {
  const isToday = sameDay(date, TODAY)
  const dayOccs = useMemo(
    () => sortOccs(occs.filter(o => o.metadata.jsTime && sameDay(o.metadata.jsTime, date))),
    [occs, date],
  )

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
        'hover:bg-[var(--bg3)]',
        other && 'opacity-25',
        isToday && 'istoday',
      )}
      onClick={() => onDayClick(date)}
      aria-label={ariaLabel}
    >
      <span className="ccn">{date.getDate()}</span>
      <div className="cc-bars">
        {(() => {
          const bars: React.ReactNode[] = []
          dayOccs.slice(0, 4).forEach((o, i) => {
            bars.push(<div key={i} className={`cc-bar ${ccBarClass(o)}`}>{multidayDisplayTitle(o, date) ?? o.metadata.title}</div>)
          })
          if (dayOccs.length > 4) bars.push(
            <div key="more" className="cc-more">+{dayOccs.length - 4}</div>
          )
          return bars
        })()}
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
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const m = month.getMonth()
  const y = month.getFullYear()

  const monthRef = useRef(month)
  useEffect(() => { monthRef.current = month }, [month])
  const onNavigateMonthRef = useRef(onNavigateMonth)
  useEffect(() => { onNavigateMonthRef.current = onNavigateMonth }, [onNavigateMonth])

  const { cells, occs } = useMemo(() => {
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

    return { cells, occs }
  }, [items, roots, y, m])

  function prevMonth() { onNavigateMonth(new Date(y, m - 1, 1)) }
  function nextMonth() { onNavigateMonth(new Date(y, m + 1, 1)) }

  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let sx = 0, sy = 0
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
    const onEnd   = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        const d = monthRef.current
        const next = new Date(d.getFullYear(), d.getMonth() + (dx < 0 ? 1 : -1), 1)
        onNavigateMonthRef.current(next)
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [])

  return (
    <div className="cal-wrap" ref={wrapRef}>
      <div className="cal-hdr">
        <div className="cal-mt"><em>{MONTHS[m]}</em> {y}</div>
        <div className="mnav">
          <button className="mnb" onClick={prevMonth}><ChevronLeft /></button>
          <button className="mnb" onClick={nextMonth}><ChevronRight /></button>
        </div>
      </div>

      <div className="dow-row">
        {DAYS.map(d => <div key={d} className="dow-c">{d}</div>)}
      </div>

      <div className="cal-grid-wrap">
        <div className="cal-grid">
          {cells.map(({ date, other }) => (
            <CalCell
              key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
              date={date}
              other={other}
              occs={occs}
              onDayClick={onDayClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
