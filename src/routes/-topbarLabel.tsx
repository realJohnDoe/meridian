import { cn } from '@/lib/cn'

// Picked so a typical no-year long date ("Wednesday, August 12") still fits above
// it, and a squeeze below it (e.g. an active participant-filter pill eating width)
// swaps to the abbreviated form ("Wed, Aug 12") instead of ellipsizing the long one
// into "Wednesda…". A container query, not JS measurement — same approach as the
// DayPane event-badge width gates. These must stay literal class strings —
// Tailwind only generates what it can see in the source.
const SHOW_LONG = '@min-[190px]:block'
const HIDE_SHORT = '@min-[190px]:hidden'

// Shared by the agenda/backlog/notes label and both PagedTopbar variants (day,
// month): swaps between a full label and an abbreviated one purely by the space
// actually available, rather than truncating the full one into an ellipsis.
export function TopbarLabel({ long, short, className }: { long: string; short: string; className?: string }) {
  return (
    <div className={cn('@container min-w-0 overflow-hidden', className)}>
      <span className={cn('hidden whitespace-nowrap overflow-hidden text-ellipsis', SHOW_LONG)}>{long}</span>
      <span className={cn('block whitespace-nowrap overflow-hidden text-ellipsis', HIDE_SHORT)}>{short}</span>
    </div>
  )
}
