/**
 * IconButton — an icon-only button with a guaranteed touch target.
 *
 * Icon glyphs are ~13–18px, well under the 24px WCAG 2.5.8 (AA) floor and the
 * 44px thumb-friendly target. This wrapper decouples the hit area from the
 * visual size so dense layouts keep their look while staying tappable, and it
 * requires an accessible `label` (icon-only buttons have no text node).
 *
 * `hit` picks the strategy:
 *   'expand' (default) — an invisible, centered 44px ::before grows the hit
 *                        area without affecting layout or the icon's size.
 *                        Use for buttons that stand alone.
 *   'pad'              — real padding that clears the 24px AA floor. Use for
 *                        buttons clustered side-by-side, where overlapping 44px
 *                        zones would cause mis-taps.
 */
import * as React from 'react'
import { cn } from '@/lib/cn'

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, rendered as `aria-label`. */
  label: string
  hit?: 'expand' | 'pad'
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, hit = 'expand', className, type, children, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center touch-manipulation',
        'rounded-sm transition-colors disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        hit === 'expand'
          // Centered 44px hit zone, size-independent of the icon it wraps.
          ? "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
          : 'p-1.5',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = 'IconButton'

export { IconButton }
