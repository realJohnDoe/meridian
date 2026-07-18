import { useCallback, useRef } from 'react'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import DayPane, { HP, TOP_PAD, DEFAULT_SCROLL_HOUR } from './DayPane'
import { useSnapCarousel } from './useSnapCarousel'
import { PANE_COUNT } from './snapCarousel'

const CENTER_PANE = Math.floor(PANE_COUNT / 2)

// ── DayView ───────────────────────────────────────────────────
// A horizontal scroll-snap carousel of PANE_COUNT days centered on the
// current one — the same mechanism as MonthView's carousel (see
// useSnapCarousel and MonthView's header comment for the full seam
// explanation), plus a vertical scroll-sync layer MonthView doesn't need:
// each pane owns its own timeline scroller, and scrolling one mirrors the
// position to its siblings, so the time of day you were looking at carries
// across a swipe instead of resetting to 7am.
interface Props {
  date: Date
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onNavigateDate?: (date: Date) => void
  /** Called when the user clicks empty timeline space to start a new event at that time. */
  onCreate?: (date: Date, time: string, duration: string) => void
}

export default function DayView({ date: dvDate, onOpen, onNavigateDate, onCreate }: Props) {
  const { trackRef, paneKeys } = useSnapCarousel({
    unitKey: fmtISO(dvDate),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtISO(addDays(dvDate, offset)),
    onCommit: key => onNavigateDate?.(parseDateKey(key)),
    onPreview: key => useStore.setState({ dayPreview: key }),
    // The route is authoritative again once the date has actually committed,
    // so clear any touchend preview here — mirrors MonthView's monthPreview.
    onRecentered: () => {
      if (useStore.getState().dayPreview !== null) useStore.setState({ dayPreview: null })
    },
  })

  // Vertical scroll position syncs across days (scroll to 6pm, swipe, still
  // at 6pm): panes register their scroller here, and any pane's scroll
  // mirrors to its siblings, guarded against feedback the same way TimeWheels
  // guards its own scrollTop write. A pane preserved across a swipe (keyed
  // reconciliation — see useSnapCarousel) simply keeps its own scrollTop
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
    <div
      ref={trackRef}
      className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain"
      style={{ scrollbarWidth: 'none' }}
    >
      {paneKeys.map((key, i) => (
        <div
          key={key}
          className="shrink-0 basis-full snap-center min-h-0 overflow-hidden flex flex-col"
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
