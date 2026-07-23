import { useMemo, useEffect, useLayoutEffect, useRef, useState, useCallback, type MouseEvent } from 'react'
import { startOfDay } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { multidayDisplayTitle, fmtT, parseDateString, parseDurationDays } from '@/model'
import { sameDay, addDays, formatDurationChip, fmtDuration } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { dvBlockVariants, occPillRounded } from '@/components/ui/occurrence-variants'
import { ContinuationChevron, CONTINUES_PADDING_ALWAYS } from '@/components/ui/continuation-chevron'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday, useFilteredOccs } from '@/hooks'
import { computeColumns } from './computeColumns'

// Layout constants below feed JS pixel math (scrollTo, pointer-offset calcs
// for click-to-create) that must run synchronously, so they're plain numbers
// rather than Tailwind classes/vars. Each is still snapped to a Tailwind
// step for consistency with the rest of the app (see index.css §4).
// HP/TOP_PAD/DEFAULT_SCROLL_HOUR are exported: DayView needs them to compute
// the carousel's shared initial vertical scroll offset.
const HOURS = 24                     // hours shown on the timeline
export const HP = 56                 // px per hour (timeline scale, not a spacing gap)
const GUTTER = 64              // px reserved for the left hour-label column — Tailwind `16` step
const RIGHT_PAD = 8            // px breathing room to the right edge of the screen — `2` step
const COL_GAP = 6              // px gap between simultaneous (colliding) event columns — `1.5` step
export const TOP_PAD = 8             // px headroom above 0:00 so its label isn't clipped — `2` step
const BOTTOM_PAD = 8           // px breathing room below 24:00 — `2` step
export const DEFAULT_SCROLL_HOUR = 7 // hour scrolled into view on mount
const CREATE_SNAP_MIN = 15     // minutes new events snap to when created via click
const DEFAULT_CREATE_DURATION = '1h'
// Badges take a second row, so they only render on blocks with an hour of
// height to spare — a 45-min slot is ~38px, which the title alone fills.
const EVENT_BADGE_MIN_HOURS = 1
// …and only on blocks wide enough for the chips to sit on one line, since
// colliding events narrow the columns and the title (the more important bit)
// should win the space. Two gates because the two chip sets are wildly
// different lengths: fmtDuration spells its length out in full, so a duration
// chip reads "until 3:15 PM (5 hours, 30 minutes)" (~36ch), while a lone start
// time is ~8ch — one threshold sized for the former would needlessly strip the
// latter off perfectly roomy blocks. Enforced as container queries against the
// block itself (see the `@container` marker on SurfaceButton below), so no JS
// measurement is involved. These must stay literal class strings — Tailwind
// only generates what it can see in the source.
const BADGE_WIDTH_GATE = '@max-[280px]:hidden'      // start time + duration chip
const TIME_ONLY_WIDTH_GATE = '@max-[96px]:hidden'   // start-time chip alone
// Ghost pill for the time/duration badges: a translucent tint of the block's
// own foreground ink (bg-current), so it contrasts on every block state/theme
// without hardcoding a surface color the way Badge's `tag` variant does.
const eventPillCls =
  'inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-medium leading-none bg-current/20 whitespace-nowrap'

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
        occPillRounded,
        'relative w-full flex items-center px-2 py-0.5 text-xs font-medium truncate mb-0.5',
        continuesLeft && CONTINUES_PADDING_ALWAYS.left,
        continuesRight && CONTINUES_PADDING_ALWAYS.right,
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
  hour12: boolean
  onOpen: (o: Occurrence) => void
}
function EventBlock({ o, dh, colIndex, totalCols, hour12, onOpen }: EventBlockProps) {
  const h   = (o.metadata.jsTime?.getHours() ?? 0) + (o.metadata.jsTime?.getMinutes() ?? 0) / 60
  const top = h * HP + TOP_PAD + 1
  const height = Math.max(dh * HP - 4, 28)

  const colWidth = `(100% - ${GUTTER + RIGHT_PAD}px - ${(totalCols - 1) * COL_GAP}px) / ${totalCols}`
  const left  = `calc(${GUTTER}px + ${colIndex} * ((${colWidth}) + ${COL_GAP}px))`
  const width = `calc(${colWidth})`

  // Same formatting the agenda OccurrenceCard uses: locale-aware start time and
  // a "until HH:MM (1 hour)" duration chip, instead of the old `10:00 · 1h` line.
  const timeLabel = fmtT(o.time, hour12)
  const durationLabel = o.metadata.duration
    ? (o.time
        ? formatDurationChip(o.metadata.duration, { date: o.date, time: o.time }, hour12)
        : fmtDuration(o.metadata.duration))
    : null

  const showBadges = dh >= EVENT_BADGE_MIN_HOURS
  const badgeWidthGate = durationLabel ? BADGE_WIDTH_GATE : TIME_ONLY_WIDTH_GATE
  const ariaLabel = [o.metadata.title, timeLabel, o.metadata.duration].filter(Boolean).join(', ')

  return (
    <SurfaceButton
      className={cn(
        dvBlockVariants({ state: occState(o) }),
        // gap-1 both matches the title/meta spacing OccurrenceCard uses and
        // overrides the gap-2 Button's base classes apply — in this flex-col
        // that gap lands between the title and the badge row, and its 8px is
        // what pushed a 1h block's content (8+16+8+14+8 = 54px) past the 52px
        // it has to render in. At gap-1 that comes to 50px and fits.
        '@container absolute flex flex-col items-start gap-1 rounded-md px-2 text-xs font-medium overflow-hidden transition-colors',
        // Sub-hour blocks bottom out at a 28px floor, which py-2 would overflow
        // on the title's 16px line box alone (8+16+8), clipping its descenders.
        showBadges ? 'py-2' : 'py-1',
      )}
      style={{ top, height, left, width }}
      onClick={() => onOpen(o)}
      aria-label={ariaLabel}
    >
      <div className="w-full shrink-0 font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
        {o.metadata.title}
      </div>
      {showBadges && (
        <div className={cn('flex flex-wrap gap-1', badgeWidthGate)}>
          {timeLabel && <span className={eventPillCls}>{timeLabel}</span>}
          {durationLabel && <span className={eventPillCls}>{durationLabel}</span>}
        </div>
      )}
    </SurfaceButton>
  )
}

