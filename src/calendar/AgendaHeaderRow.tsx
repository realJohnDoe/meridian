import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  label: string
  tone: 'default' | 'today' | 'overdue'
  /** Set on the overdue header, which toggles its section rather than just labelling it. */
  collapsible?: boolean
  collapsed?: boolean
  count?: number
  onToggle?: () => void
}

const toneCls = {
  default: 'text-secondary-foreground',
  today:   'text-primary',
  overdue: 'text-warning',
} as const

// Shared by both shapes so the collapse toggle keeps the exact box the plain
// header has — HEADER_H in agendaSections.ts seeds the virtualizer's initial
// offset from it, and a taller header would put every cold-start scroll a few
// pixels out.
const baseCls = cn(
  'w-full px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase',
  'flex items-center gap-2 bg-background',
  'after:content-[""] after:flex-1 after:h-px after:bg-border',
)

/**
 * A section header in the agenda's flat row list — the day's label ("Today",
 * "Tomorrow", or the long date) or the "Overdue" divider. The label and tone
 * are decided upstream in agendaSections.ts, so this renders exactly what the
 * row descriptor carries.
 *
 * The overdue divider is additionally a collapse toggle. It starts collapsed
 * (calendar/viewState.ts), which is what lets scroll-to-today keep preferring
 * the overdue section without landing the user on an unbounded backlog: the
 * section is one bar until they ask for it. `label` stays exactly "Overdue"
 * and the count rides alongside it, rather than being baked into the string.
 *
 * Both label props are primitives, so React's default shallow memo is already
 * the right comparator — unlike the sections this replaced, whose `items`
 * arrays were rebuilt on every unrelated occurrence change and needed a
 * field-level one. `onToggle` is a module-level function reference (see
 * AgendaView), so it's stable across renders too.
 */
function AgendaHeaderRow({ label, tone, collapsible, collapsed, count, onToggle }: Props) {
  if (!collapsible) {
    return <div className={cn(baseCls, toneCls[tone])}>{label}</div>
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(baseCls, toneCls[tone], 'text-left')}
    >
      <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')} aria-hidden />
      {label}
      {count !== undefined && <span className="tabular-nums font-normal opacity-70">{count}</span>}
    </button>
  )
}

export default memo(AgendaHeaderRow)
