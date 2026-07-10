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
 * this edge (out of the visible week row / day). Sits right at the row's
 * edge (2px inset) and muted (70% opacity) so it reads as a subtle
 * continuation cue rather than competing with the title. Absolutely
 * positioned — the parent needs `relative` and enough end padding
 * (>=12px for the icon's own footprint, plus a deliberate gap to the
 * text — see the sm:pl-5/pr-5 callers) to keep it clear of the title.
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
        'hidden sm:block absolute top-1/2 -translate-y-1/2 pointer-events-none opacity-70',
        side === 'right' ? 'right-0.5' : 'left-0.5',
        className,
      )}
    />
  )
}
