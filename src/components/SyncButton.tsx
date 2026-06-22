import { FolderSync } from 'lucide-react'
import { useStore } from '@/store'
import { syncToBackend } from '@/storage/sync'
import { Button } from './ui/button'

export default function SyncButton() {
  const syncDirtyCount = useStore(s => s.syncDirtyCount)
  const syncError      = useStore(s => s.syncError)

  const syncColor = syncError !== null
    ? 'var(--destructive)'
    : syncDirtyCount > 0 ? 'var(--task)'
    : 'var(--dim)'

  const syncTitle = syncError
    ?? (syncDirtyCount > 0 ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''}` : 'All synced')

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
