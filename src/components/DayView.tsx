import { useMemo, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CheckSquare, Square } from 'lucide-react'
import { useStore } from '../store'  // items + roots only
import { Button } from './ui/button'
import { SurfaceButton } from './ui/surface-button'
import { cn } from '../lib/utils'
import type { Occurrence, EditScope } from '../types'
import KindIcon from './KindIcon'
import { expandWithMultiday, fmtT, parseDurationHours, multidayDisplayTitle } from '../model/expansion'
import { sameDay, addDays, fmtLong, sortOccs, occDvClass } from '../presentation'

import { TODAY } from '../constants'
const SH = 7    // start hour on timeline
const EH = 22   // end hour on timeline
const HP = 56   // pixels per hour


function formatHour(h: number): string {
  if (h < 12)  return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

interface LayoutEvent { occ: Occurrence; dh: number; endMs: number }

/** Greedy column-packing: returns columns of layout-annotated events. */
function computeColumns(events: Occurrence[]): LayoutEvent[][] {
  const sorted = [...events]
    .sort((a, b) => +(a.metadata.jsTime ?? 0) - +(b.metadata.jsTime ?? 0))
    .map<LayoutEvent>(occ => {
      const dh = parseDurationHours(occ.metadata.duration)
      return { occ, dh, endMs: (occ.metadata.jsTime?.getTime() ?? 0) + dh * 3_600_000 }
    })
  const cols: LayoutEvent[][] = []
  for (const ev of sorted) {
    let placed = false
    for (const col of cols) {
      if ((ev.occ.metadata.jsTime?.getTime() ?? 0) >= col[col.length - 1].endMs) {
        col.push(ev); placed = true; break
      }
    }
    if (!placed) cols.push([ev])
  }
  return cols
}

// ── Sub-components ────────────────────────────────────────────

interface AllDayItemProps { o: Occurrence; onOpen: (o: Occurrence) => void; displayTitle?: string }
function AllDayItem({ o, onOpen, displayTitle }: AllDayItemProps) {
  const title = displayTitle ?? o.metadata.title
  return (
    <SurfaceButton
      className={cn(
        `dv-aditem ${occDvClass(o)}`,
        'w-full flex items-center gap-[6px] rounded-[5px] px-[9px] py-[3px] text-[12px] font-medium truncate mb-0.5',
        'hover:brightness-110',
      )}
      onClick={() => onOpen(o)}
      aria-label={title}
    >
      <KindIcon item={o} size={11} className="shrink-0 opacity-70" />
      <span>{title}</span>
    </SurfaceButton>
  )
}

function renderAllDayItem(
  o: Occurrence,
  i: number,
  dvMidnight: Date,
  onOpen: (o: Occurrence) => void,
) {
  return (
    <AllDayItem
      key={`${o.fileSlug}-${o.date}-${i}`}
      o={o}
      onOpen={onOpen}
      displayTitle={multidayDisplayTitle(o, dvMidnight)}
    />
  )
}

interface EventBlockProps {
  o: Occurrence
  dh: number
  colIndex: number
  totalCols: number
  onOpen: (o: Occurrence) => void
}
function EventBlock({ o, dh, colIndex, totalCols, onOpen }: EventBlockProps) {
  const h   = (o.metadata.jsTime?.getHours() ?? 0) + (o.metadata.jsTime?.getMinutes() ?? 0) / 60
  const top = (h - SH) * HP + 1
  const height = Math.max(dh * HP - 4, 28)
  const hasTrack = o.metadata.done !== undefined
  const isDone = !!o.metadata.done

  const left  = `calc(50px + ${colIndex} * (100% - 56px) / ${totalCols})`
  const width = `calc((100% - 56px) / ${totalCols} - 3px)`

  const timeLabel = fmtT(o.time)
  const ariaLabel = [o.metadata.title, timeLabel, o.metadata.duration].filter(Boolean).join(', ')

  return (
    <SurfaceButton
      className={cn(
        `dv-eblk ${occDvClass(o)}`,
        'absolute rounded-[7px] px-2 py-[5px] text-xs font-medium overflow-hidden transition-opacity hover:opacity-[0.85]',
      )}
      style={{ top, height, left, width }}
      onClick={() => onOpen(o)}
      aria-label={ariaLabel}
    >
      <div className="dv-et">
        {/* Non-interactive done indicator — replaced Checkbox to avoid nested buttons */}
        {hasTrack && (
          isDone
            ? <CheckSquare size={12} className="shrink-0 opacity-80" aria-hidden />
            : <Square size={12} className="shrink-0 opacity-50" aria-hidden />
        )}
        {o.metadata.title}
      </div>
      <div className="dv-em">
        {timeLabel}{o.metadata.duration ? ` · ${o.metadata.duration}` : ''}
      </div>
    </SurfaceButton>
  )
}

// ── DayView ───────────────────────────────────────────────────

interface Props {
  date: Date
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onNavigateDate?: (date: Date) => void
}

export default function DayView({ date: dvDate, onOpen, onNavigateDate }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const { allDay, cols } = useMemo(() => {
    const from = new Date(dvDate); from.setHours(0, 0, 0, 0)
    const to   = new Date(dvDate); to.setHours(23, 59, 59)
    const allOccs = sortOccs(expandWithMultiday(items, roots, from, to))
    const allDay  = allOccs.filter(o => !fmtT(o.time))
    const timed   = allOccs.filter(o =>  !!fmtT(o.time))
    return { allDay, cols: computeColumns(timed) }  // cols: LayoutEvent[][]
  }, [dvDate, items, roots])

  const scRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTimeout(() => scRef.current?.scrollTo({ top: (8 - SH) * HP, behavior: 'instant' }), 50)
  }, [dvDate])

  const dvDateRef = useRef(dvDate)
  useEffect(() => { dvDateRef.current = dvDate }, [dvDate])

  const tlRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!onNavigateDate) return
    const el = tlRef.current
    if (!el) return
    let sx = 0, sy = 0
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
    const onEnd   = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onNavigateDate(addDays(dvDateRef.current, dx < 0 ? 1 : -1))
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [onNavigateDate])

  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!sameDay(dvDate, TODAY)) return
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [dvDate])

  const totalCols = Math.max(cols.length, 1)
  const isToday   = sameDay(dvDate, TODAY)

  const dvMidnight = new Date(dvDate)
  dvMidnight.setHours(0, 0, 0, 0)

  const ALL_DAY_THRESHOLD = 3
  const [allDayExpanded, setAllDayExpanded] = useState(false)
  const hiddenCount = allDay.length - ALL_DAY_THRESHOLD

  return (
    <>
      {/* All-day / multiday strip */}
      {allDay.length > 0 && (
        <div className="dv-allday" id="dvAllDay">
          <div className="dv-adlbl">All day</div>

          {/* Always-visible first N items */}
          {allDay.slice(0, ALL_DAY_THRESHOLD).map((o, i) => renderAllDayItem(o, i, dvMidnight, onOpen))}

          {/* Animated overflow */}
          {hiddenCount > 0 && (
            <div className={`dv-adoverflow${allDayExpanded ? ' open' : ''}`}>
              <div>
                {allDay.slice(ALL_DAY_THRESHOLD).map((o, i) =>
                  renderAllDayItem(o, ALL_DAY_THRESHOLD + i, dvMidnight, onOpen)
                )}
              </div>
            </div>
          )}

          {/* Expand / collapse toggle */}
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 py-0 text-[11px] text-muted-foreground hover:text-secondary-foreground gap-1 self-start"
              onClick={() => setAllDayExpanded(v => !v)}
            >
              {allDayExpanded
                ? <><ChevronUp size={11} />Show less</>
                : <><ChevronDown size={11} />{hiddenCount} more</>}
            </Button>
          )}
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
              .filter(({ occ }) => {
                const h = (occ.metadata.jsTime?.getHours() ?? 0) + (occ.metadata.jsTime?.getMinutes() ?? 0) / 60
                return h >= SH && h <= EH
              })
              .map(({ occ, dh }) => (
                <EventBlock
                  key={occ.id}
                  o={occ}
                  dh={dh}
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
