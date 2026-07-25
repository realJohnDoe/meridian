import { Menu, ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'

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
      {isMobile && <IconButton variant="ghost" className="text-dim" onClick={openSidebar} title="Menu" label="Menu"><Menu size={18} /></IconButton>}
      <span className="flex-1 text-base text-foreground whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
      <IconButton variant="ghost" className="text-dim" label={prevLabel} onClick={onPrev}><ChevronLeft size={18} /></IconButton>
      <IconButton variant="ghost" className="text-dim" label={nextLabel} onClick={onNext}><ChevronRight size={18} /></IconButton>
    </div>
  )
}
