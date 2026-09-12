import { pendingMovesLoad, pendingMoveDrop } from '@/storage/cache/pendingMoves'
import type { PendingMove } from '@/storage/cache/pendingMoves'
import { cacheGetRecord, confirmDeleted } from '@/storage/cache/files'
import { keyToPath, keySlug, keyVaultId } from '@/fileIO'
import { warn } from './notifications'
import { getBackend } from './backends'
import { journal } from './syncJournal'
import { updateSyncUI } from './syncUI'

// ── CROSS-VAULT MOVES ─────────────────────────────────────────────────

/**
 * Decide the fate of every staged cross-vault move whose outcome is now known.
 *
 * A move (see `moveEntry.ts`) leaves the source's tombstone staged but held:
 * `pushDirty` won't send it, so the entry survives in the source's remote
 * while the target's copy is still only local. This is what un-holds it — or,
 * when the target's copy turns out never to have become durable, what puts the
 * entry back.
 *
 * The question is asked of the *target's cache record*, not of a push result,
 * so it answers the same way after a reload as it does in the cycle that
 * pushed: `dirty` means still waiting, anything else means the target's remote
 * has it. A move whose confirming push landed seconds before the tab closed
 * would otherwise be held forever — the record it was waiting on is clean, and
 * a clean record is never pushed again.
 *
 * Never throws: a move that cannot be settled stays staged, which is the safe
 * state, and must not take the surrounding sync cycle down with it.
 *
 * Releasing a move frees the source vault's held delete, which then wants a
 * push — but "ask for a push" is the scheduler's word, and the scheduler is
 * downstream of this file. So the ids of the vaults that need one are
 * collected into `released` and handed back up through `runSync` for the
 * scheduler to act on, the same way `runSync`'s own return value already
 * hands back the mid-cycle push drain. Nothing here calls upward.
 */
export async function settlePendingMoves(released: Set<string>): Promise<void> {
  let moves: PendingMove[]
  try {
    moves = await pendingMovesLoad()
  } catch (e) {
    console.error('[vault] could not read staged moves:', e)
    return
  }
  for (const move of moves) {
    try {
      await settleMove(move, released)
    } catch (e) {
      console.error('[vault] could not settle move', move.id, e)
    }
  }
}

async function settleMove(move: PendingMove, released: Set<string>): Promise<void> {
  const toVault = keyVaultId(move.toKey)
  // The target vault being gone is the same verdict as its record being gone:
  // removing a vault clears its cache, so either way nothing durable is left
  // holding the entry at the target end.
  const target = getBackend(toVault)
    ? await cacheGetRecord(toVault, keyToPath(move.toKey))
    : undefined
  if (!target) { await abandonMove(move); return }
  // Still local-only at the target — keep holding.
  if (target.status === 'dirty') return
  // `clean` is the ordinary confirmation. `deleted` counts too: the user
  // deleted the moved entry at its new home, so resurrecting the source copy
  // by abandoning here would undo a deliberate delete.
  await releaseMove(move, released)
}

/**
 * The target's remote has the entry — let the source's delete go out.
 *
 * Records the source vault in `released` rather than scheduling its push here;
 * see `settlePendingMoves` for why the request travels upward instead.
 */
async function releaseMove(move: PendingMove, released: Set<string>): Promise<void> {
  await pendingMoveDrop(move.id)
  const fromVault = keyVaultId(move.fromKey)
  journal('move-released', fromVault, keyToPath(move.fromKey), { note: move.id })
  const from = getBackend(fromVault)
  if (!from || from.readOnly) return
  updateSyncUI(from)
  released.add(from.id)
}

/**
 * Nothing durable ever reached the target — undo the source half instead.
 *
 * The tombstone is *removed*, not pushed and not rewritten: with no copy at
 * the target, deleting the source's remote file is the one outcome this whole
 * mechanism exists to prevent. Removing the record entirely (rather than, say,
 * marking it dirty) is also what brings the entry back into view — the store
 * was re-keyed into the target vault when the move committed, and the next
 * reconcile of the source vault treats a path the cache has never seen as new
 * and pulls it in, root and items.
 */
async function abandonMove(move: PendingMove): Promise<void> {
  await pendingMoveDrop(move.id)
  const fromVault = keyVaultId(move.fromKey)
  const fromPath  = keyToPath(move.fromKey)
  journal('move-abandoned', fromVault, fromPath, { note: move.id })
  const record = await cacheGetRecord(fromVault, fromPath)
  if (record?.status === 'deleted') await confirmDeleted(fromVault, fromPath)
  const from = getBackend(fromVault)
  if (!from) return
  updateSyncUI(from)
  warn(`Couldn't finish moving "${keySlug(move.fromKey)}" — it's still in "${from.name}".`)
}
