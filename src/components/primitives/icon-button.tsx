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
 *
 * `variant` picks the visual chrome:
 *   'plain' (default) — no baked-in look; caller supplies size/hover via className.
 *   'ghost'            — the topbar/search chrome look: a 40px circle that fills
 *                        with `hover:bg-accent` on hover (mirrors what call sites
 *                        used to hand-assemble from `Button variant="ghost"
 *                        size="icon"` plus a manual `rounded-full`).
 */
import * as React from 'react'
import { cn } from '@/lib/cn'

interface IconButtonProps extends React.ComponentProps<'button'> {
  /** Accessible name, rendered as `aria-label`. */
  label: string
  hit?: 'expand' | 'pad'
  variant?: 'plain' | 'ghost'
}

// `hit`/`variant`/etc. take their defaults via `??` in the body rather than
// as destructured-parameter defaults: that shape (an AssignmentPattern
// inside a destructured parameter) makes babel-plugin-react-compiler bail
// out of optimizing this whole component, silently — no build or lint
// error, just no memoization. See OccurrenceCard.tsx for the full rationale.
function IconButton(props: IconButtonProps) {
  const { label, hit: hitProp, variant: variantProp, className, type, children, ...rest } = props
  const hit = hitProp ?? 'expand'
  const variant = variantProp ?? 'plain'
  return (
    <button
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
        variant === 'ghost' && 'h-10 w-10 rounded-full hover:bg-accent hover:text-accent-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export { IconButton }
