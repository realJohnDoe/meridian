import { Menu, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/primitives/icon-button'
import { TopbarLabel } from './-topbarLabel'
import { cn } from '@/lib/cn'

// Shared by the day and month topbar variants — both are a mobile menu
// button, an ellipsized label, and prev/next chevrons, differing only in
// the label and the navigation targets. The chevrons are desktop-only real
// estate: on the same narrow screens where isMobile shows the hamburger menu,
// they'd crowd the label for marginal benefit over the existing swipe-to-page
// carousel (see DayView/MonthView), so they're dropped there instead.
export function PagedTopbar({
  isMobile,
  openSidebar,
  label,
  shortLabel,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  expanded,
  onToggle,
}: {
  isMobile: boolean
  openSidebar: () => void
  label: string
  // Omit for a label that should never abbreviate (month view: "August" is
  // already short, so there's no shorter form worth switching to).
  shortLabel?: string
  prevLabel: string
  nextLabel: string
  onPrev: () => void
  onNext: () => void
  /**
   * When provided together, the label becomes a disclosure button that opens
   * the topbar's quick-nav panel (see _app.tsx) instead of being static text.
   * The day/week variants don't pass these yet — they have no panel to open.
   */
  expanded?: boolean
  onToggle?: () => void
}) {
  // flex-1 min-w-0 here is load-bearing, not cosmetic: TopbarLabel's own
  // @container needs a definite width handed down by flex distribution, and a
  // shrink-to-fit ancestor (flex-basis: auto) collapses it to zero instead —
  // see the matching comment on the default (non-paged) label in _app.tsx.
  // Wrapping the label in the disclosure <button> below must preserve this
  // chain rather than breaking it with a plain, non-flex wrapper.
  const labelNode = shortLabel
    ? <TopbarLabel long={label} short={shortLabel} className="flex-1 text-base text-foreground" />
    : <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>

  return (
    <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
      {isMobile && <IconButton variant="ghost" className="text-dim" onClick={openSidebar} title="Menu" label="Menu"><Menu size={18} /></IconButton>}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls="quickNavPanel"
          className="flex flex-1 items-center gap-1 min-w-0 text-left"
        >
          {/* Leads the label, not trails it — a fixed gap-1 from the label's
              first character regardless of how much space labelNode's own
              flex-1 claims, rather than drifting to the far edge of it. */}
          <ChevronDown size={16} className={cn('shrink-0 text-dim transition-transform', expanded && 'rotate-180')} aria-hidden />
          {labelNode}
        </button>
      ) : labelNode}
      {!isMobile && (
        <>
          <IconButton variant="ghost" className="text-dim" label={prevLabel} onClick={onPrev}><ChevronLeft size={18} /></IconButton>
          <IconButton variant="ghost" className="text-dim" label={nextLabel} onClick={onNext}><ChevronRight size={18} /></IconButton>
        </>
      )}
    </div>
  )
}
