import { useCallback, useRef } from 'react'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import DayPane, { HP, TOP_PAD, DEFAULT_SCROLL_HOUR } from './DayPane'
import { useCarousel } from './useCarousel'
import { PANE_COUNT } from './snapCarousel'

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
  const { emblaRef, paneKeys } = useCarousel({
    unitKey: fmtISO(dvDate),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtISO(addDays(dvDate, offset)),
    onCommit: key => onNavigateDate?.(parseDateKey(key)),
    onPreview: key => useStore.setState({ dayPreview: key }),
    // The route is authoritative again once the date has actually committed,
    // so clear any preview here — mirrors MonthView's monthPreview.
    onRecentered: () => {
      if (useStore.getState().dayPreview !== null) useStore.setState({ dayPreview: null })
    },
  })

  // Vertical scroll position syncs across days (scroll to 6pm, swipe, still
  // at 6pm): panes register their scroller here, and any pane's scroll
  // mirrors to its siblings, guarded against feedback the same way TimeWheels
  // guards its own scrollTop write. A pane preserved across a swipe (keyed
  // reconciliation — see useCarousel) simply keeps its own scrollTop
  // untouched; a freshly-mounted pane seeds from sharedTopRef (see DayPane's
  // mount effect), so there's nothing to correct on commit either way.
  const scrollersRef = useRef(new Map<string, HTMLDivElement>())
  const sharedTopRef = useRef(DEFAULT_SCROLL_HOUR * HP + TOP_PAD)
  const vSyncingRef = useRef(false)

  const registerScroller = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) scrollersRef.current.set(key, el)
    else scrollersRef.current.delete(key)
  }, [])

  const handleVerticalScroll = useCallback((key: string, scrollTop: number) => {
    if (vSyncingRef.current) return
    sharedTopRef.current = scrollTop
    vSyncingRef.current = true
    mirrorScrollTop(scrollersRef.current, key, scrollTop)
    requestAnimationFrame(() => { vSyncingRef.current = false })
  }, [])

  const getInitialScrollTop = useCallback(() => sharedTopRef.current, [])

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
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Plain helper, deliberately outside the component: writing to a DOM element
// pulled out of a ref-held Map inside a useCallback trips the React
// Compiler's immutability analysis (it treats the element as a frozen "hook
// argument" once it's flowed through registerScroller's callback param) —
// moving the actual mutation into an ordinary function sidesteps that.
function mirrorScrollTop(scrollers: Map<string, HTMLDivElement>, exceptKey: string, scrollTop: number) {
  for (const [k, el] of scrollers) {
    if (k !== exceptKey) el.scrollTop = scrollTop
  }
}
