import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtMonth } from '@/model'
import { useToday } from '@/hooks'
import { cn } from '@/lib/cn'

// Deliberately not virtualized — a few dozen chips is cheap to render
// outright, and a virtualizer would fight the browser's own scroll-snap and
// momentum instead of riding it. The window is built once, anchored to
// whichever month is active when the strip first mounts, and never rebuilt
// as `activeMonth` changes afterward. Paging far enough to carry the active
// month outside this window just means no chip reads as active; given the
// size of the window that takes years of paging in one sitting.
const MONTHS_BACK = 24
const MONTHS_FORWARD = 36

interface MonthChip {
  key: string // "YYYY-MM"
  date: Date
  year: number
  isYearStart: boolean
  /** Chip face ("Sep") and its accessible name ("September 2026"). */
  label: string
  ariaLabel: string
}

// Both labels are baked in here rather than formatted in the render below:
// the window is MONTHS_BACK + MONTHS_FORWARD + 1 chips (61 today) and each
// needs two Intl formats, so formatting them per render meant ~122 Intl calls
// every time this strip re-rendered — which, since `activeMonth` tracks the
// mini-grid's swipe preview, is *during* that grid's snap animation. Profiled
// at ~276ms of a frame that was already dropping. The strings depend only on
// `date`, and the window is built once at mount (see the useState below), so
// this is computed once per chip for the life of the panel.
function buildMonths(anchor: Date): MonthChip[] {
  const chips: MonthChip[] = []
  for (let i = -MONTHS_BACK; i <= MONTHS_FORWARD; i++) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1)
    chips.push({
      key: fmtMonth(date),
      date,
      year: date.getFullYear(),
      isYearStart: date.getMonth() === 0,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      ariaLabel: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    })
  }
  return chips
}

interface Props {
  /**
   * The month currently shown — pass the same value the topbar label itself
   * shows (route month, or the swipe carousel's preview once one is set; see
   * `monthDisplayDate` in _app.tsx), so the active chip tracks a swipe of the
   * grid below it rather than lagging until the gesture commits. Only its
   * value at mount time seeds the strip's window and initial scroll position
   * — see the module comment above.
   */
  activeMonth: Date
  onNavigateMonth: (d: Date) => void
}

/**
 * The month view's quick-nav panel: a horizontally scrolling strip of month
 * chips grouped by year, opened from the topbar label (see PagedTopbar /
 * _app.tsx). Tapping a chip jumps the calendar there.
 */
export default function MonthStrip({ activeMonth, onNavigateMonth }: Props) {
  const activeKey = fmtMonth(activeMonth)
  const todayKey = fmtMonth(useToday())
  const [months] = useState(() => buildMonths(activeMonth))

  const containerRef = useRef<HTMLDivElement>(null)
  const chipElsRef = useRef<Record<string, HTMLButtonElement | null>>({})

  // Scrolls the active chip into view exactly once, so opening the strip
  // doesn't strand the user MONTHS_BACK months in the past — computed from
  // measured geometry rather than scrollIntoView, which would also scroll
  // any ancestor scroller (here, potentially the whole clipped _app shell)
  // rather than just this strip. Empty deps: unlike the window above, this
  // genuinely only runs once — a later activeMonth change (paging while the
  // panel stays open) moves the highlight but must not also drag the strip
  // along with it.
  useLayoutEffect(() => {
    const container = containerRef.current
    const chip = chipElsRef.current[activeKey]
    if (!container || !chip) return
    const target = chip.offsetLeft - container.clientWidth / 2 + chip.offsetWidth / 2
    const max = Math.max(0, container.scrollWidth - container.clientWidth)
    const left = Math.min(Math.max(target, 0), max)
    container.scrollTo({ left, behavior: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see comment above
  }, [])

  // Paging while the strip stays open (see the module comment) moves the
  // highlight without recentering — but if that carries the active chip
  // out of view, it needs *some* scroll or it's stranded with no visible
  // affordance to bring it back. Matches Google Calendar's own strip:
  // rather than recentering on every page, it scrolls just enough to land
  // the newly active chip at the near edge — last chip when paging forward
  // past the right edge, first chip when paging backward past the left
  // edge. That's less movement than recentering, and it adds hysteresis: a
  // chip that's still (barely) in view after paging isn't bumped again
  // until it actually falls off.
  const prevActiveKeyRef = useRef(activeKey)
  useEffect(() => {
    if (prevActiveKeyRef.current === activeKey) return
    prevActiveKeyRef.current = activeKey
    const container = containerRef.current
    const chip = chipElsRef.current[activeKey]
    if (!container || !chip) return
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth
    const chipLeft = chip.offsetLeft
    const chipRight = chipLeft + chip.offsetWidth
    let target: number | undefined
    if (chipRight > viewRight) target = chipRight - container.clientWidth
    else if (chipLeft < viewLeft) target = chipLeft
    if (target === undefined) return
    const max = Math.max(0, container.scrollWidth - container.clientWidth)
    container.scrollTo({ left: Math.min(Math.max(target, 0), max), behavior: 'smooth' })
  }, [activeKey])

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Jump to month"
      className="flex items-center gap-1 overflow-x-auto snap-x snap-mandatory px-3 py-2"
    >
      {months.map(m => {
        const isToday = m.key === todayKey
        return (
          <div key={m.key} className="flex shrink-0 items-center gap-1">
            {m.isYearStart && (
              <span className="shrink-0 px-1.5 text-xs font-medium text-muted-foreground" aria-hidden>
                {m.year}
              </span>
            )}
            <button
              ref={el => { chipElsRef.current[m.key] = el }}
              type="button"
              onClick={() => onNavigateMonth(m.date)}
              aria-current={m.key === activeKey ? 'date' : undefined}
              aria-label={m.ariaLabel}
              className={cn(
                'shrink-0 snap-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                // The current real month always reads as primary, even when
                // it isn't the one being viewed; a viewed month that isn't
                // today's gets a primary tint ringed in primary instead, so
                // the two stay visually distinct while the active chip is
                // still easy to pick out of the row (see MiniMonth's matching
                // today/highlight split — the flat `bg-accent` both used to
                // carry all but disappears on the light themes).
                isToday
                  ? 'bg-primary text-primary-foreground'
                  : m.key === activeKey
                    ? 'bg-primary/15 text-foreground ring-2 ring-inset ring-primary'
                    : 'text-foreground hover:bg-muted',
              )}
            >
              {m.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
