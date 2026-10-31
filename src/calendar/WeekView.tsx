import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO, weekStartsOn } from '@/model'
import { addDays } from '@/format'
import WeekPane from './WeekPane'
import { useCarousel } from './useCarousel'
import { useCarouselPreview } from './useCarouselPreview'
import { PANE_COUNT } from './snapCarousel'
import { calendarView, setWeekPreview } from './viewState'
import { useTimelineScrollSync } from './useTimelineScrollSync'
import { weekStartFor } from './weekRange'

const CENTER_PANE = Math.floor(PANE_COUNT / 2)

interface Props {
  /** The selected day — the week shown is the one containing it. */
  date: Date
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onNavigateWeek?: (weekStart: Date) => void
  onDayClick: (date: Date) => void
  /** Called when the user clicks empty timeline space to start a new event at that time. */
  onCreate?: (date: Date, time: string, duration: string) => void
}

// ── WeekView ──────────────────────────────────────────────────
// A horizontal carousel of PANE_COUNT weeks centered on the current one — see
// DayView's header comment for the full seam explanation (Embla mechanics,
// vertical scroll-sync via useTimelineScrollSync). `date` may be any day
// within the week; the carousel keys off its normalized week start.
export default function WeekView({ date, onOpen, onNavigateWeek, onDayClick, onCreate }: Props) {
  const localePrefs = useStore(s => s.localePrefs)
  const ws = weekStartsOn(localePrefs)
  const weekStart = weekStartFor(date, ws)

  const { onPreview, onRecentered } = useCarouselPreview({
    get: () => calendarView.getState().weekPreview,
    set: setWeekPreview,
  })

  const { emblaRef, paneKeys } = useCarousel({
    unitKey: fmtISO(weekStart),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtISO(addDays(weekStart, offset * 7)),
    onCommit: key => onNavigateWeek?.(parseDateKey(key)),
    onPreview,
    onRecentered,
  })

  // Vertical scroll position syncs across weeks (scroll to 6pm, swipe, still
  // at 6pm) — see useTimelineScrollSync.
  const { registerScroller, handleVerticalScroll, getInitialScrollTop } = useTimelineScrollSync()

  return (
    <div ref={emblaRef} className="flex-1 overflow-hidden touch-pan-y">
      <div className="flex h-full">
        {paneKeys.map((key, i) => (
          <div
            key={key}
            className="flex-[0_0_100%] min-w-0 min-h-0 overflow-hidden flex flex-col"
            inert={i === CENTER_PANE ? undefined : true}
          >
            <WeekPane
              weekStartKey={key}
              onOpen={onOpen}
              onCreate={onCreate}
              onDayClick={onDayClick}
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
