import { Menu, ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/primitives/icon-button'
import { TopbarLabel } from './-topbarLabel'

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
}) {
  return (
    <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
      {isMobile && <IconButton variant="ghost" className="text-dim" onClick={openSidebar} title="Menu" label="Menu"><Menu size={18} /></IconButton>}
      {shortLabel
        ? <TopbarLabel long={label} short={shortLabel} className="flex-1 text-base text-foreground" />
        : <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>}
      {!isMobile && (
        <>
          <IconButton variant="ghost" className="text-dim" label={prevLabel} onClick={onPrev}><ChevronLeft size={18} /></IconButton>
          <IconButton variant="ghost" className="text-dim" label={nextLabel} onClick={onNext}><ChevronRight size={18} /></IconButton>
        </>
      )}
    </div>
  )
}
