import { recordLocalEdit, recordLocalDelete } from '@/storage/cache/files'
import { pendingMoveAdd } from '@/storage/cache/pendingMoves'
import { markInFlight, clearInFlight } from '@/storage/inFlight'
import { keyToPath, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { StorageBackend } from './backend'
import { getBackend } from './backends'
import { updateSyncUI } from './sync'
import { scheduleAutoPush } from './syncScheduler'
import { journal } from './syncJournal'
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
 * **The ordering is the design.** Two Dexie vault layers and two independent
 * remotes cannot be written as one transaction, so the move is *staged* rather
 * than attempted atomically, in three steps that each hold the line if the
 * next never runs:
 *
 * 1. The target's content is recorded as a local edit — durable in Dexie,
 *    dirty, ready to push.
 * 2. A `PendingMove` records that the source's delete is **held**. This is
 *    persisted, not in memory, because the thing it outlives is a reload.
 * 3. The source's tombstone is staged. It hides the entry from the source
 *    vault immediately, exactly as it always did, but `pushDirty` subtracts
 *    held paths from the tombstones it sends, so the *remote* delete does not
 *    go out yet.
 *
 * The source's remote copy is only deleted once the target vault's own remote
 * confirms the new one (`settlePendingMoves` in `sync.ts`), so at no point do
 * both remotes hold the entry and at no point does neither. A crash, a lost
 * tab, an offline target vault or a 30-minute push backoff all park the move
 * mid-flight instead of resolving it wrongly: the entry stays whole in the
 * source remote, and the hold is still there to be settled on the next cycle.
 * If the target's copy turns out never to have become durable at all, the move
 * is abandoned and the source's tombstone dropped — the entry comes back where
 * it started rather than disappearing from both.
 *
 * Both halves are journalled under the move's `id` as a correlation id, so a
 * dump shows which staged move a later release or abandonment belongs to —
 * the two writes are no longer independent events with no way to discover
 * each other's outcome.
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
    // Before the tombstone, never after: a hold that isn't durable yet when
    // the tombstone is would leave the source's delete free to go out on the
    // very next push, which is the two-write race this replaces.
    const move = await pendingMoveAdd(fromKey, toKey)
    await recordLocalDelete(from.id, keyToPath(fromKey))
    journal('move-staged', to.id,   keyToPath(toKey),   { note: move.id }, to.kind)
    journal('move-staged', from.id, keyToPath(fromKey), { note: move.id }, from.kind)

    updateSyncUI(to)
    updateSyncUI(from)
    // Both vaults, even though the source has nothing to send yet: the source's
    // own cycle is what re-evaluates the hold, and it may have unrelated edits
    // of its own waiting. The held tombstone stays behind either way.
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
