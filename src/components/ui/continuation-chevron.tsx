import { cn } from '@/lib/cn'

interface ContinuationChevronProps {
  /** Which edge of the row the occurrence continues past. */
  side: 'left' | 'right'
  className?: string
}

const SIDE_CLASSES = {
  right: 'right-1 border-t border-r rounded-tr-[1px] rotate-45',
  left:  'left-1 border-b border-l rounded-bl-[1px] rotate-45',
}

/**
 * Small rounded-stroke chevron marking that a multiday occurrence's row
 * continues past this edge (out of the visible week row / day). Absolutely
 * positioned — the parent needs `relative` and enough end padding to keep
 * the chevron clear of the truncated title.
 */
export function ContinuationChevron({ side, className }: ContinuationChevronProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 border-current opacity-90 pointer-events-none',
        SIDE_CLASSES[side],
        className,
      )}
    />
  )
}
