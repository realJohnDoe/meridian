import { useMemo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { startOfDay } from 'date-fns'
import { useHorizontalSwipe } from './useHorizontalSwipe'
import { ChevronDown, ChevronUp, CheckSquare, Square } from 'lucide-react'
import { useStore } from '@/store'  // items + roots only
import { Button } from '@/components/ui/button'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { multidayDisplayTitle, fmtT, parseDurationHours } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { dvBlockVariants } from '@/components/ui/occurrence-variants'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday, useCalendarFilter } from '@/hooks'
const HOURS = 24              // hours shown on the timeline
const HP = 56                 // pixels per hour
const GUTTER = 64              // px reserved for the left hour-label column
const DEFAULT_SCROLL_HOUR = 7  // hour scrolled into view on mount
const CREATE_SNAP_MIN = 15     // minutes new events snap to when created via click
const DEFAULT_CREATE_DURATION = '1h'

/** Localized hour-boundary label (0:00…24:00), matching the Intl formatting fmtT uses for event times. */
function formatHourBoundary(h: number, hour12: boolean): string {
  if (!hour12) return h === HOURS ? '24:00' : `${String(h).padStart(2, '0')}:00`
  const d = new Date(); d.setHours(h % HOURS, 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
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
        dvBlockVariants({ state: occState(o) }),
        'w-full flex items-center rounded-xs sm:rounded-sm px-2 py-0.5 text-xs font-medium truncate mb-0.5',
      )}
      onClick={() => onOpen(o)}
      aria-label={title}
    >
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
  const top = h * HP + 1
  const height = Math.max(dh * HP - 4, 28)
  const hasTrack = o.metadata.done !== undefined
  const isDone = !!o.metadata.done

  const colWidth = `(100% - ${GUTTER}px) / ${totalCols}`
  const left  = `calc(${GUTTER}px + ${colIndex} * (${colWidth}))`
  const width = `calc(${colWidth})`

  const timeLabel = fmtT(o.time)
  const ariaLabel = [o.metadata.title, timeLabel, o.metadata.duration].filter(Boolean).join(', ')

  return (
    <SurfaceButton
      className={cn(
        dvBlockVariants({ state: occState(o) }),
        'absolute rounded-md px-2 py-1 text-xs font-medium overflow-hidden transition-colors',
      )}
      style={{ top, height, left, width }}
      onClick={() => onOpen(o)}
      aria-label={ariaLabel}
    >
      <div className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-1.5">
        {/* Non-interactive done indicator — replaced Checkbox to avoid nested buttons */}
        {hasTrack && (
          isDone
            ? <CheckSquare size={12} className="shrink-0 opacity-80" aria-hidden />
            : <Square size={12} className="shrink-0 opacity-50" aria-hidden />
        )}
        {o.metadata.title}
      </div>
      <div className="text-2xs font-mono mt-px">
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
  /** Called when the user clicks empty timeline space to start a new event at that time. */
  onCreate?: (date: Date, time: string, duration: string) => void
}

export default function DayView({ date: dvDate, onOpen, onNavigateDate, onCreate }: Props) {
  const today  = useToday()
  const items  = useStore(s => s.items)
  const roots  = useStore(s => s.roots)
  const hour12 = useStore(s => s.localePrefs.hour12)

  const { filterOccs } = useCalendarFilter()

  const dvFrom = startOfDay(dvDate)
  const dvTo   = new Date(dvDate); dvTo.setHours(23, 59, 59)
  const dvOccs = filterOccs(useExpandWithMultiday(items, roots, dvFrom, dvTo))

  const { allDay, cols } = useMemo(() => {
    const sorted = sortOccs(dvOccs)
    const allDay = sorted.filter(o => !fmtT(o.time))
    const timed  = sorted.filter(o =>  !!fmtT(o.time))
    return { allDay, cols: computeColumns(timed) }  // cols: LayoutEvent[][]
  }, [dvOccs])

  const scRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTimeout(() => scRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HP, behavior: 'instant' }), 50)
  }, [dvDate])

  const dvDateRef = useRef(dvDate)
  useEffect(() => { dvDateRef.current = dvDate }, [dvDate])

  const tlRef = useRef<HTMLDivElement>(null)
  useHorizontalSwipe(
    tlRef,
    () => { onNavigateDate?.(addDays(dvDateRef.current, -1)) },
    () => { onNavigateDate?.(addDays(dvDateRef.current,  1)) },
  )

  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!sameDay(dvDate, today)) return
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [dvDate, today])

  const totalCols = Math.max(cols.length, 1)
  const isToday   = sameDay(dvDate, today)

  const dvMidnight = startOfDay(dvDate)

  const ALL_DAY_THRESHOLD = 3
  const [allDayExpanded, setAllDayExpanded] = useState(false)
  const hiddenCount = allDay.length - ALL_DAY_THRESHOLD

  const handleGridClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const minutesFromMidnight = ((e.clientY - rect.top) / HP) * 60
    const snapped = Math.round(minutesFromMidnight / CREATE_SNAP_MIN) * CREATE_SNAP_MIN
    const clamped = Math.min(Math.max(snapped, 0), HOURS * 60 - CREATE_SNAP_MIN)
    const time = `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
    onCreate?.(dvDate, time, DEFAULT_CREATE_DURATION)
  }

  return (
    <>
      {/* All-day / multiday strip */}
      {allDay.length > 0 && (
        <div className="px-3 py-1.5 border-b border-input bg-card shrink-0" id="dvAllDay">
          <div className="text-2xs font-semibold tracking-[.07em] uppercase text-muted-foreground mb-1">All day</div>

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
              className="h-6 px-2 py-0 text-xs text-muted-foreground hover:text-secondary-foreground gap-1 self-start"
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
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] relative" id="dvSc" ref={scRef}>
        <div className="relative" id="dvTl" ref={tlRef} style={{ height: HOURS * HP + 64 }}>

          {/* Hour-boundary labels (0:00 … 24:00) */}
          {Array.from({ length: HOURS + 1 }, (_, h) => h).map(h => (
            <span
              key={h}
              className="absolute text-2xs font-mono text-muted-foreground text-right"
              style={{ top: h * HP, left: 0, width: GUTTER - 8, transform: 'translateY(-50%)' }}
            >
              {formatHourBoundary(h, hour12)}
            </span>
          ))}

          {/* Hour cells — one rounded rect per hour, click empty space to create an event */}
          <div className="absolute inset-y-0 right-0 cursor-pointer" style={{ left: GUTTER }} onClick={handleGridClick}>
            {Array.from({ length: HOURS }, (_, h) => h).map(h => (
              <div
                key={h}
                className="absolute inset-x-0 rounded-lg bg-muted/40"
                style={{ top: h * HP + 1, height: HP - 2 }}
              />
            ))}
          </div>

          {/* Current-time indicator */}
          {isToday && (() => {
            const now = new Date()
            const nh  = now.getHours() + now.getMinutes() / 60
            return (
              <div className="now-line" style={{ top: nh * HP }}>
                <div className="now-dot" />
              </div>
            )
          })()}

          {/* Timed event blocks */}
          {cols.flatMap((col, ci) =>
            col.map(({ occ, dh }) => (
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
