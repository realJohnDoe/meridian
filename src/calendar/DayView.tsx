import type { Occurrence, EditScope } from '@/types'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import DayPane from './DayPane'
import { useCarousel } from './useCarousel'
import { useCarouselPreview } from './useCarouselPreview'
import { PANE_COUNT } from './snapCarousel'
import { calendarView, setDayPreview } from './viewState'
import { useTimelineScrollSync } from './useTimelineScrollSync'

const CENTER_PANE = Math.floor(PANE_COUNT / 2)

// ── DayView ───────────────────────────────────────────────────
// A horizontal carousel of PANE_COUNT days centered on the current one, driven
// by Embla (see useCarousel and MonthView's header comment for the full seam
// explanation), plus a vertical scroll-sync layer MonthView doesn't need: each
// pane owns its own timeline scroller, and scrolling one mirrors the position
// to its siblings, so the time of day you were looking at carries across a
// swipe instead of resetting to 7am. Embla runs on axis x with the viewport
// set to touch-pan-y, so a vertical drag falls through to a pane's own
// scroller while Embla owns the horizontal axis.
interface Props {
  date: Date
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onNavigateDate?: (date: Date) => void
  /** Called when the user clicks empty timeline space to start a new event at that time. */
  onCreate?: (date: Date, time: string, duration: string) => void
}

export default function DayView({ date: dvDate, onOpen, onNavigateDate, onCreate }: Props) {
  const { onPreview, onRecentered } = useCarouselPreview({
    get: () => calendarView.getState().dayPreview,
    set: setDayPreview,
  })

  const { emblaRef, paneKeys } = useCarousel({
    unitKey: fmtISO(dvDate),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtISO(addDays(dvDate, offset)),
    onCommit: key => onNavigateDate?.(parseDateKey(key)),
    onPreview,
    onRecentered,
  })

  // Vertical scroll position syncs across days (scroll to 6pm, swipe, still
  // at 6pm) — see useTimelineScrollSync.
  const { registerScroller, handleVerticalScroll, getInitialScrollTop } = useTimelineScrollSync()

  return (
    // Embla viewport → container → panes. touch-pan-y hands vertical drags to
    // the browser (each pane's own timeline scroller) while Embla owns the
    // horizontal axis.
    <div ref={emblaRef} className="flex-1 overflow-hidden touch-pan-y">
      <div className="flex h-full">
        {paneKeys.map((key, i) => (
          <div
            key={key}
            className="flex-[0_0_100%] min-w-0 min-h-0 overflow-hidden flex flex-col"
            inert={i === CENTER_PANE ? undefined : true}
          >
            <DayPane
              dateKey={key}
              onOpen={onOpen}
              onCreate={onCreate}
              registerScroller={registerScroller}
              onVerticalScroll={handleVerticalScroll}
              getInitialScrollTop={getInitialScrollTop}
              live={i === CENTER_PANE}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function parseDateKey(key: string): Date {
  const [y = NaN, m = NaN, d = NaN] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
