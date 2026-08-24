import { createPortal } from 'react-dom'
import { ArrowLeft, Heart, Trash2 } from 'lucide-react'
import { SyncButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { useTopbarSlot } from './-topbarSlot'
import { TopbarShell } from './-topbarShell'

interface Props {
  isFavorited: boolean
  /** null disables the button — there's nothing yet for a favorite to attach to (no title). */
  onToggleFavorite: (() => void) | null
  onDelete?: () => void
  onBack: () => void
  /** Hides the delete button — set for a `view-only` vault, where there's no source to delete from. */
  hideDelete?: boolean
}

/** Shared topbar for both the new-entry and edit-entry routes. */
export function EntryTopbar({ isFavorited, onToggleFavorite, onDelete, onBack, hideDelete }: Props) {
  const slotEl = useTopbarSlot()
  if (!slotEl) return null
  return createPortal(
    <TopbarShell
      // The back button always leads the left edge, regardless of screen size (the sidebar's own
      // hamburger stays mobile-only; large screens keep the sidebar docked open, so the back
      // button is the only way out of the editor there).
      leftHasButton
      left={
        <IconButton variant="ghost" className="text-dim" onClick={onBack} title="Back" label="Back">
          <ArrowLeft size={18} />
        </IconButton>
      }
      right={
        <div className="flex items-center gap-1 shrink-0">
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
          {!hideDelete && (
            <IconButton variant="ghost" className="text-destructive" onClick={onDelete} title="Delete" label="Delete">
              <Trash2 size={18} />
            </IconButton>
          )}
        </div>
      }
    />,
    slotEl,
  )
}
