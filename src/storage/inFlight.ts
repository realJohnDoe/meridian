import { keyVaultId, keyToPath } from '@/fileIO'
import type { EntryKey } from '@/fileIO'

// ── In-flight write registry ──────────────────────────────────
//
// Pure in-memory bookkeeping — no IndexedDB, which is why it lives beside the
// cache rather than inside it.
//
// Entries with a cache write/delete in flight — marked synchronously, before
// sync.ts's writeEntityToCache/deleteFromBackend reach their first await, so
// the interval between the store update and Dexie recording a dirty/deleted
// status is never observable to a concurrent reconcile.
// Without this, a reconcile landing in that interval sees a clean status and
// can merge remote content over an edit still only in the store — or, worse,
// resurrect a note whose delete is still in flight: mergeChangedIntoStore
// would re-add it to the store and nothing would ever evict it again.
//
// Keyed by `EntryKey`, not by bare path: with several vaults registered at
// once, two of them can hold the same path, and a bare-path registry would
// let one vault's in-flight write suppress the other vault's reconcile of an
// unrelated file. `getInFlightPaths(vaultId)` projects back down to the paths
// one vault's reconcile actually plans against.
//
// Refcounted rather than a Set: two commits for the same entry can overlap
// (e.g. rapid checkbox toggles), and writeEntityToCache's self-heal path
// nests a deleteFromBackend call for the same entry. In both cases a plain
// Set's cleanup would clear the shared mark as soon as either call settles,
// while the other is still outstanding — a structural gap even though
// today's planReconcile happens to guard the same records another way once
// one write has actually landed (see its own status!=='clean' checks). The
// refcount removes the dependence on that coincidence.
const _inFlight = new Map<EntryKey, number>()

export function markInFlight(key: EntryKey): void {
  _inFlight.set(key, (_inFlight.get(key) ?? 0) + 1)
}

export function clearInFlight(key: EntryKey): void {
  const n = (_inFlight.get(key) ?? 0) - 1
  if (n > 0) _inFlight.set(key, n)
  else _inFlight.delete(key)
}

/** Snapshot of `vaultId`'s in-flight paths — for that vault's reconcile to union into its skipPaths. */
export function getInFlightPaths(vaultId: string): ReadonlySet<string> {
  const paths = new Set<string>()
  for (const key of _inFlight.keys()) {
    if (keyVaultId(key) === vaultId) paths.add(keyToPath(key))
  }
  return paths
}
