import { useState, useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readVaultStringArray, writeVaultJSON } from '@/lib/vaultStorage'
import { useStore } from '@/store'
import { tokenSave, syncToBackend, removeVault } from '@/vaultActions'
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
            <span className="text-[13px] font-medium">Folder</span>
            <span className="text-[12px] text-muted-foreground font-mono truncate">{vault.name}</span>
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
            <span className="text-[13px] font-medium">Repository</span>
            <span className="text-[12px] text-muted-foreground font-mono truncate">
              {vault.github.owner}/{vault.github.repo} ({vault.github.branch})
            </span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium">Update token</span>
            <input
              type="password"
              className="w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
              placeholder="github_pat_… (leave blank to keep current)"
              value={token}
              onChange={e => { setToken(e.target.value); setError(null) }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
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
        <span className="text-[13px] font-medium">Default participants</span>
        <p className="text-[12px] text-muted-foreground">
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
            onClick={() => removeVault(vault.id)}
          >
            <Trash2 className="size-[13px] stroke-[1.7]" />
            Remove vault
          </Button>
        </div>
      )}
    </>
  )
}
