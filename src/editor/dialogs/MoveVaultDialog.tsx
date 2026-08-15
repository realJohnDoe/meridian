import { ArrowRightLeft } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** What the editor knows about a move the user has asked for but not confirmed. */
export interface PendingMove {
  /** Display name of the entry being moved. */
  title:      string
  fromVault:  string
  toVault:    string
  /** The slug it will land on — differs from its current one only on a collision. */
  toSlug:     string
  /** True when `toSlug` had to be uniquified against a file the target vault already has. */
  slugTaken:  boolean
  /** Entries in the source vault that link here and will stop resolving. */
  inbound:    number
  /** Links inside this entry that pointed into the source vault and will stop resolving. */
  outbound:   number
}

interface Props {
  move: PendingMove | null
  onConfirm: () => void
  onClose: () => void
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Confirms a cross-vault move, stating what it costs.
 *
 * A move has no undo — it is two durable writes in two vaults, each with its
 * own push cycle (see `storage/moveEntry.ts`) — so this dialog is where the
 * weight sits. It names both link directions explicitly rather than warning in
 * general terms: wikilinks are per vault and stored bare, so the breakage is
 * real, unrepairable automatically, and countable in advance.
 */
export default function MoveVaultDialog({ move, onConfirm, onClose }: Props) {
  const breaks: string[] = []
  if (move && move.inbound > 0) {
    breaks.push(`${plural(move.inbound, 'entry', 'entries')} in ${move.fromVault} ${move.inbound === 1 ? 'links' : 'link'} to this one`)
  }
  if (move && move.outbound > 0) {
    breaks.push(`${plural(move.outbound, 'link', 'links')} inside it ${move.outbound === 1 ? 'points' : 'point'} at ${move.fromVault} entries`)
  }

  return (
    <AlertDialog open={!!move} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Move to {move?.toVault}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                &ldquo;{move?.title}&rdquo; moves out of {move?.fromVault} and into {move?.toVault}.
                This cannot be undone.
              </p>
              {breaks.length > 0 ? (
                <p>
                  Wikilinks only resolve inside their own vault, so the move breaks
                  them: {breaks.join(', and ')}. They stay visible in the text, marked
                  broken, so you can repair them by hand.
                </p>
              ) : (
                <p>No wikilinks break — nothing links to this entry, and it links to nothing in {move?.fromVault}.</p>
              )}
              {move?.slugTaken && (
                <p>
                  {move.toVault} already has a file on this entry&rsquo;s
                  slug, so it lands as <span className="font-mono text-2xs">{move.toSlug}.md</span> instead.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="gap-1.5" onClick={() => { onConfirm(); onClose() }}>
            <ArrowRightLeft size={13} />
            Move
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
