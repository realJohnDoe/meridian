import { RefreshCw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useStore } from '@/store'
import { syncToBackend } from '@/vaultActions'
import { Button } from './ui/button'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'

export default function SyncButton() {
  const syncDirtyCount = useStore(s => s.syncDirtyCount)
  const syncReadOnly   = useStore(s => s.syncReadOnly)
  const syncError      = useStore(s => s.syncError)
  const syncOffline    = useStore(s => s.syncOffline)
  const syncInProgress = useStore(s => s.syncInProgress)
  const lastSyncedAt   = useStore(s => s.lastSyncedAt)
  const unreadableFiles = useStore(s => s.unreadableFiles)

  const isPending = syncOffline || syncDirtyCount > 0

  // Read-only is expected, calm state — not an error — so it never takes the
  // destructive color, even though it also suppresses the dirty-count badge.
  const color = syncError !== null || unreadableFiles.size > 0
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
          <RefreshCw size={18} className={syncInProgress ? 'animate-spin' : undefined} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2" align="end">
        <p className="text-xs text-muted-foreground">{lastSyncedText}</p>

        {syncInProgress && (
          <p className="text-xs text-muted-foreground">Syncing…</p>
        )}

        {syncDirtyCount > 0 && (
          <p className="text-xs text-warning">
            {syncDirtyCount} change{syncDirtyCount > 1 ? 's' : ''} waiting to sync
          </p>
        )}

        {syncReadOnly && (
          <p className="text-xs text-muted-foreground">
            Tutorial vault — changes aren't saved.
          </p>
        )}

        {syncOffline && !syncError && (
          <p className="text-xs text-warning">
            Offline — changes are saved locally and will sync when you reconnect.
          </p>
        )}

        {syncError && (
          <p className="text-xs text-destructive">
            {syncError}
          </p>
        )}

        {unreadableFiles.size > 0 && (
          <div className="text-xs text-destructive space-y-1">
            <p>
              {unreadableFiles.size} file{unreadableFiles.size > 1 ? 's' : ''} couldn't be read:
            </p>
            <ul className="list-disc list-inside">
              {[...unreadableFiles.values()].map(f => (
                <li key={f.path} title={f.message}>{f.path}</li>
              ))}
            </ul>
          </div>
        )}

        {!syncReadOnly && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-1"
            onClick={syncToBackend}
          >
            Sync now
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
