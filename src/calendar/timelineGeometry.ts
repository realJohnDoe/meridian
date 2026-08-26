import { occRadius } from '@/components/primitives/occurrence-variants'

// Layout constants shared across the calendar views, in two clusters: the
// day-cell chrome below and the day/week timeline scale after it. Each lives
// here rather than inside one of its consumers because a value four sibling
// views read shouldn't be owned by whichever one happened to define it first.

// ── CELL CHROME ──────────────────────────────────
// Cell-chrome class strings, shared between MonthGrid's CalCell and
// MonthView's invisible chrome sentinel so the bar overlay's top offset can
// be MEASURED from a real replica rather than hand-computed — the day-number
// badge, cell padding, or the flex gap can change without silently breaking
// bar↔row alignment (see `barTop`, hoisted and measured once in MonthView
// since it's month-independent). BADGE_CLASS is reused beyond the month grid,
// by WeekPane's week/day-number badges and by DayBadge.
export const CELL_CLASS = `flex-col items-stretch p-[3px_2px_2px] ${occRadius} bg-muted/40 transition-colors overflow-hidden min-h-0 w-full`
export const BADGE_CLASS = 'text-xs font-medium text-dim w-5 h-5 flex items-center justify-center rounded-full shrink-0 mb-px'
export const OCC_LIST_CLASS = 'flex flex-col gap-0.5 flex-1 overflow-hidden'
// BADGE_CLASS's `h-5` as a number, for the callers that need the badge height
// in JS pixel math rather than as a class (WeekPane's all-day row height,
// MonthView's pre-measurement bar offset). Tailwind's `5` step is 1.25rem =
// 20px — keep the two in step if `h-5` above ever changes.
export const BADGE_H = 20

// ── DAY/WEEK TIMELINE ────────────────────────────
// Plain numbers, not Tailwind classes/vars, because they feed JS pixel math
// (scrollTo, pointer-offset calcs for click-to-create) that must run
// synchronously. Each is still snapped to a Tailwind step for consistency
// with the rest of the app (see index.css §4). Shared by DayPane and the week
// view's per-day columns — both timelines are the same scale, just diced into
// a different number of columns.
export const HOURS = 24               // hours shown on the timeline
export const HP = 56                  // px per hour (timeline scale, not a spacing gap)
export const GUTTER = 64              // px reserved for the left hour-label column — Tailwind `16` step
export const RIGHT_PAD = 8            // px breathing room to the right edge of the screen — `2` step
// px right padding for the week view's day-column rows (header, all-day
// strip, hourly grid) — equals their own `gap-0.5` inter-column gap, so the
// last day column sits the same distance from the pane edge as it does from
// its neighbor, keeping all three rows' column edges aligned. Distinct from
// RIGHT_PAD above: DayPane's all-day strip has no per-day columns to line
// up, so it keeps using that arbitrary breathing-room value instead.
export const COL_RIGHT_PAD = 2
const COL_GAP = 6                     // px gap between simultaneous (colliding) event columns — `1.5` step
export const TOP_PAD = 8              // px headroom above 0:00 so its label isn't clipped — `2` step
export const BOTTOM_PAD = 8           // px breathing room below 24:00 — `2` step
export const DEFAULT_SCROLL_HOUR = 7  // hour scrolled into view on mount
const CREATE_SNAP_MIN = 15            // minutes new events snap to when created via click
export const DEFAULT_CREATE_DURATION = '1h'

/** Localized hour-boundary label (0:00…24:00), matching the Intl formatting fmtT uses for event times. */
export function formatHourBoundary(h: number, hour12: boolean): string {
  if (!hour12) return h === HOURS ? '24:00' : `${String(h).padStart(2, '0')}:00`
  const d = new Date(); d.setHours(h % HOURS, 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * Horizontal geometry for one column of a collision-packed group of event
 * blocks (see computeColumns) — column-relative, not pane-relative: it has no
 * GUTTER/RIGHT_PAD term of its own, so the result is meant to be read inside
 * a positioned container that already carries those insets (DayPane's hour-
 * cells container, or a week view's single day column). That's what lets the
 * same geometry serve a 1-column-wide day pane and an N-column-wide week
 * pane without TimedBlock itself knowing which one it's in.
 */
export function blockGeometry(colIndex: number, totalCols: number): { left: string; width: string } {
  const colWidth = `(100% - ${(totalCols - 1) * COL_GAP}px) / ${totalCols}`
  const left = `calc(${colIndex} * ((${colWidth}) + ${COL_GAP}px))`
  const width = `calc(${colWidth})`
  return { left, width }
}

/**
 * Snaps a click/tap position within an hour cell to the nearest
 * CREATE_SNAP_MIN-minute mark, clamped so a new event can't be created
 * starting past the last valid slot of the day. Returns an "HH:MM" string.
 */
export function snapCreateTime(h: number, minutesWithinHour: number): string {
  const minutesFromMidnight = h * 60 + minutesWithinHour
  const snapped = Math.round(minutesFromMidnight / CREATE_SNAP_MIN) * CREATE_SNAP_MIN
  const clamped = Math.min(Math.max(snapped, 0), HOURS * 60 - CREATE_SNAP_MIN)
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}
