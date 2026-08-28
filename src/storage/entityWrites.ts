/**
 * The write side of the core persistence port: one entry's file made durable
 * in the cache, and queued for push.
 *
 * A sibling of `moveEntry.ts` — `storage/index.ts` registers both against
 * `persistencePort`. It sits above `syncScheduler.ts` (it asks for a push, it
 * never decides when one runs) and above `sync.ts` (it refreshes the vault's
 * row), so the storage layer's dependency chain stays one-way:
 * syncState → sync → syncScheduler → here.
 *
 * The in-flight write registry (markInFlight/clearInFlight/getInFlightPaths)
 * lives in inFlight.ts — pure in-memory bookkeeping overlaying the persisted
 * status; see its doc comment there for why marking is refcounted.
 */
import { recordLocalEdit, recordLocalDelete } from '@/storage/cache/files'
import { markInFlight, clearInFlight } from '@/storage/inFlight'
import type { StorageBackend } from './backend'
import { keyToPath, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { getVaults } from '@/storeBridge'
import { warn, notifyError } from './notifications'
import { getBackend } from './backends'
import { journal, hashContent } from './syncJournal'
import { updateSyncUI } from './sync'
import { scheduleAutoPush } from './syncScheduler'

/**
 * The backend that owns `key`'s vault, or undefined if that vault isn't
 * registered.
 *
 * The vault half of the key is what routes this at all: a write addressed to
 * an unregistered vault is refused rather than silently applied to whichever
 * vault happens to be at hand — which is precisely what a stale closure or a
 * late-landing commit would have done before the key carried a vault.
 */
function backendFor(key: EntryKey): StorageBackend | undefined {
  return getBackend(keyVaultId(key))
}

/**
 * The vault for `key` was removed (or never mounted) between the store commit
 * and this write reaching the backend — e.g. deleted in Settings while an
 * editor was open on it, or a deferred commit landing after the vault
 * unmounted. Unlike `readOnly` (expected, e.g. an iCal subscription), this is
 * an anomaly: the store already shows the change as saved, so silence here
 * would let it vanish on reload with no trace.
 */
function reportUnregisteredVault(key: EntryKey, path: string): void {
  const vaultId = keyVaultId(key)
  journal('write-refused', vaultId, path, { note: 'unregistered' })
  const name = getVaults().find(v => v.id === vaultId)?.name ?? vaultId
  warn(`"${name}" is no longer connected — this change was not saved.`)
}

/**
 * Make one entry's file durable in the cache, and queue it for push.
 *
 * `content` is handed in by the committing layer rather than resolved from the
 * store here — see `EntityPersistence`. That is what makes this function a
 * straight line: there is no lookup that could miss, no way for this side to
 * disagree with the caller about what the entry holds, and so no "it looks
 * incomplete, skip it" branch to silently drop a write. Whether a key is a
 * write or a delete is likewise the caller's call (`persistEntries`), made
 * against the data it is committing.
 */
export async function writeEntityToCache(entryKey: EntryKey, content: string): Promise<void> {
  const path = keyToPath(entryKey)
  markInFlight(entryKey)
  try {
    const backend = backendFor(entryKey)
    if (!backend) { reportUnregisteredVault(entryKey, path); return }
    if (backend.readOnly) return
    await recordLocalEdit(backend.id, path, content)
    // The first link in every chain a conflict investigation has to walk: when
    // the store handed this content to the write queue, and what it was.
    journal('edit', backend.id, path, { localHash: hashContent(content), bytes: content.length }, backend.kind)
    updateSyncUI(backend)
    scheduleAutoPush(backend)
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notifyError('Save failed', e)
  } finally {
    clearInFlight(entryKey)
  }
}

export async function deleteFromBackend(entryKey: EntryKey): Promise<void> {
  const path = keyToPath(entryKey)
  markInFlight(entryKey)
  try {
    const backend = backendFor(entryKey)
    if (!backend) { reportUnregisteredVault(entryKey, path); return }
    if (backend.readOnly) return
    await recordLocalDelete(backend.id, path)
    journal('delete', backend.id, path, undefined, backend.kind)
    updateSyncUI(backend)
    scheduleAutoPush(backend)
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  } finally {
    clearInFlight(entryKey)
  }
}
