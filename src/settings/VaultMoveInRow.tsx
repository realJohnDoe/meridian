import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/primitives/button'
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
import { Checkbox } from '@/components/ui/checkbox'
import { useStore } from '@/store'
import { removeVault, previewVaultCopy, copyVaultInto } from '@/vaultActions'
import type { VaultRef, IcsImportSummary } from '@/vaultActions'
import { isWritableVault } from '@/vaultRef'
import { VaultChip } from '@/components'
import { SettingsRow } from './SettingsSection'
import { eventCount } from './VaultImportRow'

/**
 * What the confirm dialog says moving a subscription in is about to do.
 *
 * The sibling of `importSummary`, and separate from it because the two
 * differ in more than a word: an import is a file the user chose, while this is
 * the events they are already looking at, and only this one can tell them they
 * will stop following the calendar.
 */
function moveInSummary({ added, updated }: IcsImportSummary): string {
  const total = added + updated
  if (total === 0) {
    return 'This subscription isn’t showing any events yet, so there is nothing to move. Try again once it has refreshed.'
  }
  const becomes = total === 1
    ? '1 event becomes an ordinary entry you can edit, link to and delete.'
    : `${total} events become ordinary entries you can edit, link to and delete.`
  if (updated === 0) return `${becomes} They stop following the calendar they came from.`
  const replaced = updated === 1
    ? '1 of them replaces an entry'
    : `${updated} of them replace entries`
  return `${becomes} ${replaced} imported from this calendar before, losing any edits made here.`
}

/** The "Move into a vault" row of a subscription, and the dialog that confirms it. */
export function VaultMoveInRow({ vault }: { vault: VaultRef }) {
  const [moveInOpen, setMoveInOpen] = useState(false)
  const [moveInTarget, setMoveInTarget] = useState<string | null>(null)
  // Default on: the whole point of moving in is to stop depending on the feed,
  // and leaving both would show every event twice in the agenda.
  const [dropFeed, setDropFeed] = useState(true)
  const vaults = useStore(s => s.vaults)
  // A subscription can only move *into* a vault Meridian can write to, and
  // never into itself.
  const moveInTargets = vaults.filter(v => isWritableVault(v) && v.id !== vault.id)
  const moveInTo      = moveInTarget ?? moveInTargets[0]?.id ?? null
  // Memoized because it is not cheap: the preview re-serializes and re-parses
  // every event the subscription holds, and this screen re-renders on any store
  // change — a sync tick landing while the dialog is open would otherwise redo
  // the whole thing. The count can go stale against a refresh that arrives
  // mid-dialog; `copyVaultInto` re-plans on confirm, so only the number shown
  // is ever behind, never what gets written.
  const moveInPlan = useMemo(
    () => (moveInOpen && moveInTo ? previewVaultCopy(vault.id, moveInTo) : null),
    [moveInOpen, moveInTo, vault.id],
  )

  function handleMoveIn() {
    if (!moveInTo) return
    const result = copyVaultInto(vault.id, moveInTo)
    const name = vaults.find(v => v.id === moveInTo)?.name ?? 'the vault'
    setMoveInOpen(false)
    // After the vault disappears this screen redirects itself (see VaultDetail),
    // so the toast is what carries the outcome to wherever the user lands.
    if (dropFeed) void removeVault(vault.id)
    toast.success(`Moved ${eventCount(result.added + result.updated)} into ${name}.`)
  }

  return (
    <>
      <SettingsRow
        label="Move into a vault"
        description={
          moveInTargets.length === 0
            ? 'Copies these events into a vault you own, as entries you can edit. You need a vault Meridian can write to first — add one from Settings.'
            : 'Copy these events into a vault you own, as ordinary entries you can edit. Unlike this subscription, they stay when the calendar changes — and stop following it.'
        }
        control={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={moveInTargets.length === 0}
            onClick={() => { setMoveInOpen(true) }}
          >
            <ArrowRightLeft className="size-3.5 stroke-[1.7]" />
            Move in
          </Button>
        }
      />
      <AlertDialog open={moveInOpen} onOpenChange={setMoveInOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Move &ldquo;{vault.name}&rdquo; into a vault</AlertDialogTitle>
            <AlertDialogDescription>
              {moveInSummary(moveInPlan ?? { added: 0, updated: 0, skipped: [] })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-foreground">Move into</span>
              <VaultChip vaultId={moveInTo} onChange={setMoveInTarget} />
            </div>
            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <Checkbox
                checked={dropFeed}
                onCheckedChange={c => { setDropFeed(c === true) }}
                className="mt-0.5"
              />
              <span>
                Remove this subscription afterwards
                <span className="block text-xs text-muted-foreground">
                  Keeping it shows every event twice — once live, once as your copy. The calendar itself isn’t affected either way.
                </span>
              </span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {moveInPlan && moveInPlan.added + moveInPlan.updated > 0 && (
              <AlertDialogAction className="gap-1.5" onClick={handleMoveIn}>
                <ArrowRightLeft size={13} />
                Move in
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
