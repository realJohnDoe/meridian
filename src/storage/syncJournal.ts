/**
 * A bounded, in-memory flight recorder for the sync pipeline.
 *
 * **Why this exists.** A conflict is a verdict about the *past*: "the backend
 * moved since the version this edit was based on". By the time the toast
 * appears, every input to that verdict — which version token we CASed against,
 * what the backend actually holds, which earlier push set that token, whether a
 * reconcile overwrote it in between — has been discarded. That makes a
 * spurious conflict (one with no second writer anywhere) unfalsifiable after
 * the fact, which is exactly the class of bug this records.
 *
 * **Why a ring buffer and not logging.** Meridian is a PWA. The interesting
 * conflicts happen on a phone, minutes into a session, with no devtools
 * attached — `console.warn` is written to nobody. A fixed-size in-memory ring
 * costs nothing while things go well and is still there to be *read* at the
 * moment something goes wrong (the conflict toast's "Copy details" action, or
 * `__meridianSync.dump()` from a remote-debugging console).
 *
 * **Deliberately not persisted.** Dexie is part of what this instruments; a
 * journal that writes to the same store it is auditing adds a failure mode
 * (and an unbounded table) to the path it is supposed to explain. The window
 * that matters is the current session — a conflict is always resolved within
 * seconds of the writes that caused it.
 *
 * **No file content, ever.** Entries carry a 32-bit content *hash* and a byte
 * length, never the bytes. The dump is meant to be pasteable into a bug report
 * without the user having to read their own notes first to check what is in it.
 */

import type { FailureKind } from './failureKind'

/** What happened. One kind per meaningful step in a file's journey to the backend. */
export type SyncEventKind =
  // ── local queue ───────────────────────────────────────────────
  | 'edit'                 // an edit was recorded in the cache (the write queue)
  | 'delete'               // a delete was staged (tombstone)
  | 'write-refused'        // a write/delete targeted a vault that is no longer registered
  // ── push ──────────────────────────────────────────────────────
  | 'push'                 // a CAS write went out
  | 'push-ok'              // …and was accepted
  | 'push-conflict'        // …and the backend refused the precondition
  | 'delete-push'          // a staged delete went out
  | 'delete-reread'        // no base version to CAS a delete against; re-read the current sha first
  | 'delete-ok'
  | 'delete-conflict'
  // ── cross-vault move (both halves share one correlation id in `note`) ──
  | 'move-staged'          // the target copy is durable; the source delete is staged but held
  | 'move-released'        // the target's remote confirmed the copy — the source delete may go out
  | 'move-abandoned'       // nothing durable at the target — the source's held delete was dropped
  // ── collision resolution (why a push-conflict resolved the way it did) ──
  | 'collision-already-landed'  // the backend already holds exactly our content
  | 'collision-retried'         // nothing had diverged — the CAS was retried and took
  | 'collision-recreated'       // the file was gone remotely; our content was restored
  | 'collision-merged'          // divergence on disjoint fields; both changes combined
  | 'collision-copied'          // divergence over the same ground; both sides kept
  // ── pull ──────────────────────────────────────────────────────
  | 'pull'                 // reconcile pulled fresh remote content over a clean record
  | 'drop'                 // reconcile evicted a record the backend no longer lists
  | 'version-repair'       // a backend that could not report its new token was re-read
  // ── auth ──────────────────────────────────────────────────────
  | 'auth-refresh'         // a stored GitHub credential was due (or forced) to rotate
  | 'auth-refreshed'       // …and it succeeded — the new token is stored
  | 'auth-failed'          // …and it did not — transiently, or the grant is dead

/**
 * Structured facts about one event. Deliberately flat and JSON-safe so the dump
 * is greppable and diffable — no nested objects, no Error instances.
 */
export interface SyncEventDetail {
  /** Version token the write was conditioned on (`undefined` = "must be absent"). */
  expected?:      string
  /** Version token the backend reports now / after the operation. */
  actual?:        string
  /** `hashContent` of the local content involved. */
  localHash?:     string
  /** `hashContent` of the backend's content, when it was read. */
  remoteHash?:    string
  /** Length in UTF-16 code units — a cheap second signal when hashes differ. */
  bytes?:         number
  /** Backend HTTP status, when the backend had one (GitHub 409 vs 422 read very differently). */
  status?:        number
  /** Why an `auth-failed` event failed — `'auth'` for a dead grant, `'transient'` for a blip. */
  kind?:          FailureKind
  /** The backend's own error text, trimmed. */
  reason?:        string
  /** Milliseconds since the last event for this same path, if any. */
  sincePrevMs?:   number
  /**
   * Free-form one-word note where the fields above don't fit — the conflict
   * copy's path, and the correlation id tying a cross-vault move's two halves
   * together (`move-staged` appears once per vault; the later `move-released`
   * or `move-abandoned` carries the same id).
   */
  note?:          string
}

