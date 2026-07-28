import { createPortal } from 'react-dom'
import { ArrowLeft, Heart, Trash2 } from 'lucide-react'
import { SyncButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/cn'
import { useTopbarSlot } from './-topbarSlot'
import { topbarEdgePadding } from './-topbarEdgePadding'

interface Props {
  isFavorited: boolean
  /** null disables the button — there's nothing yet for a favorite to attach to (no title). */
  onToggleFavorite: (() => void) | null
  onDelete: () => void
  onBack: () => void
}

/** Shared topbar for both the new-entry and edit-entry routes. */
export function EntryTopbar({ isFavorited, onToggleFavorite, onDelete, onBack }: Props) {
  const slotEl = useTopbarSlot()
  const { isMobile } = useSidebar()
  if (!slotEl) return null
  return createPortal(
    // Right edge always leads with an icon button; left edge only does on mobile (back button) —
    // desktop hides it, leaving nothing leading the left edge.
    <div className={cn('flex items-center gap-1 w-full lg:max-w-3xl lg:mx-auto', topbarEdgePadding(isMobile, true))}>
      <IconButton variant="ghost" className="text-dim lg:hidden" onClick={onBack} title="Back" label="Back">
        <ArrowLeft size={18} />
      </IconButton>
      <div className="flex-1" />
      <SyncButton />
      <IconButton
        variant="ghost"
        className={isFavorited ? 'text-destructive' : 'text-dim'}
        onClick={onToggleFavorite ?? undefined}
        disabled={!onToggleFavorite}
        title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={18} className={isFavorited ? 'fill-current' : ''} />
      </IconButton>
      <IconButton variant="ghost" className="text-destructive" onClick={onDelete} title="Delete" label="Delete">
        <Trash2 size={18} />
      </IconButton>
    </div>,
    slotEl,
  )
}
