import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { topbarEdgePadding } from './-topbarEdgePadding'

interface Props {
  /** True when the left edge leads with an icon button — the mobile hamburger, or the entry
   *  editor's back arrow — rather than a plain text label. The right edge always leads with an
   *  icon button (sync, favorite, Today, …) across every view, so that side needs no prop. */
  leftHasButton: boolean
  left: ReactNode
  right: ReactNode
}

/**
 * Shared topbar row for every view (agenda, day/week/month, the entry editor): each renders its
 * own left/right content through this shell rather than reapplying `topbarEdgePadding` itself.
 * That duplication is what let the entry editor's copy drift — it also centered the whole row at
 * the body content's max-width, stranding its buttons far from the screen edge on anything wider
 * than that column. Centering stays scoped to body content; this shell always spans the full
 * header and pins buttons to the true edges, so a future view can't reintroduce the mismatch.
 */
export function TopbarShell({ leftHasButton, left, right }: Props) {
  return (
    <div className={cn('flex flex-1 items-center justify-between gap-2 min-w-0', topbarEdgePadding(leftHasButton, true))}>
      {left}
      {right}
    </div>
  )
}
