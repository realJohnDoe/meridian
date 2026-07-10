import { cn } from '@/lib/cn'

interface ContinuationChevronProps {
  /** Which edge of the row the occurrence continues past. */
  side: 'left' | 'right'
  className?: string
}

const SIDE_CLASSES = {
  right: 'right-1 border-t-[1.5px] border-r-[1.5px] rounded-tr-[1.5px] rotate-45',
  left:  'left-1 border-b-[1.5px] border-l-[1.5px] rounded-bl-[1.5px] rotate-45',
}

/**
 * Small rounded-stroke chevron marking that a multiday occurrence's row
 * continues past this edge (out of the visible week row / day). Absolutely
 * positioned — the parent needs `relative` and enough end padding to keep
 * the chevron clear of the truncated title. Sized at 8px with an explicit
 * 1.5px stroke (rather than Tailwind's default 1px `border-t`/`border-r`,
 * which renders as a sub-pixel hairline at these row heights and disappears)
 * so it actually reads at a glance next to text-xs/text-3xs titles.
 *
 * Hidden below `sm`: at the compact mobile row width there isn't room for
 * both the chevron and the title, and the chevron ends up overlapping text
 * instead of just clipping it.
 */
export function ContinuationChevron({ side, className }: ContinuationChevronProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'hidden sm:block absolute top-1/2 -translate-y-1/2 w-2 h-2 border-current pointer-events-none',
        SIDE_CLASSES[side],
        className,
      )}
    />
  )
}
