import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { fmtMonth, parseMonth, weekStartsOn } from '@/model'
import MonthGrid, { CELL_CLASS, BADGE_CLASS, OCC_LIST_CLASS } from './MonthGrid'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import { useSnapCarousel } from './useSnapCarousel'

// Fallback for the occurrence-list start offset until it's measured (cell top padding
// 3px + badge h-5 20px + badge mb-px 1px + the 8px flex gap inherited from Button).
const BAR_TOP_FALLBACK = 32

// ── MonthView ─────────────────────────────────────────────────
// A 3-pane horizontal scroll-snap carousel: month-1, month, month+1. The
// route param `month` is the source of truth; useSnapCarousel commits a
// navigation once a swipe settles, and recenters itself (pre-paint) whenever
// `month` changes, so the pixel that was at pane 2 is now at pane 1 and
// nothing visibly jumps. See MonthGrid for the per-pane rendering — it's kept
// separate so React can key panes by month string, which is load-bearing:
// browsers track the *snapped element* across DOM changes, and only a keyed
// pane moves with its month rather than staying pinned to a screen position,
// which is what lets the recenter write agree with the snap engine instead of
// fighting it.
interface Props {
  month: Date
  onNavigateMonth: (d: Date) => void
  onDayClick: (date: Date) => void
}

export default function MonthView({ month, onNavigateMonth, onDayClick }: Props) {
  const localePrefs = useStore(s => s.localePrefs)
  const ws = weekStartsOn(localePrefs) // 0=Sun, 1=Mon, 6=Sat

  // Locale-aware weekday header labels starting from the locale's first day of week.
  // Jan 5 2025 is a Sunday; offset by ws to get each day's label. Shared across
  // panes and month-independent, so it stays a static sibling above the track.
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    const sunday = new Date(2025, 0, 5)
    const d = new Date(sunday)
    d.setDate(5 + (ws + i) % 7)
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  })

  const { trackRef, paneKeys, recenter } = useSnapCarousel({
    unitKey: fmtMonth(month),
    unitAt: idx => fmtMonth(new Date(month.getFullYear(), month.getMonth() + (idx - 1), 1)),
    onCommit: key => onNavigateMonth(parseMonth(key)),
    onPreview: key => useStore.setState({ monthPreview: key }),
    // The route is authoritative again once `month` has actually committed,
    // so clear any touchend preview here — otherwise a stale preview could
    // linger past a commit that resolved to a different month than predicted.
    onRecentered: () => {
      if (useStore.getState().monthPreview !== null) useStore.setState({ monthPreview: null })
    },
  })

  const rowSentinelRef = useRef<HTMLDivElement>(null)
  const chromeSentinelRef = useRef<HTMLButtonElement>(null)
  const occListRef = useRef<HTMLDivElement>(null)

  const [rowH, setRowH] = useState(0)
  const [gridH, setGridH] = useState(0)
  const [barTop, setBarTop] = useState(BAR_TOP_FALLBACK)

  // Measures rowH/barTop (from the invisible replica sentinels) and gridH
  // (from the track itself) once; both are month-independent, so a single
  // shared ResizeObserver serves all three panes instead of each pane running
  // its own. Calls the shared hook's recenter() too — redundant with the
  // hook's own resize-driven recenter on the same track element, but cheap
  // and harmless, and keeps this effect's own resize handling self-contained.
  useEffect(() => {
    const trackEl = trackRef.current
    const rowEl = rowSentinelRef.current
    if (!trackEl || !rowEl) return

    const compute = () => {
      const measuredRowH = rowEl.offsetHeight
      if (measuredRowH) {
        setRowH(measuredRowH)
        const chromeEl = chromeSentinelRef.current
        const occListEl = occListRef.current
        if (chromeEl && occListEl) {
          const offset = occListEl.getBoundingClientRect().top - chromeEl.getBoundingClientRect().top
          if (offset > 0) setBarTop(offset)
        }
      }
      setGridH(trackEl.clientHeight)
      recenter()
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(trackEl)
    ro.observe(rowEl)
    return () => ro.disconnect()
  }, [trackRef, recenter])

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden pb-5">
      <div className="grid grid-cols-7 px-1 shrink-0 pt-2">
        {weekdayLabels.map(d => <div key={d} className="text-center text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground py-0.75">{d}</div>)}
      </div>

      <div
        ref={rowSentinelRef}
        aria-hidden
        className="invisible absolute pointer-events-none flex items-center rounded-xs sm:rounded-sm px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium"
      >
        &nbsp;
      </div>

      {/* Invisible cell replica: measures the offset from the cell top to where
          the occurrence list begins, so the bar overlay aligns with real rows. */}
      <SurfaceButton ref={chromeSentinelRef} aria-hidden tabIndex={-1} className={cn('invisible absolute pointer-events-none', CELL_CLASS)}>
        <span className={BADGE_CLASS}>0</span>
        <div ref={occListRef} className={OCC_LIST_CLASS} />
      </SurfaceButton>

      <div className="flex-1 overflow-hidden pb-1 flex flex-col">
        <div
          ref={trackRef}
          className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain touch-pan-x"
          style={{ scrollbarWidth: 'none' }}
        >
          {paneKeys.map((key, i) => (
            <div
              key={key}
              className="shrink-0 basis-full snap-center min-h-0 overflow-hidden px-1 flex flex-col"
              inert={i === 1 ? undefined : true}
            >
              <MonthGrid
                monthKey={key}
                ws={ws}
                rowH={rowH}
                barTop={barTop}
                gridH={gridH}
                onDayClick={onDayClick}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
