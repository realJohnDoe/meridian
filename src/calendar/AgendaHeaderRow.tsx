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
 * The "Overdue" collapse toggle — a full-width header row, like every other
 * day's own AgendaDayHeaderRow, but this one's label is fixed since overdue
 * pools many different days into one bucket that has no single day to badge.
 *
 * It starts collapsed (calendar/viewState.ts), which is what lets
 * scroll-to-today keep preferring the overdue section without landing the
 * user on an unbounded backlog: the section is one bar until they ask for it.
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
