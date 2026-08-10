// ── In-flight write registry ──────────────────────────────────
//
// Pure in-memory bookkeeping — no IndexedDB, which is why it lives beside the
// cache rather than inside it.
//
// Paths with a cache write/delete in flight — marked synchronously, before
// sync.ts's writeEntityToCache/deleteFromBackend reach their first await, so
// the interval between `setData` updating the store and Dexie recording a
// dirty/deleted status is never observable to a concurrent reconcile.
// Without this, a reconcile landing in that interval sees a clean status and
// can merge remote content over an edit still only in the store — or, worse,
// resurrect a note whose delete is still in flight: mergeChangedIntoStore
// would re-add it to the store and nothing would ever evict it again.
//
// Refcounted rather than a Set: two commits for the same slug can overlap
// (e.g. rapid checkbox toggles), and writeEntityToCache's self-heal path
// nests a deleteFromBackend call for the same path. In both cases a plain
// Set's cleanup would clear the shared mark as soon as either call settles,
// while the other is still outstanding — a structural gap even though
// today's planReconcile happens to guard the same records another way once
// one write has actually landed (see its own status!=='clean' checks). The
// refcount removes the dependence on that coincidence.
const _inFlightPaths = new Map<string, number>()

export function markInFlight(path: string): void {
  _inFlightPaths.set(path, (_inFlightPaths.get(path) ?? 0) + 1)
}

export function clearInFlight(path: string): void {
  const n = (_inFlightPaths.get(path) ?? 0) - 1
  if (n > 0) _inFlightPaths.set(path, n)
  else _inFlightPaths.delete(path)
}

/** Snapshot of paths currently in flight — for a reconcile to union into its skipPaths. */
export function getInFlightPaths(): ReadonlySet<string> {
  return new Set(_inFlightPaths.keys())
}
