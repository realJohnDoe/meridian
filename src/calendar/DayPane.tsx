import { useMemo, useLayoutEffect, useRef, useState, useCallback, type MouseEvent } from 'react'
import { startOfDay } from 'date-fns'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { multidayDisplayTitle, fmtT, parseDateString, parseDurationDays } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { occRadius } from '@/components/primitives/occurrence-variants'
import { OccurrencePill } from './OccurrencePill'
import { AllDayOverflowToggle, ALL_DAY_THRESHOLD } from './AllDayOverflowToggle'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday } from '@/hooks'
import { useFilteredOccs } from './useCalendarFilter'
import { useNow } from './useNow'
import { computeColumns } from './computeColumns'
import { EventBlock } from './EventBlock'
import {
  HOURS, HP, GUTTER, RIGHT_PAD, TOP_PAD, BOTTOM_PAD, DEFAULT_CREATE_DURATION,
  formatHourBoundary, snapCreateTime,
} from './timelineGeometry'

// ── Sub-components ────────────────────────────────────────────

// occState(o) here intentionally keeps its default (true wall clock), not the
// pane's clockValue — clockValue freezes at `today` midnight for non-today
// panes (see clockValue's own comment below), which would misclassify a
// cross-midnight timed duration in this pane's own day. sortOccs (below) has
// no such fallback available since it runs inside a memo, so it accepts that
// rare imprecision; painting doesn't need to.
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
    <OccurrencePill
      key={`${o.fileSlug}-${o.date}-${i}`}
      state={occState(o)}
      title={multidayDisplayTitle(o, dvMidnight) ?? o.metadata.title}
      onClick={() => onOpen(o)}
      continuesLeft={!!startD && startD < dvMidnight}
      continuesRight={!!endD && endD > dvMidnight}
      className="w-full px-2 py-0.5 text-xs mb-0.5"
    />
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
    const [y = NaN, m = NaN, d = NaN] = dateKey.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [dateKey])

  const today  = useToday()
  const items  = useStore(s => s.items)
  const roots  = useStore(s => s.roots)
  const hour12 = useStore(s => s.localePrefs.hour12)

  const dvFrom = startOfDay(dvDate)
  const dvTo   = new Date(dvDate); dvTo.setHours(23, 59, 59)
  const dvOccs = useFilteredOccs(useExpandWithMultiday(items, roots, dvFrom, dvTo))

  // Only ticks for the pane showing today — other panes don't need a live
  // clock for the current-time indicator below, and keep whatever value they
  // mounted with for clockValue's sake.
  const now = useNow(60_000, sameDay(dvDate, today))
  // The value sortOccs (below) requires: the live tick for today's pane,
  // otherwise `today`. Safe for sortOccs's own day-granular grouping/ordering
  // in every case except a cross-midnight timed duration in this exact pane's
  // day — see renderAllDayItem's comment for why painting doesn't inherit this
  // same imprecision (it keeps using the true wall clock instead).
  const clockValue = sameDay(dvDate, today) ? now : today

  const { allDay, cols } = useMemo(() => {
    const sorted = sortOccs(dvOccs, clockValue)
    const allDay = sorted.filter(o => !fmtT(o.time))
    const timed  = sorted.filter(o =>  !!fmtT(o.time))
    return { allDay, cols: computeColumns(timed) }  // cols: LayoutEvent[][]
  }, [dvOccs, clockValue])

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
  // Mount-only: this pane's scroll position is then owned by the user/the
  // cross-pane mirror in DayView, not by getInitialScrollTop changing later.
  // Held in a ref rather than declared via an exhaustive-deps suppression —
  // useRef keeps the mount-time value and nothing else, which is the same
  // semantics, and it keeps DayPane eligible for the React Compiler (a single
  // react-hooks suppression anywhere in a component opts the whole component
  // out of compilation).
  const getInitialScrollTopRef = useRef(getInitialScrollTop)
  useLayoutEffect(() => {
    const el = scRef.current
    if (!el) return
    el.scrollTop = getInitialScrollTopRef.current()
  }, [])

  const totalCols = Math.max(cols.length, 1)
  const isToday   = sameDay(dvDate, today)

  const dvMidnight = startOfDay(dvDate)

  const [allDayExpanded, setAllDayExpanded] = useState(false)
  const hiddenCount = allDay.length - ALL_DAY_THRESHOLD

  // minutesWithinHour is 0 for keyboard-triggered activation (Enter/Space on
  // the hour button), since there's no pointer position to derive it from —
  // that lands the new event at the hour boundary, which is a sensible default.
  const createAt = (h: number, minutesWithinHour: number) => {
    onCreate?.(dvDate, snapCreateTime(h, minutesWithinHour), DEFAULT_CREATE_DURATION)
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
      {/* All-day / multiday strip. px-2 = RIGHT_PAD, so the all-day items
          share a right edge with the timeline's event blocks beneath them. */}
      {allDay.length > 0 && (
        <div className="px-2 py-1.5 border-b border-input bg-card shrink-0 shadow-md relative z-10">
          <div className="text-2xs font-semibold tracking-[.07em] uppercase text-muted-foreground mb-1">All day</div>

          {/* Always-visible first N items */}
          {allDay.slice(0, ALL_DAY_THRESHOLD).map((o, i) => renderAllDayItem(o, i, dvMidnight, onOpen))}

          {/* Animated overflow */}
          {hiddenCount > 0 && (
            <div className={cn('dv-adoverflow', allDayExpanded && 'open')}>
              <div>
                {allDay.slice(ALL_DAY_THRESHOLD).map((o, i) =>
                  renderAllDayItem(o, ALL_DAY_THRESHOLD + i, dvMidnight, onOpen)
                )}
              </div>
            </div>
          )}

          {/* Expand / collapse toggle */}
          <AllDayOverflowToggle
            hiddenCount={hiddenCount}
            expanded={allDayExpanded}
            onToggle={() => setAllDayExpanded(v => !v)}
          />
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
                className={cn(occRadius, 'absolute inset-x-0 bg-muted/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
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

          {/* Timed event blocks. Same gutter/right-pad inset as the hour
              cells above, so EventBlock's column geometry is relative to
              this container rather than the whole pane — kept as its own
              sibling (not nested inside the hour-cells div above) so DOM/
              paint order is unchanged from before this container existed.
              pointer-events-none so empty timeline space still click-creates
              through to the hour-cell button beneath; EventBlock opts itself
              back in with pointer-events-auto. */}
          <div className="absolute inset-y-0 pointer-events-none" style={{ left: GUTTER, right: RIGHT_PAD }}>
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
      </div>
    </>
  )
}