// ── DayPane ───────────────────────────────────────────────────
// One pane of the day carousel — self-contained so React can key panes by
// date string and preserve/discard instances independently as the carousel
// scrolls, mirroring MonthGrid. Owns its own store subscriptions so an
// unrelated store touch only re-renders the panes that actually read the
// changed data, and its own vertical scroller — see DayView for how scroll
// position is mirrored across panes so it carries over a swipe.
interface Props {
  dateKey: string // YYYY-MM-DD
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  /** Called when the user clicks empty timeline space to start a new event at that time. */
  onCreate?: (date: Date, time: string, duration: string) => void
  registerScroller: (key: string, el: HTMLDivElement | null) => void
  onVerticalScroll: (key: string, scrollTop: number) => void
  getInitialScrollTop: () => number
}

export default function DayPane({ dateKey, onOpen, onCreate, registerScroller, onVerticalScroll, getInitialScrollTop }: Props) {
  const dvDate = useMemo(() => {
    const [y, m, d] = dateKey.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [dateKey])

  const today  = useToday()
  const items  = useStore(s => s.items)
  const roots  = useStore(s => s.roots)
  const hour12 = useStore(s => s.localePrefs.hour12)

  const dvFrom = startOfDay(dvDate)
  const dvTo   = new Date(dvDate); dvTo.setHours(23, 59, 59)
  const dvOccs = useFilteredOccs(useExpandWithMultiday(items, roots, dvFrom, dvTo))

  const { allDay, cols } = useMemo(() => {
    const sorted = sortOccs(dvOccs)
    const allDay = sorted.filter(o => !fmtT(o.time))
    const timed  = sorted.filter(o =>  !!fmtT(o.time))
    return { allDay, cols: computeColumns(timed) }  // cols: LayoutEvent[][]
  }, [dvOccs])

  const scRef = useRef<HTMLDivElement | null>(null)
  const setScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scRef.current = el
    registerScroller(dateKey, el)
  }, [dateKey, registerScroller])

  // Seeds this pane's scroll position from the carousel's shared vertical
  // offset (7am by default, or wherever the user last scrolled) instead of
  // always resetting to 7am — this is what makes the position carry across a
  // swipe: a pane sliding in from off-screen already starts here, and a pane
  // reused via keyed reconciliation just keeps its own scrollTop untouched.
  // Runs before paint so there's no visible jump, replacing the old fixed
  // 50ms-then-scrollTo timer (which only ever ran once per date, always
  // resetting to 7am — the deliberate behaviour change here is that scroll
  // position now persists across day navigation instead).
  useLayoutEffect(() => {
    const el = scRef.current
    if (!el) return
    el.scrollTop = getInitialScrollTop()
    // Mount-only: this pane's scroll position is then owned by the user/the
    // cross-pane mirror in DayView, not by getInitialScrollTop changing later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!sameDay(dvDate, today)) return
    const id = setInterval(() => setNow(new Date()), 60_000)
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
        <div className="px-3 py-1.5 border-b border-input bg-card shrink-0">
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

      {/* Scrollable timeline. pb-5 (20px) matches the search-bar gradient
          height so the 24:00 boundary can scroll clear of the overlaid fade. */}
      <div
        className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] relative pb-5"
        ref={setScrollerRef}
        onScroll={e => onVerticalScroll(dateKey, e.currentTarget.scrollTop)}
      >
        <div className="relative" style={{ height: HOURS * HP + TOP_PAD + BOTTOM_PAD }}>

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
          <div className="absolute inset-y-0" style={{ left: GUTTER, right: RIGHT_PAD }}>
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
            const nh = now.getHours() + now.getMinutes() / 60
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
                hour12={hour12}
                onOpen={onOpen}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}
