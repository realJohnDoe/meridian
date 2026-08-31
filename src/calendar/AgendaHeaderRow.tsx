import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  label: string
  collapsed: boolean
  count: number
  onToggle: () => void
}

// HEADER_H in agendaSections.ts seeds the virtualizer's initial offset from
// this box's height, so keep them in sync if the padding changes.
const baseCls = cn(
  'w-full px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-warning',
  'flex items-center gap-2 bg-background text-left',
  'after:content-[""] after:flex-1 after:h-px after:bg-border',
)

/**
 * The agenda's one remaining full-width header row: the "Overdue" collapse
 * toggle. Per-day headers were replaced by inline gutter badges (see
 * DayBadge/AgendaRow's `badge` prop) — this is the sole survivor since
 * overdue pools many different days into one bucket that has no single day
 * badge to show.
 *
 * It starts **expanded** (calendar/viewState.ts, whose own comment explains
 * why), and `count` is the number of overdue *groups* — one per unfinished
 * series — not the number of occurrences behind them. See overduePool.ts.
 */
function AgendaHeaderRow({ label, collapsed, count, onToggle }: Props) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} className={baseCls}>
      <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')} aria-hidden />
      {label}
      <span className="tabular-nums font-normal opacity-70">{count}</span>
    </button>
  )
}

export default memo(AgendaHeaderRow)
