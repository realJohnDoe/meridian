import { cacheDirtyCount } from '@/storage/cache/files'
import { setVaultSync } from '@/storeBridge'
import type { StorageBackend } from './backend'

/** Refresh one vault's row in `syncByVault` — its dirty count and read-only flag. */
export function updateSyncUI(backend: StorageBackend): void {
  if (backend.readOnly) {
    setVaultSync(backend.id, { dirtyCount: 0, readOnly: true })
    return
  }
  setVaultSync(backend.id, { readOnly: false })
  cacheDirtyCount(backend.id).then(n => setVaultSync(backend.id, { dirtyCount: n })).catch(() => {})
}
