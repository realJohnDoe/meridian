import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Shared between DayPane and WeekPane's all-day strips: both cap the
// always-visible portion at this many rows/items and fold the rest behind
// this same expand/collapse toggle (paired with the `.dv-adoverflow` CSS
// animation class in index.css).
export const ALL_DAY_THRESHOLD = 3

interface Props {
  hiddenCount: number
  expanded: boolean
  onToggle: () => void
}

export function AllDayOverflowToggle({ hiddenCount, expanded, onToggle }: Props) {
  if (hiddenCount <= 0) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 py-0 text-xs text-muted-foreground hover:text-secondary-foreground gap-1 self-start"
      onClick={onToggle}
    >
      {expanded
        ? <><ChevronUp size={11} />Show less</>
        : <><ChevronDown size={11} />{hiddenCount} more</>}
    </Button>
  )
}
