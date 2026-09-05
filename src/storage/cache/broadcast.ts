/**
 * The one fact a second view of the same vault cannot learn from IndexedDB:
 * that a row changed.
 *
 * Two tabs (or a tab plus the installed PWA) share one Dexie database but not
 * one in-memory store. Every cache write is therefore invisible to the other
 * views until something re-reads the row — which, before this existed, only a
 * reload or a re-registration ever did. That is not merely a staleness
 * problem: the second view's next save inherits the `version` token the first
 * view's push just wrote into the shared row, so its compare-and-swap passes
 * against content it has never seen and the first view's edit is destroyed
 * with no conflict, no copy and no message (data-integrity survey 2026-09-05,
 * finding #2).
 *
 * So the rows that change are announced. This module is the announcement and
 * nothing else: **it carries paths, never content and never store state.** The
 * cache is the bottom of the storage layer — below `sync.ts`, far below the
 * store — and a listener that reached back up into either from here would be
 * the cycle invariant 4 forbids. Subscribers re-read the rows they are told
 * about and decide for themselves what to do with them; see
 * `startCrossTabSync` in `../sync.ts`, which is the only one today.
 *
 * `BroadcastChannel` never delivers a message to the object that posted it, so
 * one channel object per tab is all the self-filtering this needs — a tab's own
 * writes are already in its own store.
 */

/** Rows in one vault whose *content* moved. Paths, not keys: the cache is
 *  keyed by path, and only the store speaks `EntryKey`. */
export interface CacheChange {
  vaultId: string
  paths:   string[]
}

type CacheChangeListener = (change: CacheChange) => void

const CHANNEL_NAME = 'meridian-cache'

/** `undefined` = not looked at yet; `null` = this environment has no
 *  BroadcastChannel (older WebViews, a non-DOM test env) and never will. */
let _channel: BroadcastChannel | null | undefined
const _listeners = new Set<CacheChangeListener>()

function channel(): BroadcastChannel | null {
  if (_channel !== undefined) return _channel
  _channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  _channel?.addEventListener('message', onMessage)
  return _channel
}

/**
 * Validate before handing anything on. The sender is our own code on our own
 * origin, but not necessarily our own *version* of it: a tab left open across
 * a deploy posts whatever shape it was built with. A malformed message is
 * dropped rather than allowed to throw inside a listener that would then never
 * hear the well-formed ones.
 */
function asCacheChange(data: unknown): CacheChange | null {
  if (typeof data !== 'object' || data === null) return null
  const { vaultId, paths } = data as Partial<CacheChange>
  if (typeof vaultId !== 'string' || !Array.isArray(paths)) return null
  const clean = paths.filter((p): p is string => typeof p === 'string')
  return clean.length > 0 ? { vaultId, paths: clean } : null
}

function onMessage(e: MessageEvent<unknown>): void {
  const change = asCacheChange(e.data)
  if (!change) return
  for (const fn of _listeners) fn(change)
}

/**
 * Tell the other views that these paths' content changed.
 *
 * Call it *after* the Dexie transaction commits, never inside one: a listener
 * in another tab re-reads the row the moment it hears, and announcing a write
 * that has not landed yet would hand it the pre-write content and no second
 * chance.
 *
 * Silent when nothing changed (`paths` empty) and silent where the API is
 * absent — cross-tab coherence is an improvement on the single-tab behaviour,
 * not a precondition for it, so a browser without it keeps working exactly as
 * before rather than failing a save.
 */
export function publishCacheChange(vaultId: string, paths: readonly string[]): void {
  if (paths.length === 0) return
  const ch = channel()
  if (!ch) return
  try {
    ch.postMessage({ vaultId, paths: [...paths] } satisfies CacheChange)
  } catch (e) {
    // A closed channel (page teardown) or a structured-clone failure must not
    // take a save down with it — the write itself has already committed.
    console.warn('[vault] could not announce a cache change:', e)
  }
}

/** Subscribe to other views' cache writes. Returns the unsubscribe. */
export function onCacheChange(fn: CacheChangeListener): () => void {
  channel()
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}
