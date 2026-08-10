import { ChevronDown, ChevronUp } from 'lucide-react'
import { IconButton } from '@/components/primitives/icon-button'
import { cn } from '@/lib/cn'

// Shared between DayPane and WeekPane's all-day strips: both cap the
// always-visible portion at this many rows/items per day and fold the rest
// behind this same expand/collapse toggle (paired with the `.dv-adoverflow`
// CSS animation class in index.css). When a day has more than this many
// items, its last visible slot is given over to a "+N" label instead (see
// each pane's own overflow layout) rather than an item — one more reason,
// besides ALL_DAY_THRESHOLD itself, that the two panes stay in lockstep.
export const ALL_DAY_THRESHOLD = 3

interface Props {
  hiddenCount: number
  expanded: boolean
  onToggle: () => void
  className?: string
}

// Icon-only — the "how many are hidden" information now lives in each day's
// own "+N" label (DayPane's single line, or WeekPane's per-day-column one),
// so this toggle only needs to say "there's more, expand/collapse it here".
export function AllDayOverflowToggle({ hiddenCount, expanded, onToggle, className }: Props) {
  if (hiddenCount <= 0) return null
  return (
    <IconButton
      variant="plain"
      hit="pad"
      label={expanded ? 'Show fewer events' : 'Show more events'}
      className={cn('text-muted-foreground hover:text-secondary-foreground shrink-0', className)}
      onClick={onToggle}
    >
      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </IconButton>
  )
}
