import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/primitives/button'
import { buttonVariants } from '@/components/ui/button'
import { Notice } from '@/components/primitives/notice'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ConfirmDialogContent } from '@/components/primitives/confirm-dialog-content'
import { removeVault, cacheDirtyCount } from '@/vaultActions'
import type { VaultRef } from '@/vaultActions'
import { SettingsRow } from './SettingsSection'

/** The "Remove vault" row and its confirm dialog, which warns about unsynced changes. */
export function RemoveVaultRow({ vault }: { vault: VaultRef }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dirtyCount, setDirtyCount] = useState(0)

  async function handleRemoveClick() {
    setDirtyCount(await cacheDirtyCount(vault.id).catch(() => 0))
    setConfirmOpen(true)
  }

  return (
    <>
      <SettingsRow
        label="Remove vault"
        description={
          vault.kind === 'example'
            ? 'Removes the Tutorial vault from this device. You can add it back anytime.'
            : 'Removes this vault from this device. The original files are not affected.'
        }
        control={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:bg-transparent hover-layer hover:text-destructive"
            onClick={handleRemoveClick}
          >
            <Trash2 className="size-3.5 stroke-[1.7]" />
            Remove
          </Button>
        }
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ConfirmDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove vault</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &ldquo;{vault.name}&rdquo;? This deletes it from this device.
              {vault.kind === 'github' && ' The GitHub repository itself is not affected.'}
              {vault.kind === 'ical' && ' The calendar itself is not affected — only this subscription to it.'}
              {vault.kind === 'example' && ' You can add it back anytime from here.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dirtyCount > 0 && (
            <Notice tone="warning">
              {dirtyCount} unsynced {dirtyCount === 1 ? 'change has' : 'changes have'} not been backed up and will be lost.
            </Notice>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive', className: 'gap-1.5' })}
              onClick={() => { setConfirmOpen(false); void removeVault(vault.id) }}
            >
              <Trash2 size={13} />
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </ConfirmDialogContent>
      </AlertDialog>
    </>
  )
}
