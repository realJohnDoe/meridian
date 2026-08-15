import { RefreshCw, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useStore, emptySyncStatus } from '@/store'
import type { VaultSyncStatus } from '@/store'
import { syncToBackend, reconnectVault } from '@/vaultActions'
import type { VaultRef } from '@/vaultActions'
import { Button } from './ui/button'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { VaultIcon } from './vaultIcon'
import { keyVaultId } from '@/fileIO'

/**
 * How "bad" a vault's status is, for the aggregate icon colour. Worst wins:
 * one vault erroring must colour the icon even while three others are clean,
 * because the icon is the only always-visible signal that something needs
 * attention.
 */
type Severity = 'error' | 'pending' | 'idle'

function severityOf(status: VaultSyncStatus): Severity {
  if (status.error !== null || status.needsReconnect) return 'error'
  if (status.offline || status.dirtyCount > 0) return 'pending'
  return 'idle'
}

function VaultRow({ vault, status }: { vault: VaultRef; status: VaultSyncStatus }) {
  const lastSynced = status.lastSyncedAt
    ? `Synced ${formatDistanceToNow(status.lastSyncedAt, { addSuffix: true })}`
    : status.readOnly ? null : 'Not synced yet'

  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-t border-border first:border-t-0">
      <div className="flex items-center gap-1.5">
        <VaultIcon kind={vault.kind} className="size-3.5 stroke-[1.7] shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-xs font-medium">{vault.name}</span>
        {status.inProgress && <RefreshCw size={11} className="animate-spin text-muted-foreground shrink-0" />}
      </div>

      {lastSynced && <p className="text-2xs text-muted-foreground pl-5">{lastSynced}</p>}

      {/* Generalized from the two hardcoded "Tutorial vault — changes aren't
          saved." strings: any read-only vault says so in its own name. */}
      {status.readOnly && (
        <p className="text-2xs text-muted-foreground pl-5">Read-only — changes aren&rsquo;t saved.</p>
      )}

      {status.dirtyCount > 0 && (
        <p className="text-2xs text-warning pl-5">
          {status.dirtyCount} change{status.dirtyCount > 1 ? 's' : ''} waiting to sync
        </p>
      )}

      {status.offline && !status.error && (
        <p className="text-2xs text-warning pl-5">Offline — changes are saved locally.</p>
      )}

      {status.error && <p className="text-2xs text-destructive pl-5">{status.error}</p>}

      {/* Absorbed from the sidebar's old per-vault list, which is gone: this is
          now the one place a local vault can ask for its permission back, and
          the click is the user gesture the FS API requires. */}
      {status.needsReconnect && (
        <button
          className="flex items-center gap-1 pl-5 text-2xs text-note hover:underline text-left"
          onClick={() => void reconnectVault(vault.id)}
        >
          <AlertCircle className="size-3 shrink-0" />
          Permission needed — reconnect
        </button>
      )}
    </div>
  )
}

export default function SyncButton() {
  const vaults          = useStore(s => s.vaults)
  const syncByVault     = useStore(s => s.syncByVault)
  const unreadableFiles = useStore(s => s.unreadableFiles)

  const statuses = vaults.map(v => ({ vault: v, status: syncByVault.get(v.id) ?? emptySyncStatus() }))

  const worst: Severity = statuses.some(s => severityOf(s.status) === 'error') || unreadableFiles.size > 0
    ? 'error'
    : statuses.some(s => severityOf(s.status) === 'pending') ? 'pending' : 'idle'

  const anyInProgress = statuses.some(s => s.status.inProgress)
  const anyWritable   = statuses.some(s => !s.status.readOnly)

  // Read-only is expected, calm state — not an error — so it never takes the
  // destructive color, even though it also suppresses the dirty-count badge.
  const color = worst === 'error' ? 'var(--destructive)'
    : worst === 'pending' ? 'var(--warning)'
    : 'var(--dim)'

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
          <RefreshCw size={18} className={anyInProgress ? 'animate-spin' : undefined} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="end">
        <div className="flex flex-col">
          {statuses.map(({ vault, status }) => (
            <VaultRow key={vault.id} vault={vault} status={status} />
          ))}
        </div>

        {unreadableFiles.size > 0 && (
          <div className="text-xs text-destructive space-y-1 pt-2 border-t border-border">
            <p>
              {unreadableFiles.size} file{unreadableFiles.size > 1 ? 's' : ''} couldn&rsquo;t be read:
            </p>
            <ul className="list-disc list-inside">
              {[...unreadableFiles].map(([key, f]) => (
                <li key={key} title={f.message}>
                  {vaults.length > 1 ? `${keyVaultId(key)}: ` : ''}{f.path}
                </li>
              ))}
            </ul>
          </div>
        )}

        {anyWritable && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-1"
            onClick={() => void syncToBackend()}
          >
            Sync now
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
