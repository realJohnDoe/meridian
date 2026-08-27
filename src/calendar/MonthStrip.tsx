import { useLayoutEffect, useMemo, useRef } from 'react'
import { fmtMonth } from '@/model'
import { cn } from '@/lib/cn'

// Deliberately not virtualized — a few dozen chips is cheap to render
// outright, and a virtualizer would fight the browser's own scroll-snap and
// momentum instead of riding it. The window is rebuilt around `activeMonth`
// on every change (see useMemo below), so paging far enough eventually
// re-centers it rather than growing it without bound.
const MONTHS_BACK = 24
const MONTHS_FORWARD = 36

interface MonthChip {
  key: string // "YYYY-MM"
  date: Date
  year: number
  isYearStart: boolean
}

function buildMonths(anchor: Date): MonthChip[] {
  const chips: MonthChip[] = []
  for (let i = -MONTHS_BACK; i <= MONTHS_FORWARD; i++) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1)
    chips.push({ key: fmtMonth(date), date, year: date.getFullYear(), isYearStart: date.getMonth() === 0 })
  }
  return chips
}

interface Props {
  /**
   * The month currently shown — pass the same value the topbar label itself
   * shows (route month, or the swipe carousel's preview once one is set; see
   * `monthDisplayDate` in _app.tsx), so the strip's active chip and center
   * point track a swipe of the grid below it rather than lagging until the
   * gesture commits.
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
  const months = useMemo(() => buildMonths(activeMonth), [activeKey]) // eslint-disable-line react-hooks/exhaustive-deps -- activeKey fully determines the window; activeMonth's identity is not otherwise significant

  const containerRef = useRef<HTMLDivElement>(null)
  const chipElsRef = useRef<Record<string, HTMLButtonElement | null>>({})
  const hasCenteredRef = useRef(false)

  // Center the active chip: computed from measured geometry rather than
  // scrollIntoView, which would also scroll any ancestor scroller (here,
  // potentially the whole clipped _app shell) rather than just this strip.
  useLayoutEffect(() => {
    const container = containerRef.current
    const chip = chipElsRef.current[activeKey]
    if (!container || !chip) return
    const target = chip.offsetLeft - container.clientWidth / 2 + chip.offsetWidth / 2
    const max = Math.max(0, container.scrollWidth - container.clientWidth)
    const left = Math.min(Math.max(target, 0), max)
    container.scrollTo({ left, behavior: hasCenteredRef.current ? 'smooth' : 'auto' })
    hasCenteredRef.current = true
  }, [activeKey])

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Jump to month"
      className="flex items-center gap-1 overflow-x-auto snap-x snap-mandatory px-3 py-2"
    >
      {months.map(m => (
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
            aria-label={m.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            className={cn(
              'shrink-0 snap-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              m.key === activeKey
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-muted',
            )}
          >
            {m.date.toLocaleDateString(undefined, { month: 'short' })}
          </button>
        </div>
      ))}
    </div>
  )
}
