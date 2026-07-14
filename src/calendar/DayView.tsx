import { useMemo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { startOfDay } from 'date-fns'
import { useHorizontalSwipe } from './useHorizontalSwipe'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '@/store'  // items + roots only
import { Button } from '@/components/ui/button'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { multidayDisplayTitle, fmtT, parseDateString, parseDurationDays } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { dvBlockVariants } from '@/components/ui/occurrence-variants'
import { ContinuationChevron, CONTINUES_PADDING } from '@/components/ui/continuation-chevron'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday, useCalendarFilter } from '@/hooks'
import { computeColumns } from './computeColumns'
const HOURS = 24              // hours shown on the timeline
const HP = 56                 // pixels per hour
const GUTTER = 64              // px reserved for the left hour-label column
const TOP_PAD = 8              // px headroom above 0:00 so its label isn't clipped
const BOTTOM_PAD = 8           // px breathing room below 24:00
const DEFAULT_SCROLL_HOUR = 7  // hour scrolled into view on mount
const CREATE_SNAP_MIN = 15     // minutes new events snap to when created via click
const DEFAULT_CREATE_DURATION = '1h'

/** Localized hour-boundary label (0:00…24:00), matching the Intl formatting fmtT uses for event times. */
function formatHourBoundary(h: number, hour12: boolean): string {
  if (!hour12) return h === HOURS ? '24:00' : `${String(h).padStart(2, '0')}:00`
  const d = new Date(); d.setHours(h % HOURS, 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

// ── Sub-components ────────────────────────────────────────────

interface AllDayItemProps {
  o: Occurrence
  onOpen: (o: Occurrence) => void
  displayTitle?: string
  continuesLeft?: boolean
  continuesRight?: boolean
}
function AllDayItem({ o, onOpen, displayTitle, continuesLeft, continuesRight }: AllDayItemProps) {
  const title = displayTitle ?? o.metadata.title
  return (
    <SurfaceButton
      className={cn(
        dvBlockVariants({ state: occState(o) }),
        'relative w-full flex items-center rounded-xs sm:rounded-sm px-2 py-0.5 text-xs font-medium truncate mb-0.5',
        continuesLeft && CONTINUES_PADDING.left,
        continuesRight && CONTINUES_PADDING.right,
      )}
      onClick={() => onOpen(o)}
      aria-label={title}
    >
      {continuesLeft && <ContinuationChevron side="left" />}
      <span>{title}</span>
      {continuesRight && <ContinuationChevron side="right" />}
    </SurfaceButton>
  )
}

function renderAllDayItem(
  o: Occurrence,
  i: number,
  dvMidnight: Date,
  onOpen: (o: Occurrence) => void,
) {
  const days = parseDurationDays(o.metadata.duration) ?? 1
  const startD = parseDateString(o.date)
  const endD = startD && days > 1 ? addDays(startD, days - 1) : startD
  return (
    <AllDayItem
      key={`${o.fileSlug}-${o.date}-${i}`}
      o={o}
      onOpen={onOpen}
      displayTitle={multidayDisplayTitle(o, dvMidnight)}
      continuesLeft={!!startD && startD < dvMidnight}
      continuesRight={!!endD && endD > dvMidnight}
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
  const top = h * HP + TOP_PAD + 1
  const height = Math.max(dh * HP - 4, 28)

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
      <div className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
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
    const id = setTimeout(() => scRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HP + TOP_PAD, behavior: 'instant' }), 50)
    return () => clearTimeout(id)
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

  // minutesWithinHour is 0 for keyboard-triggered activation (Enter/Space on
  // the hour button), since there's no pointer position to derive it from —
  // that lands the new event at the hour boundary, which is a sensible default.
  const createAt = (h: number, minutesWithinHour: number) => {
    const minutesFromMidnight = h * 60 + minutesWithinHour
    const snapped = Math.round(minutesFromMidnight / CREATE_SNAP_MIN) * CREATE_SNAP_MIN
    const clamped = Math.min(Math.max(snapped, 0), HOURS * 60 - CREATE_SNAP_MIN)
    const time = `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
    onCreate?.(dvDate, time, DEFAULT_CREATE_DURATION)
  }

  const handleHourClick = (h: number) => (e: MouseEvent<HTMLButtonElement>) => {
    // e.detail === 0 for a keyboard-activated click (Enter/Space) — no
    // pointer position to read, so fall back to the top of the hour.
    if (e.detail === 0) { createAt(h, 0); return }
    const rect = e.currentTarget.getBoundingClientRect()
    createAt(h, ((e.clientY - rect.top) / HP) * 60)
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
        <div className="relative" id="dvTl" ref={tlRef} style={{ height: HOURS * HP + TOP_PAD + BOTTOM_PAD }}>

          {/* Hour-boundary labels (0:00 … 24:00) */}
          {Array.from({ length: HOURS + 1 }, (_, h) => h).map(h => (
            <span
              key={h}
              className="absolute text-2xs font-mono text-muted-foreground text-right"
              style={{ top: h * HP + TOP_PAD, left: 0, width: GUTTER - 8, transform: 'translateY(-50%)' }}
            >
              {formatHourBoundary(h, hour12)}
            </span>
          ))}

          {/* Hour cells — one button per hour; click/tap or Enter/Space creates an event there */}
          <div className="absolute inset-y-0 right-0" style={{ left: GUTTER }}>
            {Array.from({ length: HOURS }, (_, h) => h).map(h => (
              <button
                key={h}
                type="button"
                className="absolute inset-x-0 rounded-lg bg-muted/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ top: h * HP + TOP_PAD + 1, height: HP - 2 }}
                onClick={handleHourClick(h)}
                aria-label={`Create event at ${formatHourBoundary(h, hour12)}`}
              />
            ))}
          </div>

          {/* Current-time indicator */}
          {isToday && (() => {
            const now = new Date()
            const nh  = now.getHours() + now.getMinutes() / 60
            return (
              <div className="now-line" style={{ top: nh * HP + TOP_PAD }}>
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
