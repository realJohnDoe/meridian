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
 * Padding to reserve on a row that shows a ContinuationChevron on that side
 * — the single source of truth so MonthView bars and the DayView all-day
 * pill can't drift apart. 20px clears the chevron's own ~12px footprint
 * (2px inset + 10px icon) with a deliberate gap to the title.
 */
export const CONTINUES_PADDING = {
  left:  'sm:pl-5',
  right: 'sm:pr-5',
}

/**
 * Small chevron marking that a multiday occurrence's row continues past
 * this edge (out of the visible week row / day). Sits right at the row's
 * edge (2px inset) and muted (70% opacity) so it reads as a subtle
 * continuation cue rather than competing with the title. Absolutely
 * positioned — the parent needs `relative` and CONTINUES_PADDING on the
 * matching side to keep it clear of the title.
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
      // Inline style, not just the `size` prop: DayView's caller is a
      // SurfaceButton (shadcn Button), which ships a global `[&_svg]:size-4`
      // rule. That's a descendant-selector rule (higher CSS specificity than
      // a plain class on the svg itself), so it silently overrides `size`
      // and renders the icon at 16px instead of 10px. Only an inline style
      // reliably wins here.
      style={{ width: 10, height: 10 }}
      className={cn(
        'hidden sm:block absolute top-1/2 -translate-y-1/2 pointer-events-none opacity-70',
        side === 'right' ? 'right-0.5' : 'left-0.5',
        className,
      )}
    />
  )
}
