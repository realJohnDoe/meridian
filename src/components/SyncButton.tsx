import { FolderSync } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useStore } from '@/store'
import { syncToBackend } from '@/storage/sync'
import { Button } from './ui/button'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'

export default function SyncButton() {
  const syncDirtyCount = useStore(s => s.syncDirtyCount)
  const syncError      = useStore(s => s.syncError)
  const syncOffline    = useStore(s => s.syncOffline)
  const lastSyncedAt   = useStore(s => s.lastSyncedAt)

  const isPending = syncOffline || syncDirtyCount > 0

  const color = syncError !== null
    ? 'var(--destructive)'
    : isPending ? 'var(--warning)'
    : 'var(--dim)'

  const lastSyncedText = lastSyncedAt
    ? `Last synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}`
    : 'Not synced yet'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-dim shrink-0"
          style={{ color }}
          aria-label="Sync status"
        >
          <FolderSync size={18} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2" align="end">
        <p className="text-xs text-muted-foreground">{lastSyncedText}</p>

        {syncDirtyCount > 0 && (
          <p className="text-xs" style={{ color: 'var(--warning)' }}>
            {syncDirtyCount} change{syncDirtyCount > 1 ? 's' : ''} waiting to sync
          </p>
        )}

        {syncOffline && !syncError && (
          <p className="text-xs" style={{ color: 'var(--warning)' }}>
            Offline — changes are saved locally and will sync when you reconnect.
          </p>
        )}

        {syncError && (
          <p className="text-xs" style={{ color: 'var(--destructive)' }}>
            {syncError}
          </p>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full mt-1"
          onClick={syncToBackend}
        >
          Sync now
        </Button>
      </PopoverContent>
    </Popover>
  )
}
