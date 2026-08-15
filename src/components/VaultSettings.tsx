import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { readVaultStringArray } from '@/lib/vaultStorage'
import { useStore } from '@/store'
import { useAllParticipants } from '@/hooks'
import { syncToBackend, removeVault, cacheDirtyCount } from '@/vaultActions'
import { ParticipantsRow } from '@/editor'
import type { VaultRef } from '@/vaultActions'

interface Props {
  vault: VaultRef
}

export function VaultSettings({ vault }: Props) {
  const [syncing,  setSyncing]  = useState(false)
  const [participants, setParticipants] = useState<string[]>(
    () => readVaultStringArray('meridian_default_participants', vault.id),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dirtyCount,  setDirtyCount]  = useState(0)

  const setDefaultParticipants = useStore(s => s.setDefaultParticipants)
  const items                  = useStore(s => s.items)
  const lastRefreshed          = useStore(s => s.syncByVault.get(vault.id)?.lastSyncedAt ?? null)

  const allParticipants = useAllParticipants(items)

  function handleParticipantsChange(next: string[]) {
    setParticipants(next)
    // The store action owns both the write and the "is this the vault whose
    // values are currently loaded?" check, so Settings can edit any vault's
    // defaults without disturbing the one a new entry would target.
    setDefaultParticipants(vault.id, next)
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      await syncToBackend(vault.id)
    } finally {
      setSyncing(false)
    }
  }

  async function handleRemoveClick() {
    setDirtyCount(await cacheDirtyCount(vault.id).catch(() => 0))
    setConfirmOpen(true)
  }

  return (
    <>
      {vault.kind === 'local' && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-medium">Folder</span>
            <span className="text-xs text-muted-foreground font-mono truncate">{vault.name}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="shrink-0">
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}

      {vault.kind === 'github' && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-medium">Repository</span>
            <span className="text-xs text-muted-foreground font-mono truncate">
              {vault.github.owner}/{vault.github.repo} ({vault.github.branch})
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="shrink-0">
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}

      {vault.kind === 'ical' && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium">Calendar address</span>
              {/* Deliberately not truncated to a hostname: this is a secret
                  address the user may need to copy out again, and hiding most
                  of it would make it unusable for that. */}
              <span className="text-xs text-muted-foreground font-mono break-all">{vault.ical.url}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="shrink-0">
              {syncing ? 'Refreshing…' : 'Refresh now'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {lastRefreshed
              ? `Last refreshed ${formatDistanceToNow(lastRefreshed, { addSuffix: true })}. Checked automatically every 15 minutes.`
              : 'Checked automatically every 15 minutes.'}
          </p>
        </div>
      )}

      {/* A subscription has no writable side, so there is nothing for default
          participants to seed — new entries can never land here. */}
      {vault.kind !== 'ical' && (
      <div className="flex flex-col gap-2 pt-2 border-t border-border">
        <span className="text-sm font-medium">Default participants</span>
        <p className="text-xs text-muted-foreground">
          Added to new entries in this vault automatically. Stored on this device only,
          so each device (and each person sharing the vault) can set its own.
        </p>
        <ParticipantsRow
          participants={participants}
          onChange={handleParticipantsChange}
          allParticipants={allParticipants}
        />
      </div>
      )}

      {vault.kind !== 'example' && (
        <div className="flex justify-end pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
            onClick={handleRemoveClick}
          >
            <Trash2 className="size-3.5 stroke-[1.7]" />
            Remove vault
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove vault</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &ldquo;{vault.name}&rdquo;? This deletes it from this device.
              {vault.kind === 'github' && ' The GitHub repository itself is not affected.'}
              {vault.kind === 'ical' && ' The calendar itself is not affected — only this subscription to it.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dirtyCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" />
              <span>
                {dirtyCount} unsynced {dirtyCount === 1 ? 'change has' : 'changes have'} not been backed up and will be lost.
              </span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
              onClick={() => { setConfirmOpen(false); void removeVault(vault.id) }}
            >
              <Trash2 size={13} />
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
