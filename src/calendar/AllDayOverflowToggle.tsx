import { ChevronDown, ChevronUp } from 'lucide-react'
import { IconButton } from '@/components/primitives/icon-button'
import { cn } from '@/lib/cn'

// WeekPane's cap on the always-visible portion of its per-day-column
// all-day strip (rows/items per day) before folding the rest behind this
// same expand/collapse toggle (paired with the `.dv-adoverflow` CSS
// animation class in index.css) — a "+N" label takes the last visible slot
// once a day has more than this many items (see WeekPane's own overflow
// layout). DayPane uses its own lower, unshared threshold
// (ALL_DAY_VISIBLE_ROWS in DayPane.tsx) to keep a fixed two-row strip
// matching Google Calendar's day view, so the two panes are intentionally
// no longer in lockstep on this number — only this toggle component itself
// is shared between them.
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
