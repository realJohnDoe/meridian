import { useEffect } from 'react'
import { FolderSync } from 'lucide-react'
import { useStore } from '../store'
import { syncToBackend } from '../storage/sync'
import { on } from '../events'
import { Button } from './ui/button'

export default function SyncButton() {
  const syncDirtyCount = useStore(s => s.syncDirtyCount)
  const syncFlash      = useStore(s => s.syncFlash)
  const syncError      = useStore(s => s.syncError)
  const vaults         = useStore(s => s.vaults)
  const activeVaultId  = useStore(s => s.activeVaultId)

  useEffect(() => on('sync:done', () => {
    useStore.setState({ syncFlash: true })
    setTimeout(() => useStore.setState({ syncFlash: false }), 800)
  }), [])

  const activeVault = vaults.find(v => v.id === activeVaultId)
  const isWritable  = activeVault?.kind === 'local' || activeVault?.kind === 'github'

  const syncColor = syncError
    ? 'var(--destructive)'
    : syncFlash ? 'var(--task)'
    : !isWritable ? 'var(--muted-foreground)'
    : syncDirtyCount > 0 ? 'var(--note)'
    : 'var(--dim)'

  const syncTitle = !isWritable
    ? 'Example vault is read-only'
    : syncError
      ? 'Sync failed — click to retry'
      : syncDirtyCount > 0
        ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''} — syncing…`
        : 'All synced'

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full text-dim shrink-0"
      onClick={syncToBackend}
      title={syncTitle}
      style={{ color: syncColor }}
    >
      <FolderSync size={18} />
    </Button>
  )
}
