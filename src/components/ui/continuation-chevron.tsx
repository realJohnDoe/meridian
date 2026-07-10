import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ContinuationChevronProps {
  /** Which edge of the row the occurrence continues past. */
  side: 'left' | 'right'
  className?: string
}

const SIDE_ICON = {
  right: ChevronRight,
  left:  ChevronLeft,
}

/**
 * Small chevron marking that a multiday occurrence's row continues past
 * this edge (out of the visible week row / day). Absolutely positioned —
 * the parent needs `relative` and enough end padding (>=14px, this icon's
 * 10px footprint plus a couple px of clearance) to keep it clear of the
 * truncated title.
 *
 * Hidden below `sm`: at the compact mobile row width there isn't room for
 * both the chevron and the title, and the chevron ends up overlapping text
 * instead of just clipping it.
 */
export function ContinuationChevron({ side, className }: ContinuationChevronProps) {
  const Icon = SIDE_ICON[side]
  return (
    <Icon
      aria-hidden
      size={10}
      strokeWidth={2.5}
      className={cn(
        'hidden sm:block absolute top-1/2 -translate-y-1/2 pointer-events-none',
        side === 'right' ? 'right-1' : 'left-1',
        className,
      )}
    />
  )
}
