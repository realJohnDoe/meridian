import type { CSSProperties } from 'react'
import { SurfaceButton } from '@/components/primitives/surface-button'
import { cn } from '@/lib/cn'
import type { OccState } from '@/occView'
import { dvBlockVariants, occRadius } from '@/components/primitives/occurrence-variants'
import { ContinuationChevron } from './ContinuationChevron'

interface OccurrencePillProps {
  state: OccState
  title: string
  /** Present -> an interactive SurfaceButton. Absent -> a plain, non-interactive
   * div — for month view's chips/bars, which sit under a pointer-events-none
   * overlay and rely on the day cell itself as the click target. */
  onClick?: () => void
  continuesLeft?: boolean
  continuesRight?: boolean
  /** Drop the chevrons below `sm:` — MonthGrid's fixed 1/7-width cells, where
   * a chevron would cost a narrow bar most of its title. The day and week
   * views have room at every width and leave this off. See
   * ContinuationChevron's own doc comment for the rationale. */
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
 * the shared corner radius (occRadius), and the continuation-chevron +
 * title layout that used to be copy-pasted across all three views. Doesn't
 * own padding/text-size/spacing — those differ per view (see `className`).
 *
 * Layout is a single flex row — [chevron] title [chevron] — so the chevrons
 * claim their own width and the title truncates against them instead of
 * running underneath. Nothing here is absolutely positioned, so no caller
 * has to reserve padding to keep the two apart.
 *
 * The title span is `flex-1`: it grows to fill whatever width the container
 * doesn't need, so a short title on a wide multiday bar still pushes the
 * right chevron out to the bar's far edge instead of leaving it stranded
 * right after the text. `min-w-0` lets it shrink back below that content
 * width so `truncate` still applies once the title itself is the long side.
 */
export function OccurrencePill({
  state, title, onClick, continuesLeft, continuesRight,
  chevronHiddenOnMobile, style, className,
}: OccurrencePillProps) {
  const chevronCls = chevronHiddenOnMobile ? 'hidden sm:block' : undefined

  const content = (
    <>
      {continuesLeft && <ContinuationChevron side="left" className={chevronCls} />}
      <span className="flex-1 truncate min-w-0">{title}</span>
      {continuesRight && <ContinuationChevron side="right" className={chevronCls} />}
    </>
  )

  const cls = cn(
    dvBlockVariants({ state }),
    occRadius,
    // gap-1 (4px between chevron and title) is also load-bearing as an
    // override: the interactive form below is a shadcn Button, whose base
    // classes carry gap-2 — without this the two forms would space their
    // chevrons differently.
    'flex items-center gap-1 font-medium overflow-hidden',
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
