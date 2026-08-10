import type { CSSProperties } from 'react'
import { SurfaceButton } from '@/components/primitives/surface-button'
import { cn } from '@/lib/cn'
import type { OccState } from '@/occView'
import { dvBlockVariants, occRadius } from '@/components/primitives/occurrence-variants'
import { ContinuationChevron, CONTINUES_PADDING, CONTINUES_PADDING_ALWAYS } from './ContinuationChevron'

interface OccurrencePillProps {
  state: OccState
  title: string
  /** Present -> an interactive SurfaceButton. Absent -> a plain, non-interactive
   * div — for month view's chips/bars, which sit under a pointer-events-none
   * overlay and rely on the day cell itself as the click target. */
  onClick?: () => void
  continuesLeft?: boolean
  continuesRight?: boolean
  /** Chevrons (and their reserved padding) hide below `sm:` — every grid-view
   * caller except DayPane's full-width all-day row, which has room at every
   * width. See ContinuationChevron's own doc comment for the rationale. */
  chevronHiddenOnMobile?: boolean
  style?: CSSProperties
  /** Per-view padding/text-size/spacing — deliberately left to the caller
   * rather than baked into a size variant here; see the views themselves for
   * why each one's numbers differ (row height, available width, …). */
  className?: string
}

/**
 * Shared visual for every colored "pill" occurrence display in the day/week/
 * month grid views — day/week all-day items, week's multiday bars, and
 * month's day-cell chips/bars. Owns the state coloring (dvBlockVariants),
 * the responsive corner radius (occRadius), and the continuation-chevron +
 * title layout that used to be copy-pasted across all three views. Doesn't
 * own padding/text-size/spacing — those differ per view (see `className`).
 */
export function OccurrencePill({
  state, title, onClick, continuesLeft, continuesRight,
  chevronHiddenOnMobile, style, className,
}: OccurrencePillProps) {
  const chevronCls = chevronHiddenOnMobile ? 'hidden sm:block' : undefined
  const pad = chevronHiddenOnMobile ? CONTINUES_PADDING : CONTINUES_PADDING_ALWAYS

  const content = (
    <>
      {continuesLeft && <ContinuationChevron side="left" className={chevronCls} />}
      <span className="truncate min-w-0">{title}</span>
      {continuesRight && <ContinuationChevron side="right" className={chevronCls} />}
    </>
  )

  const cls = cn(
    dvBlockVariants({ state }),
    occRadius,
    'relative flex items-center font-medium overflow-hidden',
    continuesLeft && pad.left,
    continuesRight && pad.right,
    className,
  )

  if (onClick) {
    return (
      <SurfaceButton className={cls} style={style} onClick={onClick} aria-label={title}>
        {content}
      </SurfaceButton>
    )
  }
  return <div className={cls} style={style}>{content}</div>
}
