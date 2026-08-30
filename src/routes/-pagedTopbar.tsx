import { Menu, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/primitives/icon-button'
import { cn } from '@/lib/cn'

// Shared by every view's topbar left slot (agenda, backlog/notes, day, week,
// month): a mobile menu button, a label, optional prev/next chevrons, and an
// optional quick-nav disclosure — differing only in which of those a given
// view wires up. The chevrons are desktop-only real estate: on the same
// narrow screens where isMobile shows the hamburger menu, they'd crowd the
// label for marginal benefit over the existing swipe-to-page carousel (see
// DayView/MonthView), so they're dropped there instead.
export function PagedTopbar({
  isMobile,
  openSidebar,
  label,
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
  /** Prev/next chevrons render only when both a label and a handler are given for each direction. Omit both pairs for a view with no paging (agenda, backlog, notes). */
  prevLabel?: string
  nextLabel?: string
  onPrev?: () => void
  onNext?: () => void
  /**
   * When provided together, the label becomes a disclosure button that opens
   * the topbar's quick-nav panel (see _app.tsx) instead of being static text.
   */
  expanded?: boolean
  onToggle?: () => void
  /** Ref onto the disclosure button, so _app.tsx can return focus to it when the panel closes via Escape. Only meaningful alongside onToggle. */
  toggleRef?: React.Ref<HTMLButtonElement>
}) {
  const hasPaging = !!(onPrev || onNext)

  // flex-1 min-w-0 here is load-bearing for the plain (non-toggle) rendering
  // path below, not cosmetic: it needs a definite width handed down by flex
  // distribution, and a shrink-to-fit ancestor (flex-basis: auto) collapses
  // it to zero instead — see the matching comment on the default (non-paged)
  // label in _app.tsx.
  const labelNode = <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>

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
          className={cn(
            'flex items-center gap-1 min-w-0 text-left',
            // With paging chevrons present, the button must shrink to fit its
            // own content (label + chevron) rather than claim flex-1 — mr-auto
            // then pushes the chevrons to the row's right edge in its place;
            // claiming flex-1 here too would fight that margin and let the
            // toggle chevron drift away from the label toward them. With no
            // chevrons (agenda, backlog, notes) there's nothing to push away
            // from, so flex-1 instead extends the button — and its tap
            // target — across the whole row, matching a plain label's reach.
            hasPaging ? 'mr-auto' : 'flex-1',
          )}
        >
          {labelNode}
          <ChevronDown size={16} className={cn('shrink-0 text-dim transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      ) : labelNode}
      {!isMobile && hasPaging && (
        <>
          <IconButton variant="ghost" className="text-dim" label={prevLabel ?? ''} onClick={onPrev}><ChevronLeft size={18} /></IconButton>
          <IconButton variant="ghost" className="text-dim" label={nextLabel ?? ''} onClick={onNext}><ChevronRight size={18} /></IconButton>
        </>
      )}
    </div>
  )
}
