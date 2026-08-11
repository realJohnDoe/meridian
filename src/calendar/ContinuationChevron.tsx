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
 * this edge (out of the visible week row / day). Muted (70% opacity) so it
 * reads as a subtle continuation cue rather than competing with the title.
 *
 * An ordinary flex child of OccurrencePill's row, not an absolutely
 * positioned overlay: it takes its own 10px of the row and the title
 * truncates against it, so the two can't overlap or clip each other at any
 * width. It used to be absolute, with the pill reserving matching padding on
 * the same side — two numbers kept in sync by hand across three views, and
 * anything the reserve didn't account for (a wider icon, a second chevron, a
 * caller that forgot the padding) put the title straight under the chevron.
 *
 * `shrink-0` is what keeps a long title from squeezing it to nothing. shadcn
 * Button already applies that to descendant svgs, but OccurrencePill's
 * non-interactive form is a plain div and inherits none of those rules.
 *
 * Always visible when rendered — whether *this* row is worth showing a
 * chevron on at the current width is the caller's call, not this
 * component's. MonthGrid's week cells are too narrow for both the chevron
 * and the title below `sm`, so it hides its usage with
 * `className="hidden sm:block"`; the day and week views have room at every
 * width and render it unqualified. Hiding it by `display` also hands its
 * width back to the title, which the old padding reserve couldn't do.
 */
export function ContinuationChevron({ side, className }: ContinuationChevronProps) {
  const Icon = SIDE_ICON[side]
  return (
    <Icon
      aria-hidden
      size={10}
      strokeWidth={2.5}
      // Inline style, not just the `size` prop: the day/week views' callers
      // are SurfaceButtons (shadcn Button), which ships a global
      // `[&_svg]:size-4` rule. That's a descendant-selector rule (higher CSS
      // specificity than a plain class on the svg itself), so it silently
      // overrides `size` and renders the icon at 16px instead of 10px. Only
      // an inline style reliably wins here.
      style={{ width: 10, height: 10 }}
      className={cn('block shrink-0 opacity-70', className)}
    />
  )
}
