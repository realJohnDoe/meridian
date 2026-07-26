import { memo } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  label: string
  tone: 'default' | 'today' | 'overdue'
}

const toneCls = {
  default: 'text-secondary-foreground',
  today:   'text-primary',
  overdue: 'text-warning',
} as const

/**
 * A section header in the agenda's flat row list — the day's label ("Today",
 * "Tomorrow", or the long date) or the "Overdue" divider. The label and tone
 * are decided upstream in agendaSections.ts, so this renders exactly what the
 * row descriptor carries.
 *
 * Both props are primitives, so React's default shallow memo is already the
 * right comparator — unlike the sections this replaced, whose `items` arrays
 * were rebuilt on every unrelated occurrence change and needed a field-level
 * one.
 */
function AgendaHeaderRow({ label, tone }: Props) {
  return (
    <div className={cn(
      'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase',
      'flex items-center gap-2 bg-background',
      'after:content-[""] after:flex-1 after:h-px after:bg-border',
      toneCls[tone],
    )}>{label}</div>
  )
}

export default memo(AgendaHeaderRow)
