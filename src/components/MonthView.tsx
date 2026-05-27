import { useMemo, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { expandRange } from '../recurrence'
import { sameDay, sortOccs, ccBarClass } from '../meridian'
import { cn } from '../lib/utils'

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

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
    () => sortOccs(occs.filter(o => sameDay(o.jsTime, date))) as Occurrence[],
    [occs, date],
  )

  return (
    <div
      className={cn(
        'flex flex-col p-[3px] pb-0.5 rounded-[10px] cursor-pointer transition-colors overflow-hidden min-h-0 hover:bg-bg3',
        other && 'opacity-25',
      )}
      onClick={() => onDayClick(date)}
    >
      <span className={cn(
        'text-[11px] font-medium text-t2 size-5 flex items-center justify-center rounded-full shrink-0 mb-px',
        isToday && 'bg-ind text-white font-bold',
      )}>
        {date.getDate()}
      </span>
      <div className="flex flex-col gap-px flex-1 overflow-hidden">
        {(() => {
          const seen = new Set<string>()
          const bars: React.ReactNode[] = []
          dayOccs.slice(0, 4).forEach((o, i) => {
            if (o.multiday) {
              if (seen.has(o._nodeId)) return
              seen.add(o._nodeId)
              bars.push(<div key={i} className="cc-bar multiday">{o.title}</div>)
            } else {
              bars.push(<div key={i} className={`cc-bar ${ccBarClass(o)}`}>{o.title}</div>)
            }
          })
          if (dayOccs.length > 4) bars.push(
            <div key="more" className="text-[8px] text-t3 px-0.5">+{dayOccs.length - 4}</div>
          )
          return bars
        })()}
      </div>
    </div>
  )
}

// ── MonthView ─────────────────────────────────────────────────
interface Props {
  onDayClick: (date: Date) => void
}

export default function MonthView({ onDayClick }: Props) {
  const calMonth    = useStore(s => s.calMonth)
  const nodes       = useStore(s => s.nodes)
  const setCalMonth = useStore(s => s.setCalMonth)

  const m = calMonth.getMonth()
  const y = calMonth.getFullYear()

  const calMonthRef = useRef(calMonth)
  useEffect(() => { calMonthRef.current = calMonth }, [calMonth])

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
    const occs = expandRange(nodes, from, to) as Occurrence[]

    return { cells, occs }
  }, [nodes, y, m])

  function prevMonth() {
    const d = calMonthRef.current
    setCalMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function nextMonth() {
    const d = calMonthRef.current
    setCalMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

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
        if (dx < 0) nextMonth(); else prevMonth()
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend',   onEnd)
    }
  }, []) // stable — reads latest month via calMonthRef

  return (
    <div className="flex-1 flex flex-col overflow-hidden" ref={wrapRef}>
      {/* Month header */}
      <div className="px-3.5 pt-3 pb-2 flex items-center justify-between shrink-0">
        <div className="font-display text-[20px] font-light text-t0 [&_em]:italic [&_em]:text-ind">
          <em>{MONTHS[m]}</em> {y}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="size-8 rounded-full flex items-center justify-center text-t2 transition-colors hover:bg-bg3"
            onClick={prevMonth}
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <button
            className="size-8 rounded-full flex items-center justify-center text-t2 transition-colors hover:bg-bg3"
            onClick={nextMonth}
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 px-1 shrink-0">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold tracking-[.06em] uppercase text-t3 py-[3px]">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-hidden px-1 pb-1 flex flex-col">
        <div className="grid grid-cols-7 gap-0.5 flex-1">
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
