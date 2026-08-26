import { cacheInit } from './db'
import { isEntryKey, keyToPath, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'

// The staged half of a cross-vault move, kept in the `meta` table alongside
// the vault list and the credentials. It lives in Dexie rather than in memory
// for the reason the whole mechanism exists: the window between "the target
// vault has the entry" and "the target vault's remote has the entry" is a
// network round trip that a closed tab, a reload or an offline stretch can
// outlast, and a hold that evaporates with the tab would release the source's
// delete at exactly the moment nothing else holds the content.

/**
 * A cross-vault move whose source-side delete has been staged but must not be
 * sent yet.
 *
 * Two vault layers and two independent remotes cannot be written atomically,
 * so the move is ordered instead: the target's copy is made durable first, its
 * tombstone in the source is staged but **held**, and only once the target's
 * own remote confirms the copy is the delete released (`settlePendingMoves` in
 * `storage/sync.ts`). Until then the entry exists in exactly one remote — the
 * source's — which is the invariant a raw two-write move cannot offer.
 *
 * `id` is also the correlation id both halves' journal events carry, so a dump
 * shows which staged move a later release or abandonment belongs to.
 */
export interface PendingMove {
  id:        string
  /** Where the entry came from — the vault whose remote delete is held. */
  fromKey:   EntryKey
  /** Where it went — the vault whose push has to confirm before that delete fires. */
  toKey:     EntryKey
  startedAt: number
}

const META_KEY = 'pendingMoves'

/** Short, sortable, and readable in a journal line — not a security token. */
function newMoveId(): string {
  return `mv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Rejects anything that isn't a well-formed move — the same posture
 * `vaultRefsLoad` takes. A half-written or hand-edited record here would hold
 * a delete forever against a key nothing can resolve, so a malformed entry is
 * dropped (releasing that delete on the next cycle) rather than kept.
 */
function isPendingMove(v: unknown): v is PendingMove {
  if (!v || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  return typeof m['id'] === 'string'
    && typeof m['fromKey'] === 'string' && isEntryKey(m['fromKey'])
    && typeof m['toKey']   === 'string' && isEntryKey(m['toKey'])
    && typeof m['startedAt'] === 'number'
}

export async function pendingMovesLoad(): Promise<PendingMove[]> {
  const d = await cacheInit()
  const record = await d.meta.get(META_KEY)
  const v = record?.value
  return Array.isArray(v) ? v.filter(isPendingMove) : []
}

/**
 * Stage a move's hold and return it, id and all. Read-modify-write inside one
 * transaction: two moves committed back-to-back must not lose one another's
 * hold, and losing one means releasing a delete with nothing durable behind it.
 */
export async function pendingMoveAdd(fromKey: EntryKey, toKey: EntryKey): Promise<PendingMove> {
  const move: PendingMove = { id: newMoveId(), fromKey, toKey, startedAt: Date.now() }
  const d = await cacheInit()
  await d.transaction('rw', d.meta, async () => {
    const record = await d.meta.get(META_KEY)
    const existing = Array.isArray(record?.value) ? record.value.filter(isPendingMove) : []
    await d.meta.put({ key: META_KEY, value: [...existing, move] })
  })
  return move
}

/** Forget one move — its delete is released, or the move was abandoned. */
export async function pendingMoveDrop(id: string): Promise<void> {
  const d = await cacheInit()
  await d.transaction('rw', d.meta, async () => {
    const record = await d.meta.get(META_KEY)
    const existing = Array.isArray(record?.value) ? record.value.filter(isPendingMove) : []
    await d.meta.put({ key: META_KEY, value: existing.filter(m => m.id !== id) })
  })
}

/**
 * The paths in `vaultId` whose staged delete is being held by a move.
 * `pushDirty` subtracts these from the tombstones it sends.
 */
export async function heldDeletePaths(vaultId: string): Promise<ReadonlySet<string>> {
  const paths = new Set<string>()
  for (const move of await pendingMovesLoad()) {
    if (keyVaultId(move.fromKey) === vaultId) paths.add(keyToPath(move.fromKey))
  }
  return paths
}
