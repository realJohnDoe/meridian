import { useCallback, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { occRadius } from '@/components/primitives/occurrence-variants'
import {
  HOURS, HP, GUTTER, TOP_PAD, BOTTOM_PAD, DEFAULT_CREATE_DURATION,
  formatHourBoundary, snapCreateTime,
} from './timelineGeometry'

// The React scaffold DayPane and WeekPane share, in the same relationship
// timelineGeometry.ts already has to both: the *scale* lives there, the
// *chrome drawn at that scale* lives here. Three pieces, deliberately not one:
//
//   TimelineScroller — the scroller, the full-height canvas, the hour labels.
//     Exactly one per pane, identical in both.
//   HourCells        — one column's worth of click-to-create hour buttons.
//     One per pane in the day view; one per day column in the week view.
//   NowLine          — the current-time indicator, positioned by the caller's
//     own container.
//
// The split is by *arity*, which is what actually differs between the panes: a
// day view is one timeline column, a week view is seven. Passing an `isWeek`
// flag to a single component would be the wrong seam — the week view needs the
// column contents repeated inside its own flex row, not a variant of them.
//
// What is NOT here, on purpose: the two all-day strips. They are genuinely
// different components (WeekPane packs multiday bars into lanes across seven
// columns; DayPane keeps a fixed two-row Google-Calendar-style strip that
// doubles as the view's header) and share only the AllDayOverflowToggle they
// already both import.

interface TimelineScrollerProps {
  /** The carousel's key for this pane (a date or week-start string) — what the scroll-sync layer registers it under. */
  paneKey: string
  registerScroller: (key: string, el: HTMLDivElement | null) => void
  onVerticalScroll: (key: string, scrollTop: number) => void
  getInitialScrollTop: () => number
  hour12: boolean
  /** The pane's own timeline body, positioned against the canvas this renders. */
  children: ReactNode
}

/**
 * A pane's vertical timeline scroller: the scroll container, the
 * HOURS-tall canvas every timed thing positions against, and the 0:00…24:00
 * hour-boundary labels in the gutter. The pane fills the rest via `children`,
 * which land inside the canvas (a positioning context), so they can position
 * absolutely against it exactly as they did when the pane owned this markup.
 */
export function TimelineScroller({
  paneKey, registerScroller, onVerticalScroll, getInitialScrollTop, hour12, children,
}: TimelineScrollerProps) {
  const scRef = useRef<HTMLDivElement | null>(null)
  const setScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scRef.current = el
    registerScroller(paneKey, el)
  }, [paneKey, registerScroller])

  // Seeds this pane's scroll position from the carousel's shared vertical
  // offset (7am by default, or wherever the user last scrolled) instead of
  // always resetting to 7am — this is what makes the position carry across a
  // swipe: a pane sliding in from off-screen already starts here, and a pane
  // reused via keyed reconciliation just keeps its own scrollTop untouched.
  // Runs before paint so there's no visible jump, replacing the old fixed
  // 50ms-then-scrollTo timer (which only ever ran once per date, always
  // resetting to 7am — the deliberate behaviour change there is that scroll
  // position now persists across day/week navigation instead).
  // Mount-only: the pane's scroll position is then owned by the user/the
  // cross-pane mirror in DayView/WeekView, not by getInitialScrollTop changing
  // later. Held in a ref rather than declared via an exhaustive-deps
  // suppression — useRef keeps the mount-time value and nothing else, which is
  // the same semantics, and it keeps this component eligible for the React
  // Compiler (a single react-hooks suppression anywhere in a component opts
  // the whole component out of compilation).
  const getInitialScrollTopRef = useRef(getInitialScrollTop)
  useLayoutEffect(() => {
    const el = scRef.current
    if (!el) return
    el.scrollTop = getInitialScrollTopRef.current()
  }, [])

  return (
    // pb-5 (20px) matches the search-bar gradient height so the 24:00
    // boundary can scroll clear of the overlaid fade.
    <div
      className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] relative pb-5"
      ref={setScrollerRef}
      onScroll={e => onVerticalScroll(paneKey, e.currentTarget.scrollTop)}
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

        {children}
      </div>
    </div>
  )
}

interface HourCellsProps {
  /** The day a click in these cells creates into. */
  date: Date
  hour12: boolean
  /** The pane's own onCreate — same signature, forwarded with the snapped time. */
  onCreate?: (date: Date, time: string, duration: string) => void
  /** Builds each button's accessible name from the already-formatted hour boundary — the one thing the two panes word differently. */
  hourAriaLabel: (hourText: string) => string
}

/**
 * One timeline column's hour cells — a button per hour, click/tap or
 * Enter/Space creates an event at that time. Renders a bare fragment: the
 * buttons position absolutely against whichever container the caller puts them
 * in (DayPane's single gutter-inset container, or one week day column), which
 * is the only thing that differs between the two panes.
 */
export function HourCells({ date, hour12, onCreate, hourAriaLabel }: HourCellsProps) {
  // minutesWithinHour is 0 for keyboard-triggered activation (Enter/Space on
  // the hour button), since there's no pointer position to derive it from —
  // that lands the new event at the hour boundary, which is a sensible default.
  const createAt = (h: number, minutesWithinHour: number) => {
    onCreate?.(date, snapCreateTime(h, minutesWithinHour), DEFAULT_CREATE_DURATION)
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
      {Array.from({ length: HOURS }, (_, h) => h).map(h => (
        <button
          key={h}
          type="button"
          className={cn(occRadius, 'absolute inset-x-0 bg-muted/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          style={{ top: h * HP + TOP_PAD + 1, height: HP - 2 }}
          onClick={handleHourClick(h)}
          aria-label={hourAriaLabel(formatHourBoundary(h, hour12))}
        />
      ))}
    </>
  )
}

interface NowLineProps {
  now: Date
  /**
   * Horizontal insets in px within the caller's positioned container. Both
   * default to 0 (span it fully), which is what a week day column wants; the
   * day view passes `left={GUTTER}` because it hangs the line off the pane's
   * whole canvas rather than off its hour-cell container.
   *
   * These are props rather than a `.now-line` default precisely because the
   * two panes want different spans: the CSS class used to hardcode `left:64px`
   * to match GUTTER, which the week view then had to override inline. Keeping
   * the span at the call site keeps that constant in one place (timelineGeometry)
   * instead of mirroring it into a stylesheet that can't see it drift.
   */
  left?: number
  right?: number
}

/** The current-time indicator, at `now`'s position on the timeline. */
export function NowLine(props: NowLineProps) {
  // Defaults read in the body, not destructured in the signature — a default
  // in a destructured parameter makes the React Compiler silently skip
  // memoizing the component (see OccurrenceCard.tsx, and the lint rule that
  // enforces it).
  const left = props.left ?? 0
  const right = props.right ?? 0
  const nh = props.now.getHours() + props.now.getMinutes() / 60
  return (
    <div className="now-line" style={{ top: nh * HP + TOP_PAD, left, right }}>
      <div className="now-dot" />
    </div>
  )
}
