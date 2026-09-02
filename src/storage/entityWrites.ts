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
import { isWritableVault } from '@/vaultRef'
import { getVaults } from '@/storeBridge'
import { warn, notifyError } from './notifications'
import { getBackend } from './backends'
import { journal, hashContent } from './syncJournal'
import { updateSyncUI } from './sync'
import { scheduleAutoPush } from './syncScheduler'

/**
 * Where one write may go — decided by the vault half of the key, which is what
 * routes this at all: a write addressed to a vault that is not this user's is
 * refused rather than silently applied to whichever vault happens to be at
 * hand, which is precisely what a stale closure or a late-landing commit would
 * have done before the key carried a vault.
 *
 * **`deferred` is not `refused`.** A vault is registered long before its
 * backend is mounted: `restoreVaults` paints every vault's layer from the cache
 * and opens the paint gate in phase 1, then builds backends in phase 2 — behind
 * an OAuth refresh POST for a GitHub vault, and a permission probe for a local
 * folder. The agenda is interactive for that whole window, so an entry created
 * in it used to reach a `getBackend` that answered `undefined` and be thrown
 * away with a toast claiming the vault was "no longer connected". Nothing was
 * disconnected and nothing came back for the write: the store kept showing the
 * entry, so the loss was invisible until the next reload.
 *
 * The cache does not need the backend. `recordLocalEdit`/`recordLocalDelete`
 * are keyed by vault *id*, which the key already carries, and the mount that
 * follows runs `syncOnActivate`, whose `pushDirty` leg exists precisely to
 * rescue records left dirty by an earlier moment. So a registered writable
 * vault takes the write into Dexie now and lets that push find it — the same
 * shape as an offline edit, which is also recorded dirty against a backend that
 * cannot currently be reached.
 */
type WriteTarget =
  | { kind: 'mounted';  backend: StorageBackend }
  | { kind: 'deferred' }
  | { kind: 'refused' }

function writeTarget(key: EntryKey): WriteTarget {
  const vaultId = keyVaultId(key)
  const backend = getBackend(vaultId)
  if (backend) return { kind: 'mounted', backend }
  // Only a *writable* kind may be written to unmounted: `readOnly` is a
  // property of the backend, and with none built yet the ref's kind is the
  // only thing that answers it. An iCal subscription or the Tutorial vault
  // therefore stays refused rather than accumulating dirty rows nothing will
  // ever push.
  const ref = getVaults().find(v => v.id === vaultId)
  return isWritableVault(ref) ? { kind: 'deferred' } : { kind: 'refused' }
}

/**
 * The vault for `key` is not one this app can write to at all — removed in
 * Settings while an editor was open on it, or a deferred commit landing after
 * it unmounted for good. Unlike `readOnly` (expected, e.g. an iCal
 * subscription), this is an anomaly: the store already shows the change as
 * saved, so silence here would let it vanish on reload with no trace.
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
  const path    = keyToPath(entryKey)
  const vaultId = keyVaultId(entryKey)
  markInFlight(entryKey)
  try {
    const target = writeTarget(entryKey)
    if (target.kind === 'refused') { reportUnregisteredVault(entryKey, path); return }
    if (target.kind === 'mounted' && target.backend.readOnly) return
    await recordLocalEdit(vaultId, path, content)
    // The first link in every chain a conflict investigation has to walk: when
    // the store handed this content to the write queue, and what it was.
    journal('edit', vaultId, path, { localHash: hashContent(content), bytes: content.length }, target.kind === 'mounted' ? target.backend.kind : undefined)
    if (target.kind === 'deferred') { journal('write-deferred', vaultId, path, { note: 'unmounted' }); return }
    updateSyncUI(target.backend)
    scheduleAutoPush(target.backend)
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notifyError('Save failed', e)
  } finally {
    clearInFlight(entryKey)
  }
}

export async function deleteFromBackend(entryKey: EntryKey): Promise<void> {
  const path    = keyToPath(entryKey)
  const vaultId = keyVaultId(entryKey)
  markInFlight(entryKey)
  try {
    const target = writeTarget(entryKey)
    if (target.kind === 'refused') { reportUnregisteredVault(entryKey, path); return }
    if (target.kind === 'mounted' && target.backend.readOnly) return
    await recordLocalDelete(vaultId, path)
    journal('delete', vaultId, path, undefined, target.kind === 'mounted' ? target.backend.kind : undefined)
    if (target.kind === 'deferred') { journal('write-deferred', vaultId, path, { note: 'unmounted' }); return }
    updateSyncUI(target.backend)
    scheduleAutoPush(target.backend)
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  } finally {
    clearInFlight(entryKey)
  }
}
