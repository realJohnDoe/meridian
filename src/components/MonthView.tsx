import { useMemo, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { expandRange } from '../model/expand'
import { sameDay, sortOccs, ccBarClass } from '../meridian'

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
      className={`cal-cell${other ? ' other' : ''}${isToday ? ' istoday' : ''}`}
      onClick={() => onDayClick(date)}
    >
      <span className="ccn">{date.getDate()}</span>
      <div className="cc-bars">
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
            <div key="more" className="cc-more">+{dayOccs.length - 4}</div>
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
  const calMonth   = useStore(s => s.calMonth)
  const nodes      = useStore(s => s.nodes)
  const setCalMonth = useStore(s => s.setCalMonth)

  const m = calMonth.getMonth()
  const y = calMonth.getFullYear()

  // Keep a ref so swipe handlers always navigate relative to the current month
  // without needing to re-attach listeners on every render.
  const calMonthRef = useRef(calMonth)
  useEffect(() => { calMonthRef.current = calMonth }, [calMonth])

  // Derive the full grid (trailing prev-month cells + current month + leading
  // next-month cells) and expand occurrences — both memoised on nodes + month.
  const { cells, occs } = useMemo(() => {
    const rawFirst = new Date(y, m, 1).getDay()
    const first    = (rawFirst + 6) % 7          // Monday-first offset
    const dim      = new Date(y, m + 1, 0).getDate()
    const prev     = new Date(y, m, 0).getDate()
    const nc       = (7 - (first + dim) % 7) % 7 // trailing cells

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

  // Swipe left/right to navigate months (replaces the addSwipe() call in initApp).
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
