import { useMemo, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CalendarDays, CheckSquare, FileText } from 'lucide-react'
import { useStore } from '../store'
import { Checkbox } from './ui/checkbox'
import { Button } from './ui/button'
import type { Occurrence } from '../types'
import { isStandaloneOcc, occKind } from '../types'
import { expandRange, fmtT, parseDurationHours, parseDurationDays, multidayCoversDate, parseDateString, multidayDisplayTitle } from '../model/expansion'
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
  const sorted = [...events].sort((a, b) => +(a.metadata.jsTime ?? 0) - +(b.metadata.jsTime ?? 0))
  const cols: Occurrence[][] = []
  for (const ev of sorted) {
    const dh = parseDurationHours(ev.metadata.duration)
    const endMs = (ev.metadata.jsTime?.getTime() ?? 0) + dh * 3_600_000
    ev.metadata._dh    = dh
    ev.metadata._endMs = endMs
    let placed = false
    for (const col of cols) {
      if ((ev.metadata.jsTime?.getTime() ?? 0) >= col[col.length - 1].metadata._endMs!) {
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
  const kind = occKind(o)
  const Icon = kind === 'task' ? CheckSquare : kind === 'event' ? CalendarDays : FileText
  return (
    <div
      className={`dv-aditem ${dvBlkClass(o)}`}
      onClick={() => onOpen(o)}
    >
      <Icon size={11} className="shrink-0 opacity-70" />
      <span>{displayTitle ?? o.metadata.title}</span>
    </div>
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
  colIndex: number
  totalCols: number
  onOpen: (o: Occurrence) => void
}
function EventBlock({ o, colIndex, totalCols, onOpen }: EventBlockProps) {
  const h   = (o.metadata.jsTime?.getHours() ?? 0) + (o.metadata.jsTime?.getMinutes() ?? 0) / 60
  const dh  = o.metadata._dh as number
  const top = (h - SH) * HP + 1
  const height = Math.max(dh * HP - 4, 28)
  const hasTrack = o.metadata.done !== undefined

  const left  = `calc(50px + ${colIndex} * (100% - 56px) / ${totalCols})`
  const width = `calc((100% - 56px) / ${totalCols} - 3px)`

  return (
    <div
      className={`dv-eblk ${dvBlkClass(o)}`}
      style={{ top, height, left, width }}
      onClick={() => onOpen(o)}
    >
      <div className="dv-et">
        {hasTrack && <Checkbox checked={!!o.metadata.done} tabIndex={-1} aria-hidden className="size-3 pointer-events-none" />}
        {o.metadata.title}
      </div>
      <div className="dv-em">
        {fmtT(o.time)}{o.metadata.duration ? ` · ${o.metadata.duration}` : ''}
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
  const items     = useStore(s => s.items)
  const roots     = useStore(s => s.roots)
  const setDvDate = useStore(s => s.setDvDate)

  const { allDay, cols } = useMemo(() => {
    const from = new Date(dvDate); from.setHours(0, 0, 0, 0)
    const to   = new Date(dvDate); to.setHours(23, 59, 59)
    const occs = expandRange(items, roots, from, to)

    // Multi-day events that started before today don't appear in expandRange
    // output (their single occurrence is on the start date). Find them by
    // scanning store items directly and add a virtual occurrence for today.
    const extraMultiday = items
      .filter(isStandaloneOcc)
      .map(i => ({
        ...i,
        source: 'explicit' as const,
        metadata: { ...(roots.get(i.fileSlug) ?? { title: '', tags: [], topics: [] }), ...i.metadata, jsTime: new Date(from) } as Occurrence['metadata'],
      }))
      .filter(i => {
        const days = parseDurationDays(i.metadata.duration)
        if (!days || days < 2) return false
        const start = parseDateString(i.date)
        return !!start && start < from && multidayCoversDate(i as Occurrence, dvDate)
      })

    const allOccs = sortOccs([...occs, ...extraMultiday])
    const allDay  = allOccs.filter(o => !fmtT(o.time))
    const timed   = allOccs.filter(o =>  !!fmtT(o.time))
    return { allDay, cols: computeColumns(timed) }
  }, [dvDate, items, roots])

  const scRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTimeout(() => scRef.current?.scrollTo({ top: (8 - SH) * HP, behavior: 'instant' }), 50)
  }, [dvDate])

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

  // Deduplicate: a multi-day event can appear both from expandRange (start date)
  // and from the extraMultiday coverage scan if both land on the same day.
  const seen = new Set<string>()
  const allDayDeduped = allDay.filter(o => {
    if ((parseDurationDays(o.metadata.duration) ?? 0) < 2) return true
    if (seen.has(o.fileSlug)) return false
    seen.add(o.fileSlug); return true
  })

  const totalCols = Math.max(cols.length, 1)
  const isToday   = sameDay(dvDate, TODAY)

  const dvMidnight = new Date(dvDate)
  dvMidnight.setHours(0, 0, 0, 0)

  const ALL_DAY_THRESHOLD = 3
  const [allDayExpanded, setAllDayExpanded] = useState(false)
  const hiddenCount = allDayDeduped.length - ALL_DAY_THRESHOLD

  return (
    <>
      {/* All-day / multiday strip */}
      {allDayDeduped.length > 0 && (
        <div className="dv-allday" id="dvAllDay">
          <div className="dv-adlbl">All day</div>

          {/* Always-visible first N items */}
          {allDayDeduped.slice(0, ALL_DAY_THRESHOLD).map((o, i) => renderAllDayItem(o, i, dvMidnight, onOpen))}

          {/* Animated overflow */}
          {hiddenCount > 0 && (
            <div className={`dv-adoverflow${allDayExpanded ? ' open' : ''}`}>
              <div>
                {allDayDeduped.slice(ALL_DAY_THRESHOLD).map((o, i) =>
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
              className="h-6 px-2 py-0 text-[11px] text-[var(--t3)] hover:text-[var(--t1)] gap-1 self-start"
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
              .filter(o => {
                const h = (o.metadata.jsTime?.getHours() ?? 0) + (o.metadata.jsTime?.getMinutes() ?? 0) / 60
                return h >= SH && h <= EH
              })
              .map(o => (
                <EventBlock
                  key={`${o.fileSlug}-${o.date}-${o.time ?? ''}`}
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
