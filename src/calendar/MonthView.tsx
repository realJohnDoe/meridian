import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { fmtMonth, parseMonth, weekStartsOn } from '@/model'
import MonthGrid, { CELL_CLASS, BADGE_CLASS, OCC_LIST_CLASS } from './MonthGrid'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import { useCarousel } from './useCarousel'
import { PANE_COUNT } from './snapCarousel'
import { occPillRounded } from '@/components/ui/occurrence-variants'

// Fallback for the occurrence-list start offset until it's measured (cell top padding
// 3px + badge h-5 20px + badge mb-px 1px + the 8px flex gap inherited from Button).
const BAR_TOP_FALLBACK = 32
const CENTER_PANE = Math.floor(PANE_COUNT / 2)

// ── MonthView ─────────────────────────────────────────────────
// A horizontal carousel of PANE_COUNT months centered on the current one,
// driven by Embla (see useCarousel). The route param `month` is the source of
// truth; useCarousel commits a navigation once a swipe settles and recenters
// the pane window (pre-paint) whenever `month` changes, so nothing visibly
// jumps. See MonthGrid for the per-pane rendering — it's kept separate so
// React can key panes by month string, which is load-bearing: Embla is
// reInit-ed on each commit and the keyed panes preserve the two instances
// that survive the shift (only one new month is expanded per swipe).
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

  const { emblaRef, paneKeys } = useCarousel({
    unitKey: fmtMonth(month),
    paneCount: PANE_COUNT,
    unitAt: offset => fmtMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1)),
    onCommit: key => onNavigateMonth(parseMonth(key)),
    onPreview: key => useStore.setState({ monthPreview: key }),
    // The route is authoritative again once `month` has actually committed,
    // so clear any preview here — otherwise a stale preview could linger past
    // a commit that resolved to a different month than predicted.
    onRecentered: () => {
      if (useStore.getState().monthPreview !== null) useStore.setState({ monthPreview: null })
    },
  })

  // The Embla viewport also serves as the gridH measurement target, so its node
  // is captured alongside Embla's own ref via this merged callback.
  const viewportNodeRef = useRef<HTMLElement | null>(null)
  const setViewport = useCallback((node: HTMLElement | null) => {
    viewportNodeRef.current = node
    emblaRef(node)
  }, [emblaRef])

  const rowSentinelRef = useRef<HTMLDivElement>(null)
  const chromeSentinelRef = useRef<HTMLButtonElement>(null)
  const occListRef = useRef<HTMLDivElement>(null)

  const [rowH, setRowH] = useState(0)
  const [gridH, setGridH] = useState(0)
  const [barTop, setBarTop] = useState(BAR_TOP_FALLBACK)

  // Measures rowH/barTop (from the invisible replica sentinels) and gridH
  // (from the Embla viewport) once; all are month-independent, so a single
  // shared ResizeObserver feeds every pane rather than each measuring its own.
  useEffect(() => {
    const viewportEl = viewportNodeRef.current
    const rowEl = rowSentinelRef.current
    if (!viewportEl || !rowEl) return

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
      setGridH(viewportEl.clientHeight)
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(viewportEl)
    ro.observe(rowEl)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden pb-5">
      <div className="grid grid-cols-7 px-1 shrink-0 pt-2">
        {weekdayLabels.map(d => <div key={d} className="text-center text-2xs font-semibold tracking-[.06em] uppercase text-muted-foreground py-0.75">{d}</div>)}
      </div>

      <div
        ref={rowSentinelRef}
        aria-hidden
        className={cn('invisible absolute pointer-events-none flex items-center px-0.5 sm:px-1.5 py-px text-3xs sm:text-xs font-medium', occPillRounded)}
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
        {/* Embla viewport → container → panes. touch-pan-y lets a vertical drag
            fall through (harmless here — no vertical scroll — but consistent
            with DayView); Embla owns the horizontal axis. */}
        <div ref={setViewport} className="flex-1 overflow-hidden touch-pan-y">
          <div className="flex h-full">
            {paneKeys.map((key, i) => (
              <div
                key={key}
                className="flex-[0_0_100%] min-w-0 overflow-hidden px-1 flex flex-col"
                inert={i === CENTER_PANE ? undefined : true}
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
    </div>
  )
}
