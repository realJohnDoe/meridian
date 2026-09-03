import { Menu, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/primitives/icon-button'
import { PopoverAnchor } from '@/components/ui/popover'
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
  paging,
  expanded,
  onToggle,
  toggleRef,
  popoverAnchor,
}: {
  isMobile: boolean
  openSidebar: () => void
  label: string
  /** Prev/next chevrons render only when this is given — bundled as one object rather than four
   * separate optional props so a caller can't supply a label without its handler (or vice versa).
   * Omit for a view with no paging (agenda, backlog, notes). */
  paging?: { prevLabel: string; nextLabel: string; onPrev: () => void; onNext: () => void }
  /**
   * When provided together, the label becomes a disclosure button that opens
   * the topbar's quick-nav panel (see _app.tsx) instead of being static text.
   */
  expanded?: boolean
  onToggle?: () => void
  /** Ref onto the disclosure button, so _app.tsx can return focus to it when the panel closes via Escape. Only meaningful alongside onToggle. */
  toggleRef?: React.Ref<HTMLButtonElement>
  /**
   * Registers the disclosure button as the anchor a sibling `Popover` (see
   * _app.tsx) positions its desktop quick-nav content against. Must only be
   * true when this component is actually rendered inside a `Popover` —
   * `PopoverAnchor` requires that context — so it defaults to false and
   * every caller not wrapped in one (including this component's own tests)
   * is unaffected. Only meaningful alongside onToggle.
   */
  popoverAnchor?: boolean
}) {

  // flex-1 min-w-0 here is load-bearing for the plain (non-toggle) rendering
  // path below, not cosmetic: it needs a definite width handed down by flex
  // distribution, and a shrink-to-fit ancestor (flex-basis: auto) collapses
  // it to zero instead — see the matching comment on the default (non-paged)
  // label in _app.tsx.
  const labelNode = <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>

  // Whether the prev/next chevron buttons are actually rendered below — not
  // merely whether this view has paging semantics. On mobile those buttons
  // are dropped for every view (see comment above), so day/week/month get no
  // more chevrons to make room for there than agenda does.
  const showsPagingButtons = !isMobile && paging

  const toggleButton = onToggle && (
    <button
      ref={toggleRef}
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls="quickNavPanel"
      className={cn(
        'flex items-center gap-1 min-w-0 text-left',
        // With paging chevrons rendered, the button must shrink to fit its
        // own content (label + chevron) rather than claim flex-1 — mr-auto
        // then pushes the chevrons to the row's right edge in its place;
        // claiming flex-1 here too would fight that margin and let the
        // toggle chevron drift away from the label toward them. With no
        // chevrons rendered (agenda always; day/week/month on mobile, where
        // the chevrons below are dropped) there's nothing to push away
        // from, so flex-1 instead extends the button — and its tap
        // target — across the whole row, matching a plain label's reach.
        showsPagingButtons ? 'mr-auto' : 'flex-1',
      )}
    >
      {/* min-w-0 (not flex-1) here: the label must shrink-to-fit around
          the chevron so the chevron hugs it — flex-1 would grow the label
          across whatever width the button above claims (the full row, in
          the no-paging case), dragging the chevron away to the row's far
          edge instead of sitting next to the text. */}
      <span className="min-w-0 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
      <ChevronDown size={16} className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden />
    </button>
  )

  return (
    <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
      {isMobile && <IconButton variant="ghost" className="text-muted-foreground" onClick={openSidebar} title="Menu" label="Menu"><Menu size={18} /></IconButton>}
      {toggleButton
        // Only wraps when the caller has actually mounted this inside a
        // Popover (see popoverAnchor's own doc comment) — PopoverAnchor just
        // marks this button as the positioning reference for that Popover's
        // desktop content, with no click handling of its own, so it can
        // never fight the button's own onClick above.
        ? popoverAnchor ? <PopoverAnchor asChild>{toggleButton}</PopoverAnchor> : toggleButton
        : labelNode}
      {showsPagingButtons && (
        <>
          <IconButton variant="ghost" className="text-muted-foreground" label={paging.prevLabel} onClick={paging.onPrev}><ChevronLeft size={18} /></IconButton>
          <IconButton variant="ghost" className="text-muted-foreground" label={paging.nextLabel} onClick={paging.onNext}><ChevronRight size={18} /></IconButton>
        </>
      )}
    </div>
  )
}
