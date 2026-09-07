import { ArrowLeft, Heart, Trash2 } from 'lucide-react'
import { SyncButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
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
  return (
    <header
      className="sticky top-0 z-10 h-topbar pt-[env(safe-area-inset-top)] flex items-center border-b border-border shrink-0 bg-background shadow-md"
      data-topbar
    >
      <TopbarShell
        // The back button always leads the left edge, regardless of screen size. This topbar
        // never renders the calendar views' hamburger trigger: below `lg` the nav rail (see
        // _entry.tsx) is off-canvas and unreachable from here, so the back button is the only way
        // out; at/above `lg` it sits docked open beside the editor, and the back button remains
        // the deliberate way to leave — the rail is for jumping elsewhere, not for closing this
        // screen.
        leftHasButton
        left={
          <IconButton variant="ghost" className="text-muted-foreground" onClick={onBack} title="Back" label="Back">
            <ArrowLeft size={18} />
          </IconButton>
        }
        right={
          <div className="flex items-center gap-1 shrink-0">
            <SyncButton />
            <IconButton
              variant="ghost"
              className={isFavorited ? 'text-destructive' : 'text-muted-foreground'}
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
      />
    </header>
  )
}
