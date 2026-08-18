import { recordLocalEdit, recordLocalDelete } from '@/storage/cache/files'
import { markInFlight, clearInFlight } from '@/storage/inFlight'
import { keyToPath, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { StorageBackend } from './backend'
import { getBackend } from './backends'
import { updateSyncUI, scheduleAutoPush } from './sync'
import { notify, notifyError } from './notifications'

/**
 * The writable backend for `key`'s vault, or a reason it isn't one.
 *
 * Both ends of a move are checked *before* either write, so a move into a
 * vault that has been unregistered (or is a subscription, which has no
 * writable side at all) is refused while the entry is still whole in its
 * source vault. Checking as we go would leave the failure mode this whole
 * module exists to avoid: a tombstone in the source with nothing durable
 * anywhere else.
 */
function writableBackend(key: EntryKey): StorageBackend | null {
  const backend = getBackend(keyVaultId(key))
  if (!backend || backend.readOnly) return null
  return backend
}

/**
 * Move one entry's file from its source vault to `toKey`'s vault, durably.
 *
 * **The ordering is the design.** The target's content is recorded as a local
 * edit — durable in Dexie, dirty, ready to push — and only then is the source's
 * delete staged. Both land in IndexedDB before either vault's push cycle runs,
 * so a crash, a lost tab or an offline window can at worst leave the entry
 * present in *both* remotes — visible, and recoverable by deleting one — never
 * absent from both. It mirrors the rule `sync.ts:resolveCollision` already
 * documents: the local content must be durable somewhere before the record
 * holding it is cleared, and an edit beats a delete.
 *
 * There is deliberately no undo. Two durable writes in two different vaults,
 * each with its own push cycle and its own failure modes, cannot be wound back
 * as one action — so the confirm dialog carries the weight instead (see
 * `moveLinkBreakage`, which tells the user what the move costs before it runs).
 *
 * `content` is the entry as it exists at `toKey`, handed in by `commitMove`
 * rather than resolved from the store here — see `EntityPersistence`. It used
 * to be read back out of the target vault's layer, which meant this function
 * could disagree with the commit that triggered it and had to carry its own
 * "the entry isn't in the target vault" guard, fired *after* the store was
 * already re-keyed. That decision now sits in `commitMove`, before it commits
 * anything.
 */
export async function moveEntityInCache(fromKey: EntryKey, toKey: EntryKey, content: string): Promise<void> {
  const from = writableBackend(fromKey)
  const to   = writableBackend(toKey)
  if (!from || !to) {
    notify('Move failed: both vaults must be registered and writable.')
    return
  }

  markInFlight(toKey)
  markInFlight(fromKey)
  try {
    await recordLocalEdit(to.id, keyToPath(toKey), content)
    await recordLocalDelete(from.id, keyToPath(fromKey))

    updateSyncUI(to)
    updateSyncUI(from)
    scheduleAutoPush(to)
    scheduleAutoPush(from)
  } catch (e) {
    console.error('[vault] moveEntityInCache failed:', e)
    notifyError('Move failed', e)
  } finally {
    clearInFlight(fromKey)
    clearInFlight(toKey)
  }
}
