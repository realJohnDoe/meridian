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
  toggleRef,
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
   */
  expanded?: boolean
  onToggle?: () => void
  /** Ref onto the disclosure button, so _app.tsx can return focus to it when the panel closes via Escape. Only meaningful alongside onToggle. */
  toggleRef?: React.Ref<HTMLButtonElement>
}) {
  // flex-1 min-w-0 here is load-bearing for the plain (non-toggle) rendering
  // path below, not cosmetic: TopbarLabel's own @container needs a definite
  // width handed down by flex distribution, and a shrink-to-fit ancestor
  // (flex-basis: auto) collapses it to zero instead — see the matching
  // comment on the default (non-paged) label in _app.tsx. The disclosure
  // <button> branch deliberately does NOT preserve this chain (see its own
  // comment) — it needs the opposite property, a label sized to its own
  // content rather than stretched to fill the row.
  const labelNode = shortLabel
    ? <TopbarLabel long={label} short={shortLabel} className="flex-1 text-base text-foreground" />
    : <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>

  return (
    <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
      {isMobile && <IconButton variant="ghost" className="text-dim" onClick={openSidebar} title="Menu" label="Menu"><Menu size={18} /></IconButton>}
      {onToggle ? (
        <button
          ref={toggleRef}
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls="quickNavPanel"
          // Not flex-1: shrink-to-fit, so the button (and the chevron inside
          // it) sizes to the label's actual text plus gap-1, not to however
          // much of the row flex-1 would otherwise claim — which is what let
          // the chevron drift toward the prev/next chevrons. mr-auto pushes
          // those chevrons to the row's right edge in its place.
          //
          // labelNode keeps its own flex-1 className unchanged (see above);
          // inside this shrink-to-fit button that degrades to content-based
          // sizing rather than collapsing, per how a percentage flex-basis
          // resolves against an indefinite container — but only for the
          // plain <span> branch. TopbarLabel's own @container hits the
          // zero-collapse case regardless of its flex-1, because that's a
          // property of container-type: inline-size on an indefinite
          // ancestor, not of the flex-basis value — so this button only
          // supports the plain-label case today (month view, the one
          // current caller). Combining shortLabel with onToggle will need a
          // different layout if a future view (day/week) wires both.
          className="flex items-center gap-1 min-w-0 mr-auto text-left"
        >
          {labelNode}
          <ChevronDown size={16} className={cn('shrink-0 text-dim transition-transform', expanded && 'rotate-180')} aria-hidden />
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
