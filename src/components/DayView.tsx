import { useMemo, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { Checkbox } from './ui/checkbox'
import type { Occurrence } from '../types'
import { expandRange, fmtT, parseDurationHours } from '../model/expand'
import { sameDay, addDays, fmtLong, sortOccs, occState } from '../meridian'

import { TODAY } from '../constants'
const SH = 7    // start hour on timeline
const EH = 22   // end hour on timeline
const HP = 56   // pixels per hour

function dvBlkClass(o: Occurrence): string {
  const s = occState(o)
  if (s === 'done' || s === 'event-past') return 'past'
  if (s === 'task-open') return 'task'
  if (s === 'task-p1')   return 'task-p1'
  if (s === 'task-p2')   return 'task-p2'
  if (s === 'task-p3')   return 'task-p3'
  return 'event'
}

function formatHour(h: number): string {
  if (h < 12)  return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

/** Greedy column-packing: returns an array of columns, each a list of events. */
function computeColumns(events: Occurrence[]): Occurrence[][] {
  const sorted = [...events].sort((a, b) => +a.jsTime - +b.jsTime)
  const cols: Occurrence[][] = []
  for (const ev of sorted) {
    const dh = parseDurationHours(ev.duration)
    const endMs = ev.jsTime.getTime() + dh * 3_600_000
    ;(ev as any)._dh    = dh
    ;(ev as any)._endMs = endMs
    let placed = false
    for (const col of cols) {
      if (ev.jsTime.getTime() >= (col[col.length - 1] as any)._endMs) {
        col.push(ev); placed = true; break
      }
    }
    if (!placed) cols.push([ev])
  }
  return cols
}

// ── Sub-components ────────────────────────────────────────────

interface AllDayItemProps { o: Occurrence; onOpen: (o: Occurrence) => void }
function AllDayItem({ o, onOpen }: AllDayItemProps) {
  const hasTrack = o.done !== undefined
  return (
    <div
      className={`dv-aditem ${o.multiday ? 'multiday' : dvBlkClass(o)}`}
      onClick={() => onOpen(o)}
    >
      {hasTrack && <Checkbox checked={!!o.done} tabIndex={-1} aria-hidden className="size-3.5 opacity-70 pointer-events-none" />}
      <span>{o.title}</span>
    </div>
  )
}

interface EventBlockProps {
  o: Occurrence
  colIndex: number
  totalCols: number
  onOpen: (o: Occurrence) => void
}
function EventBlock({ o, colIndex, totalCols, onOpen }: EventBlockProps) {
  const h   = o.jsTime.getHours() + o.jsTime.getMinutes() / 60
  const dh  = (o as any)._dh as number
  const top = (h - SH) * HP + 1
  const height = Math.max(dh * HP - 4, 28)
  const hasTrack = o.done !== undefined

  // Use CSS calc() for column layout — avoids a rAF measurement pass.
  // avail = 100% - 50px (time label) - 6px (right pad) = 100% - 56px
  const left  = `calc(50px + ${colIndex} * (100% - 56px) / ${totalCols})`
  const width = `calc((100% - 56px) / ${totalCols} - 3px)`

  return (
    <div
      className={`dv-eblk ${dvBlkClass(o)}`}
      style={{ top, height, left, width }}
      onClick={() => onOpen(o)}
    >
      <div className="dv-et">
        {hasTrack && <Checkbox checked={!!o.done} tabIndex={-1} aria-hidden className="size-3 pointer-events-none" />}
        {o.title}
      </div>
      <div className="dv-em">
        {fmtT(o.time)}{o.duration ? ` · ${o.duration}` : ''}
      </div>
    </div>
  )
}

// ── DayView ───────────────────────────────────────────────────

interface Props {
  onOpen: (occ: Occurrence, scope?: string) => void
}

export default function DayView({ onOpen }: Props) {
  const dvDate    = useStore(s => s.dvDate)
  const nodes     = useStore(s => s.nodes)
  const setDvDate = useStore(s => s.setDvDate)

  const { allDay, cols } = useMemo(() => {
    const from = new Date(dvDate); from.setHours(0, 0, 0, 0)
    const to   = new Date(dvDate); to.setHours(23, 59, 59)
    const occs  = expandRange(nodes, from, to) as Occurrence[]
    const allDay = sortOccs(occs.filter(o => !fmtT(o.time) || o.multiday)) as Occurrence[]
    const timed  = sortOccs(occs.filter(o => !!fmtT(o.time) && !o.multiday)) as Occurrence[]
    return { allDay, cols: computeColumns(timed) }
  }, [dvDate, nodes])

  // Scroll timeline to 8 am whenever the date changes.
  const scRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTimeout(() => scRef.current?.scrollTo({ top: (8 - SH) * HP, behavior: 'instant' }), 50)
  }, [dvDate])

  // Swipe left/right on the timeline to navigate days (replaces addSwipe in initApp).
  const dvDateRef = useRef(dvDate)
  useEffect(() => { dvDateRef.current = dvDate }, [dvDate])

  const tlRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = tlRef.current
    if (!el) return
    let sx = 0, sy = 0
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
    const onEnd   = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        setDvDate(addDays(dvDateRef.current, dx < 0 ? 1 : -1))
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [setDvDate])

  // Deduplicate multiday events in all-day strip.
  const seen = new Set<string>()
  const allDayDeduped = allDay.filter(o => {
    if (!o.multiday) return true
    if (seen.has(o._nodeId)) return false
    seen.add(o._nodeId); return true
  })

  const totalCols = Math.max(cols.length, 1)
  const isToday   = sameDay(dvDate, TODAY)

  return (
    <>
      {/* All-day / multiday strip */}
      {allDayDeduped.length > 0 && (
        <div className="dv-allday" id="dvAllDay">
          <div className="dv-adlbl">All day</div>
          {allDayDeduped.map((o, i) => (
            <AllDayItem key={`${o._nodeId}-${o.date}-${i}`} o={o} onOpen={onOpen} />
          ))}
        </div>
      )}

      {/* Scrollable timeline */}
      <div className="dv-sc" id="dvSc" ref={scRef}>
        <div className="dv-tl" id="dvTl" ref={tlRef}>

          {/* Hour rows */}
          {Array.from({ length: EH - SH + 1 }, (_, i) => SH + i).map(h => (
            <div key={h} className="dv-hr">
              <span className="dv-hlbl">{formatHour(h)}</span>
              <div className="dv-hline" />
            </div>
          ))}

          {/* Current-time indicator */}
          {isToday && (() => {
            const now = new Date()
            const nh  = now.getHours() + now.getMinutes() / 60
            if (nh < SH || nh > EH) return null
            return (
              <div className="now-line" style={{ top: (nh - SH) * HP }}>
                <div className="now-dot" />
              </div>
            )
          })()}

          {/* Timed event blocks */}
          {cols.flatMap((col, ci) =>
            col
              .filter(o => {
                const h = o.jsTime.getHours() + o.jsTime.getMinutes() / 60
                return h >= SH && h <= EH
              })
              .map(o => (
                <EventBlock
                  key={`${o._nodeId}-${o.date}-${o.time ?? ''}`}
                  o={o}
                  colIndex={ci}
                  totalCols={totalCols}
                  onOpen={onOpen}
                />
              ))
          )}
        </div>
      </div>
    </>
  )
}

/** Exported so App.tsx toolbar can render the current date title reactively. */
export { fmtLong }
