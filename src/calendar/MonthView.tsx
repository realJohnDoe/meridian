import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { fmtMonth, weekStartsOn } from '@/model'
import MonthGrid, { CELL_CLASS, BADGE_CLASS, OCC_LIST_CLASS } from './MonthGrid'
import { SurfaceButton } from '@/components/ui/surface-button'
import { cn } from '@/lib/cn'
import { snapIndex } from './snapCarousel'

// Fallback for the occurrence-list start offset until it's measured (cell top padding
// 3px + badge h-5 20px + badge mb-px 1px + the 8px flex gap inherited from Button).
const BAR_TOP_FALLBACK = 32

// ── MonthView ─────────────────────────────────────────────────
// A 3-pane horizontal scroll-snap carousel: month-1, month, month+1. The
// route param `month` is the source of truth; the carousel commits a
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

  const monthKeys = useMemo(() => {
    const y = month.getFullYear()
    const m = month.getMonth()
    return [
      fmtMonth(new Date(y, m - 1, 1)),
      fmtMonth(month),
      fmtMonth(new Date(y, m + 1, 1)),
    ]
  }, [month])

  const monthRef = useRef(month)
  useEffect(() => { monthRef.current = month }, [month])
  const onNavigateMonthRef = useRef(onNavigateMonth)
  useEffect(() => { onNavigateMonthRef.current = onNavigateMonth }, [onNavigateMonth])

  const trackRef = useRef<HTMLDivElement>(null)
  const rowSentinelRef = useRef<HTMLDivElement>(null)
  const chromeSentinelRef = useRef<HTMLButtonElement>(null)
  const occListRef = useRef<HTMLDivElement>(null)

  const [rowH, setRowH] = useState(0)
  const [gridH, setGridH] = useState(0)
  const [barTop, setBarTop] = useState(BAR_TOP_FALLBACK)

  const syncingRef = useRef(false)

  // Recenters the track on the current month's pane. Scroll-snap is toggled
  // off for the write (then a reflow is forced before restoring it) so the
  // snap engine doesn't fight the programmatic scrollLeft write; the retry
  // loop covers iOS Safari occasionally dropping a scrollLeft write that
  // lands mid-momentum after a rapid second swipe.
  const recenter = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const paneW = el.getBoundingClientRect().width
    if (!paneW) return
    syncingRef.current = true
    const prevSnap = el.style.scrollSnapType
    el.style.scrollSnapType = 'none'
    el.scrollLeft = paneW
    void el.offsetWidth // force reflow so the write lands before snap is restored
    el.style.scrollSnapType = prevSnap
    let attempts = 0
    const verify = () => {
      const cur = trackRef.current
      if (!cur) { syncingRef.current = false; return }
      const w = cur.getBoundingClientRect().width
      if (w && Math.abs(cur.scrollLeft - w) > 2 && attempts < 3) {
        attempts++
        cur.scrollLeft = w
        requestAnimationFrame(verify)
      } else {
        syncingRef.current = false
      }
    }
    requestAnimationFrame(verify)
  }, [])

  // The seam: recenter synchronously before paint whenever the committed month
  // changes, in the same commit that shifts which month string each pane
  // renders — so the pixel that was at 2×paneW is now at paneW and nothing
  // visibly moves. React runs layout effects before the browser paints, so
  // there's no frame in between where the stale position is visible.
  //
  // The route is authoritative again once `month` has actually committed, so
  // clear any touchend preview here — otherwise a stale preview could linger
  // past a commit that resolved to a different month than predicted.
  useLayoutEffect(() => {
    recenter()
    if (useStore.getState().monthPreview !== null) useStore.setState({ monthPreview: null })
  }, [month, recenter])

  // Measure rowH/barTop (from the invisible replica sentinels) and gridH (from
  // the track itself) once; both are month-independent, so a single shared
  // ResizeObserver serves all three panes instead of each pane running its
  // own. Also re-centers on any track resize (e.g. the desktop sidebar's
  // animated width transition, or a viewport rotation), since a stale paneW
  // is no longer a real snap point and would otherwise let the engine
  // re-snap to an arbitrary neighbour.
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
  }, [recenter])

  // Swipe commit. Gesture-gated rather than purely geometric, so a finger
  // held stationary mid-drag on a snap point doesn't commit a navigation
  // underneath it. `syncing` is checked in the raw scroll handler rather than
  // inside the debounced callback, since the recenter's rAF release can beat
  // a ~100ms debounce to the punch. `scrollend` (where supported) is a more
  // precise trigger than the debounce and is preferred when available; the
  // debounce remains as the fallback (Safari only shipped `scrollend` in 18.2).
  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    let dragging = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const checkSettle = () => {
      if (syncingRef.current || dragging) return
      const w = el.getBoundingClientRect().width
      const idx = snapIndex(el.scrollLeft, w)
      if (idx === null || idx === 1) return
      const cur = monthRef.current
      onNavigateMonthRef.current(new Date(cur.getFullYear(), cur.getMonth() + (idx - 1), 1))
    }

    const scheduleCheck = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(checkSettle, 100)
    }

    // Updates the topbar label to whichever pane the finger is nearest to at
    // release, without waiting for momentum to fully settle — the actual
    // navigation (and any recenter) still waits for checkSettle, so this is
    // purely a label preview. Clamped to the pane range since a rubber-band
    // overshoot at the track's edge could otherwise round outside it.
    const previewLabel = () => {
      const w = el.getBoundingClientRect().width
      if (!w) return
      const idx = Math.max(0, Math.min(2, Math.round(el.scrollLeft / w)))
      const cur = monthRef.current
      const key = fmtMonth(new Date(cur.getFullYear(), cur.getMonth() + (idx - 1), 1))
      useStore.setState({ monthPreview: key })
    }

    const onScroll = () => {
      if (syncingRef.current) return
      scheduleCheck()
    }
    const onTouchStart = () => { dragging = true }
    const onTouchEnd = () => {
      dragging = false
      previewLabel()
      scheduleCheck()
    }
    const onScrollEnd = () => {
      clearTimeout(idleTimer)
      checkSettle()
    }

    const supportsScrollend = 'onscrollend' in window
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    if (supportsScrollend) el.addEventListener('scrollend', onScrollEnd)

    return () => {
      clearTimeout(idleTimer)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      if (supportsScrollend) el.removeEventListener('scrollend', onScrollEnd)
    }
  }, [])

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
          {monthKeys.map((key, i) => (
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
