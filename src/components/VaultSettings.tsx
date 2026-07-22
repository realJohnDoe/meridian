import { useState, useMemo } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { readVaultStringArray, writeVaultJSON } from '@/lib/vaultStorage'
import { useStore } from '@/store'
import { tokenSave, syncToBackend, removeVault, cacheDirtyCount } from '@/vaultActions'
import { ParticipantsRow } from '@/editor'
import type { VaultRef } from '@/vaultActions'

interface Props {
  vault:    VaultRef
  isActive: boolean
}

export function VaultSettings({ vault, isActive }: Props) {
  const [token,    setToken]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [syncing,  setSyncing]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [participants, setParticipants] = useState<string[]>(
    () => readVaultStringArray('meridian_default_participants', vault.id),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dirtyCount,  setDirtyCount]  = useState(0)

  const setDefaultParticipants = useStore(s => s.setDefaultParticipants)
  const activeVaultId          = useStore(s => s.activeVaultId)
  const items                  = useStore(s => s.items)

  const allParticipants = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      for (const p of item.metadata.participants) {
        const trimmed = p.trim()
        if (trimmed) set.add(trimmed)
      }
    }
    return [...set].sort()
  }, [items])

  function handleParticipantsChange(next: string[]) {
    setParticipants(next)
    writeVaultJSON('meridian_default_participants', vault.id, next)
    if (vault.id === activeVaultId) setDefaultParticipants(next)
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      await syncToBackend()
    } finally {
      setSyncing(false)
    }
  }

  async function handleRemoveClick() {
    setDirtyCount(await cacheDirtyCount(vault.id).catch(() => 0))
    setConfirmOpen(true)
  }

  async function handleSaveToken() {
    if (!token.trim()) return
    setBusy(true)
    setSyncing(true)
    setError(null)
    try {
      await tokenSave(vault.id, token.trim())
      setToken('')
      await syncToBackend()
    } catch (e) {
      setError((e as Error).message || 'Could not save token.')
    } finally {
      setBusy(false)
      setSyncing(false)
    }
  }

  return (
    <>
      {vault.kind === 'local' && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-medium">Folder</span>
            <span className="text-xs text-muted-foreground font-mono truncate">{vault.name}</span>
          </div>
          {isActive && (
            <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="shrink-0">
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </div>
      )}

      {vault.kind === 'github' && (
        <div className="flex flex-col gap-3 pt-2 border-t border-border">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Repository</span>
            <span className="text-xs text-muted-foreground font-mono truncate">
              {vault.github.owner}/{vault.github.repo} ({vault.github.branch})
            </span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Update token</span>
            <Input
              type="password"
              placeholder="github_pat_… (leave blank to keep current)"
              value={token}
              onChange={e => { setToken(e.target.value); setError(null) }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={token.trim() ? handleSaveToken : handleSyncNow}
              disabled={busy || syncing}
            >
              {(busy || syncing)
                ? (token.trim() ? 'Saving…' : 'Syncing…')
                : (token.trim() ? 'Save & sync' : 'Sync now')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2 border-t border-border">
        <span className="text-sm font-medium">Default participants</span>
        <p className="text-xs text-muted-foreground">
          Added to new entries in this vault automatically.
        </p>
        <ParticipantsRow
          participants={participants}
          onChange={handleParticipantsChange}
          allParticipants={allParticipants}
        />
      </div>

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
