import { Menu, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Shared by the day and month topbar variants — both are a mobile menu
// button, an ellipsized label, and prev/next chevrons, differing only in
// the label and the navigation targets.
export function PagedTopbar({
  isMobile,
  openSidebar,
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
}: {
  isMobile: boolean
  openSidebar: () => void
  label: string
  prevLabel: string
  nextLabel: string
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-1 items-center gap-1 overflow-hidden min-w-0">
      {isMobile && <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={openSidebar} title="Menu" aria-label="Menu"><Menu size={18} /></Button>}
      <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
      <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label={prevLabel} onClick={onPrev}><ChevronLeft size={18} /></Button>
      <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label={nextLabel} onClick={onNext}><ChevronRight size={18} /></Button>
    </div>
  )
}