export interface SyncEvent {
  /** `Date.now()` at the moment the event was recorded. */
  t:       number
  vaultId: string
  /** Backend kind (`local` / `github` / `ical` / `example`), when known. */
  backend?: string
  path?:   string
  kind:    SyncEventKind
  detail?: SyncEventDetail
}

/**
 * How many events are kept. A busy editing session produces roughly one event
 * per file per push cycle (~2.5s while typing), so this is on the order of ten
 * minutes of history — comfortably longer than the gap between the writes that
 * cause a conflict and the conflict itself, and small enough to be pasteable.
 */
const CAPACITY = 400

const _events: SyncEvent[] = []
/** Last event time per `vaultId::path`, for the `sincePrevMs` field. */
const _lastSeen = new Map<string, number>()

/** True when the user has opted into live console mirroring (see `setSyncDebug`). */
function debugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('meridian_debug_sync') === '1'
  } catch { return false }  // Safari private mode throws on localStorage access
}

/**
 * Turn live console mirroring of the journal on or off. Reached through the
 * `__meridianSync` global below rather than exported: nothing in the app calls
 * it, and a console is by definition attached when someone wants it. The
 * journal itself is always recording — this only decides whether each event is *also* printed as
 * it happens, which is what you want while trying to reproduce something.
 */
function setSyncDebug(on: boolean): void {
  try {
    if (on) localStorage.setItem('meridian_debug_sync', '1')
    else localStorage.removeItem('meridian_debug_sync')
  } catch { /* storage unavailable — the journal still records */ }
}

/**
 * FNV-1a, 32-bit, as base36. Not a checksum for correctness decisions — those
 * compare the content itself — just a short stable fingerprint that makes two
 * journal lines comparable at a glance ("same bytes went out twice").
 */
export function hashContent(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** Record one event. Never throws — the journal must not be able to break a sync. */
export function journal(
  kind:    SyncEventKind,
  vaultId: string,
  path?:   string,
  detail?: SyncEventDetail,
  backend?: string,
): void {
  const t = Date.now()
  let full = detail
  if (path) {
    const seenKey = `${vaultId}::${path}`
    const prev = _lastSeen.get(seenKey)
    if (prev !== undefined) full = { ...detail, sincePrevMs: t - prev }
    _lastSeen.set(seenKey, t)
  }
  const event: SyncEvent = { t, vaultId, kind, ...(backend ? { backend } : {}), ...(path ? { path } : {}), ...(full ? { detail: full } : {}) }
  _events.push(event)
  if (_events.length > CAPACITY) _events.splice(0, _events.length - CAPACITY)
  if (debugEnabled()) console.warn('[sync]', kind, path ?? vaultId, full ?? '')
}

/** Every recorded event, oldest first. Optionally narrowed to one path. */
export function syncJournalEvents(filter?: { path?: string; vaultId?: string }): SyncEvent[] {
  if (!filter) return [..._events]
  return _events.filter(e =>
    (filter.path === undefined || e.path === filter.path) &&
    (filter.vaultId === undefined || e.vaultId === filter.vaultId))
}

/**
 * A pasteable report: the events, newest last, with times rendered relative to
 * "now" so the reader sees *spacing* (the thing that matters when diagnosing a
 * race) instead of doing arithmetic on epoch millis.
 */
export function syncJournalDump(filter?: { path?: string; vaultId?: string }): string {
  const now = Date.now()
  const lines = syncJournalEvents(filter).map(e => {
    const ago = ((now - e.t) / 1000).toFixed(2).padStart(8)
    const where = [e.backend, e.path ?? e.vaultId].filter(Boolean).join(' ')
    const detail = e.detail
      ? ' ' + Object.entries(e.detail)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' ')
      : ''
    return `-${ago}s  ${e.kind.padEnd(24)} ${where}${detail}`
  })
  const header = `meridian sync journal — ${lines.length} event(s)${filter?.path ? ` for ${filter.path}` : ''}`
  return [header, ...lines].join('\n')
}

/** Tests only — production never needs to forget history mid-session. */
export function clearSyncJournal(): void {
  _events.length = 0
  _lastSeen.clear()
}

// Reachable from any attached console — including a remote-debugged phone,
// which is where these conflicts actually happen and where no other affordance
// (devtools filters, a dev-only route) is available.
try {
  ;(globalThis as unknown as Record<string, unknown>).__meridianSync = {
    dump:   (path?: string) => syncJournalDump(path ? { path } : undefined),
    events: syncJournalEvents,
    debug:  setSyncDebug,
  }
} catch { /* frozen global — the journal still records */ }
