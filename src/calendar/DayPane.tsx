import { useMemo, useState } from 'react'
import { startOfDay } from 'date-fns'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import type { Occurrence, EditScope } from '@/types'
import { multidayDisplayTitle, fmtT, parseDateString, parseDurationDays, dayRange } from '@/model'
import { sameDay, addDays } from '@/format'
import { sortOccs } from './occSort'
import { occState } from '@/occView'
import { OccurrencePill } from './OccurrencePill'
import { AllDayOverflowToggle } from './AllDayOverflowToggle'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useToday } from '@/hooks'
import { useFilteredOccs } from './useCalendarFilter'
import { useNow } from './useNow'
import { computeColumns } from './computeColumns'
import { TimedBlock } from './TimedBlock'
import { DayBadge } from './DayBadge'
import { GUTTER, RIGHT_PAD } from './timelineGeometry'
import { TimelineScroller, HourCells, NowLine } from './timelineScaffold'
import { EMPTY_EXPANSION_WINDOW } from './deferredExpansionWindow'
import { useReadyAfterMount } from './useReadyAfterMount'

// Google Calendar's day view always keeps 2 all-day rows visible (even when
// empty) and only switches to a "+N" label once a 3rd item shows up — a
// lower, DayPane-only threshold than WeekPane's shared ALL_DAY_THRESHOLD.
const ALL_DAY_VISIBLE_ROWS = 2

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
      key={`${o.entryKey}-${o.date}-${i}`}
      state={occState(o)}
      title={multidayDisplayTitle(o, dvMidnight) ?? o.metadata.title}
      onClick={() => onOpen(o)}
      continuesLeft={!!startD && startD < dvMidnight}
      continuesRight={!!endD && endD > dvMidnight}
      className="w-full px-0.5 sm:px-1.5 py-0.5 text-xs mb-0.5"
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

  // Every pane here is a fresh mount (keyed by dateKey at DayView's own
  // wrapping div — see useCarousel), so this is `false` for exactly the
  // pane's first commit. While it is, the occurrence expansion below
  // requests a cheap, reliably-empty window instead of this pane's real one
  // — real occurrence data (and the layout work it drives) fills in on a
  // follow-up low-priority render instead of landing in the same commit that
  // mounts this pane, which is what stalls whatever brought it on screen (a
  // swipe settling, a big external jump like the mini-calendar's own
  // quick-nav, or a burst of swipes landing faster than the carousel's
  // PANE_COUNT buffer can keep pre-rendered). See useReadyAfterMount.
  const ready = useReadyAfterMount()
  const { from: dvFrom, to: dvTo } = ready ? dayRange(dvDate, dvDate) : EMPTY_EXPANSION_WINDOW
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

  const isToday   = sameDay(dvDate, today)

  const dvMidnight = startOfDay(dvDate)

  const [allDayExpanded, setAllDayExpanded] = useState(false)
  // Unlike WeekPane's shared ALL_DAY_THRESHOLD, the day view always reserves
  // at least ALL_DAY_VISIBLE_ROWS of height for all-day content (matching
  // Google Calendar's fixed two-row day-view strip), but a bare 3rd item
  // still gets its own row rather than folding behind "+N" — only the 4th+
  // item does, leaving room for the label on that row instead.
  const allDayOverflowing = allDay.length > ALL_DAY_VISIBLE_ROWS + 1
  const shownAllDayCount = allDayOverflowing ? ALL_DAY_VISIBLE_ROWS : allDay.length
  const hiddenCount = allDay.length - shownAllDayCount

  return (
    <>
      {/* All-day / multiday strip — a fixed-width GUTTER column (matching the
          timeline gutter below) plus a content column, mirroring WeekPane's
          layout. Unlike WeekPane, this strip is unconditionally rendered
          (not just when allDay.length > 0): it doubles as the day view's
          header, carrying the weekday + day-of-month badge in its gutter —
          mirroring the week-number badge in WeekPane's own header row — so
          there's always a "which day is this" indicator even with no
          all-day content. The badge sits above the expand/collapse chevron,
          which stays bottom-aligned right above the border into the hourly
          grid. pr-2 = RIGHT_PAD, so the all-day items share a right edge
          with the timeline's event blocks beneath them. A "+N" label takes
          the last visible line instead of an item once there's overflow
          (see shownAllDayCount above) — a bare 3rd item still gets its own
          row rather than folding, so only 4+ items trigger that; empty
          placeholder rows fill out to ALL_DAY_VISIBLE_ROWS below that, so
          the strip's height never drops under a fixed two-row minimum. */}
      <div className="flex border-b border-input bg-card shrink-0 shadow-md relative z-10">
        <div style={{ width: GUTTER }} className="shrink-0 flex flex-col items-center justify-between pb-1.5">
          <DayBadge date={dvDate} isToday={isToday} className="pt-1" />
          <AllDayOverflowToggle
            hiddenCount={hiddenCount}
            expanded={allDayExpanded}
            onToggle={() => setAllDayExpanded(v => !v)}
            className="h-5 w-full p-0"
          />
        </div>
        <div className="flex-1 min-w-0 pr-2 py-1.5">
          {/* Always-visible first N items (capped at ALL_DAY_VISIBLE_ROWS once overflowing, to make room for the label below) */}
          {allDay.slice(0, shownAllDayCount).map((o, i) => renderAllDayItem(o, i, dvMidnight, onOpen))}

          {/* Empty rows so the strip always reserves at least ALL_DAY_VISIBLE_ROWS of
              height, even with fewer (or zero) items — a bare 3rd item (not overflowing)
              already exceeds that minimum, hence the floor at 0. */}
          {Array.from({ length: Math.max(0, ALL_DAY_VISIBLE_ROWS - shownAllDayCount) }, (_, i) => (
            <div key={`ad-placeholder-${i}`} className="h-5 mb-0.5" aria-hidden />
          ))}

          {hiddenCount > 0 && !allDayExpanded && (
            <button
              type="button"
              onClick={() => setAllDayExpanded(true)}
              className="h-5 flex items-center text-xs text-muted-foreground hover:text-secondary-foreground"
            >
              +{hiddenCount}
            </button>
          )}

          {/* Animated overflow */}
          {hiddenCount > 0 && (
            <div className={cn('dv-adoverflow', allDayExpanded && 'open')}>
              <div>
                {allDay.slice(shownAllDayCount).map((o, i) =>
                  renderAllDayItem(o, shownAllDayCount + i, dvMidnight, onOpen)
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable timeline — the scroller, canvas and hour labels are the
          scaffold WeekPane shares; what differs is only what's positioned
          against the canvas below. */}
      <TimelineScroller
        paneKey={dateKey}
        registerScroller={registerScroller}
        onVerticalScroll={onVerticalScroll}
        getInitialScrollTop={getInitialScrollTop}
        hour12={hour12}
      >
        {/* Hour cells. A single column spanning the whole pane, inset past the
            label gutter — unlike WeekPane, which repeats HourCells once per
            day column. */}
        <div className="absolute inset-y-0" style={{ left: GUTTER, right: RIGHT_PAD }}>
          <HourCells
            date={dvDate}
            hour12={hour12}
            onCreate={onCreate}
            hourAriaLabel={t => `Create event at ${t}`}
          />
        </div>

        {/* Current-time indicator. Hung off the canvas rather than the
            hour-cell container above, so it keeps running the extra RIGHT_PAD
            to the pane's edge (left={GUTTER}, right 0) — WeekPane's is scoped
            to one day column instead and takes the default full span. */}
        {isToday && <NowLine now={now} left={GUTTER} />}

        {/* Timed event blocks. Same gutter/right-pad inset as the hour
            cells above, so TimedBlock's column geometry is relative to
            this container rather than the whole pane — kept as its own
            sibling (not nested inside the hour-cells div above) so DOM/
            paint order is unchanged from before this container existed.
            pointer-events-none so empty timeline space still click-creates
            through to the hour-cell button beneath; TimedBlock opts itself
            back in with pointer-events-auto. */}
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: GUTTER, right: RIGHT_PAD }}>
          {cols.flat().map(({ occ, dh, colIndex, totalCols }) => (
            <TimedBlock
              key={occ.id}
              o={occ}
              dh={dh}
              colIndex={colIndex}
              totalCols={totalCols}
              hour12={hour12}
              onOpen={onOpen}
            />
          ))}
        </div>
      </TimelineScroller>
    </>
  )
}
