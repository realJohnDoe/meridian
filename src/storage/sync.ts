import {
  recordLocalEdit, applyRemoteBatch, confirmDeleted, cacheGetDirty,
  setResolvedClean, markPushed, cacheDirtyCount, cacheLoadAll,
  recordLocalDelete, cacheGetTombstones,
} from '@/storage/cache/files'
import type { CacheRecord } from '@/storage/cache/files'
import { markInFlight, clearInFlight, getInFlightPaths } from '@/storage/inFlight'
import { conflictPath } from './conflictName'
import { ConflictError, AuthSyncError, isTransientSyncError } from './conflictError'
import type { StorageBackend, RawFile } from './backend'
import type { VaultKind } from '@/vaultRef'
import { collapseToYaml, parseToStoreItems, entryKeyItems, saveFile, roundTripLoss, type ParseResult } from '@/model'
import { pathToKey, keyToPath, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { runInIdleBatches } from '@/lib/idle'
import type { StoreItem, Roots } from '@/types'
import {
  getVaultLayer, setVaultLayer,
  setVaultSync,
  getUnreadableFiles, setUnreadableFiles,
} from '@/storeBridge'
import { notify, warn, notifyError } from './notifications'
import { getBackend, getMountedBackends } from './backends'

// ── HELPERS ────────────────────────────────────────────────────

/** Refresh one vault's row in `syncByVault` — its dirty count and read-only flag. */
export function updateSyncUI(backend: StorageBackend): void {
  if (backend.readOnly) {
    setVaultSync(backend.id, { dirtyCount: 0, readOnly: true })
    return
  }
  setVaultSync(backend.id, { readOnly: false })
  cacheDirtyCount(backend.id).then(n => setVaultSync(backend.id, { dirtyCount: n })).catch(() => {})
}

/** A file that failed to parse, keyed by its path (see `ParseFailure.key` for the store key). */
export interface ParseFailure {
  path:    string
  key:     EntryKey
  message: string
}

/** A file that loads fine but would lose frontmatter on save — see `roundTripLoss`. */
interface RoundTripLoss {
  path: string
  /** The `key=value` pairs a save would drop. Never empty. */
  lost: string[]
}

/**
 * Run the round-trip guard over every successfully-parsed file, spread across
 * idle periods, and report anything it finds.
 *
 * Split out of the `parseFiles` loop because it dominated it: on a 300-file
 * vault the guard measured 75% of the total parse cost (and 70 of its 92 ms was
 * the two extra `loadFile` calls it makes internally), all of it blocking the
 * agenda's first paint. Coverage is unchanged — every file is still checked,
 * and `reportRoundTripLosses` still toasts — only the timing moved. See
 * plans/time-to-today.md.
 *
 * Deliberately not cancellable from the outside: a sweep that started for a
 * vault which has since been switched away still reports a genuine defect in a
 * real file, and the check is a pure function of the (path, content, parsed)
 * triple it captured, so a later vault change cannot make its verdict wrong.
 */
function auditRoundTrip(parsed: Array<{ path: string; content: string; result: ParseResult }>): void {
  const lossy: RoundTripLoss[] = []
  runInIdleBatches(
    parsed,
    ({ path, content, result }) => {
      const lost = roundTripLoss(path, content, result)
      if (lost.length > 0) {
        lossy.push({ path, lost })
        console.warn('[vault] save would drop frontmatter from', path, lost)
      }
    },
    () => { reportRoundTripLosses(lossy) },
  )
}

export function parseFiles(
  files: Array<{ path: string; content: string }>,
  vaultId: string,
): { items: StoreItem[]; roots: Roots; failures: ParseFailure[]; auditRoundTrip: () => void } {
  const loaded: StoreItem[] = []
  const roots: Roots = new Map()
  const failures: ParseFailure[] = []
  const parsed: Array<{ path: string; content: string; result: ParseResult }> = []
  for (const { path, content } of files) {
    try {
      const result = parseToStoreItems(path, content, vaultId)
      loaded.push(...result.items)
      roots.set(pathToKey(vaultId, path), result.root)
      // The round-trip guard is deferred (see auditRoundTrip above), but the
      // parse it needs is kept here rather than redone: it is only sound on an
      // UNEDITED round trip — after an edit, an intentional change reads as a
      // "loss" — so it must see the file exactly as it was loaded.
      parsed.push({ path, content, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failures.push({ path, key: pathToKey(vaultId, path), message })
      console.warn('[vault] parse failed for', path, e)
    }
  }
  return { items: loaded, roots, failures, auditRoundTrip: () => { auditRoundTrip(parsed) } }
}

/**
 * Surface parse failures to the user. A `console.warn` alone (the old
 * behaviour) is invisible in a PWA with no open devtools — this is the one
 * user-visible signal that a hand-edited file silently dropped out of the
 * vault. Called after every full load and every reconcile merge that touches
 * a file which fails to parse.
 */
export function reportParseFailures(failures: ParseFailure[]): void {
  if (failures.length === 0) return
  const [first] = failures
  if (first && failures.length === 1) {
    warn(`Couldn't read ${first.path} — ${first.message}`)
    return
  }
  warn(`Couldn't read ${failures.length} files: ${failures.map(f => f.path).join(', ')}`)
}

/** Keys already reported this session, so a re-load or a reconcile touching the
 *  same file doesn't re-toast. Session-scoped by design: a reload is a fresh
 *  chance to notice, and this never grows beyond the number of affected files
 *  (expected: zero). */
const _reportedLossy = new Set<string>()

/**
 * Surface a file that loads fine but would lose frontmatter on save. Called
 * only by `auditRoundTrip` above, once its idle sweep finishes — the parse path
 * no longer reports losses inline, so this is module-private.
 *
 * This is a Meridian bug, not something the user did wrong — every known cause
 * is fixed and test-pinned — so the message says so and asks for a report
 * rather than offering a fix. Deliberately just a warning: it does not block
 * the write or quarantine the file. If this ever actually fires, that is the
 * point to decide whether it should. See `roundTripCheck.ts`.
 */
function reportRoundTripLosses(lossy: RoundTripLoss[]): void {
  const fresh = lossy.filter(l => !_reportedLossy.has(l.path))
  if (fresh.length === 0) return
  for (const l of fresh) _reportedLossy.add(l.path)

  const [first] = fresh
  if (first && fresh.length === 1) {
    // Cap the key list: a pathological file shouldn't produce a wall of text.
    const keys = first.lost.slice(0, 3).join(', ')
    const more = first.lost.length > 3 ? `, +${first.lost.length - 3} more` : ''
    warn(`Editing ${first.path} in Meridian would drop frontmatter (${keys}${more}). This is a bug — please report it.`)
    return
  }
  warn(`Editing these ${fresh.length} files in Meridian would drop frontmatter: ${fresh.map(f => f.path).join(', ')}. This is a bug — please report it.`)
}

// ── COLLISION RESOLUTION ───────────────────────────────────────────

/**
 * What a failed CAS write resolved to. `recreated` carries no `merges`: the
 * store already holds that content (it is where the dirty record came from),
 * so there is nothing to merge back into it.
 */
type CollisionOutcome =
  | { kind: 'copied'; copy: string; merges: Array<{ path: string; content: string }> }
  | { kind: 'recreated' }

/**
 * The version token to record for a path we just wrote.
 *
 * `StorageBackend.write` returns the new token only "if the backend can
 * determine it", so a bare `undefined` from it is not authoritative — and
 * recording `undefined` is actively harmful: the next edit to that file would
 * CAS with no precondition, which every backend reads as "must be absent", and
 * a file that plainly exists would conflict for no reason. Fall back to a read.
 */
async function versionAfterWrite(
  backend: StorageBackend,
  path: string,
  fromWrite: string | undefined,
): Promise<string | undefined> {
  if (fromWrite !== undefined) return fromWrite
  const [fresh] = await backend.readFiles([path])
  return fresh?.version
}

/**
 * Write `content` to a fresh conflict-copy path and return the path used.
 *
 * The write carries no `expectedVersion`, which every backend reads as
 * "create — the path must be absent". Two collisions on the same file inside
 * one second would otherwise generate the same name twice and the second write
 * would fail: `conflictPath` is second-granular, so the retry walks the
 * timestamp forward rather than appending a counter (a counter suffix would be
 * eaten by `conflictPath`'s own SUFFIX_RE the next time the copy conflicts).
 */
async function writeConflictCopy(
  backend: StorageBackend,
  path: string,
  content: string,
): Promise<{ copy: string; version?: string }> {
  let when = new Date()
  for (let attempt = 0; attempt < 5; attempt++) {
    const copy = conflictPath(path, when)
    try {
      const written = await backend.write(copy, content)
      return { copy, version: await versionAfterWrite(backend, copy, written) }
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      when = new Date(when.getTime() + 1000)
    }
  }
  throw new Error(`Could not find a free conflict-copy path for ${path}`)
}

/**
 * Handle a failed CAS write. Two outcomes, chosen by what the backend actually
 * holds now — which is why this re-reads rather than trusting the listing:
 *
 *  - **The remote diverged.** Someone else's content sits at `path`. Both sides
 *    are kept: the remote wins the path, the local content lands in a
 *    timestamped conflict copy.
 *  - **The remote is gone.** The file was deleted (or renamed) on another device
 *    while we held an unpushed edit. There is nothing to preserve from the other
 *    side, so the local content is re-created at its original path. Keeping the
 *    path is the point: a conflict copy would orphan every `[[wikilink]]`
 *    pointing at this slug, and re-deleting is one gesture where hunting down a
 *    stray copy and renaming it back is several.
 *
 * Both directions follow one rule — **an edit beats a delete** — which is the
 * same rule `pushDirty`'s tombstone branch already applies from the other side
 * (a remote edit landing after a local delete keeps the remote version). The
 * user is told either way, so a delete they meant can just be repeated.
 *
 * **Ordering is load-bearing.** The local content must be durable *somewhere*
 * before the dirty record holding it is cleared. The previous version reverted
 * the cache record to the remote copy first and wrote the conflict copy second,
 * so any failure in between — an offline blip, a rate-limited 403, an expired
 * token — destroyed the only copy of the edit while the UI reported "changes are
 * saved locally". See the data-integrity survey, finding #1.
 */
async function resolveCollision(
  backend: StorageBackend,
  vaultId: string,
  path: string,
  localContent: string,
): Promise<CollisionOutcome> {
  let [remote] = await backend.readFiles([path])

  if (!remote) {
    try {
      // No `expectedVersion`: the record's base version points at the blob that
      // was deleted, so this has to go out as a create, not a compare-and-swap.
      const written = await backend.write(path, localContent, undefined)
      // markPushed, not setResolvedClean: another edit may have landed during
      // the round trip above, and it must stay dirty rather than be stamped
      // clean under content it no longer holds.
      await markPushed(vaultId, path, localContent, await versionAfterWrite(backend, path, written))
      warn(`${path} was deleted on another device — your unsaved changes were restored. Delete it again if that was intended.`)
      return { kind: 'recreated' }
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      // Lost a race: the path was re-created between our two writes. Re-read and
      // fall through — there is remote content to preserve after all.
      ;[remote] = await backend.readFiles([path])
    }
  }

  // ── Diverged: copy out first, revert the original second ──────────────────
  const { copy, version: copyVersion } = await writeConflictCopy(backend, path, localContent)
  await setResolvedClean(vaultId, copy, localContent, copyVersion)
  const merges: Array<{ path: string; content: string }> = [{ path: copy, content: localContent }]

  if (remote) {
    await setResolvedClean(vaultId, path, remote.content, remote.version)
    merges.unshift({ path, content: remote.content })
  }

  warn(`Conflict on ${path} — your version saved as ${copy}.`)
  return { kind: 'copied', copy, merges }
}

// ── RECONCILE ─────────────────────────────────────────────────

/**
 * A cache record written this recently is not trusted to be absent from the
 * backend's listing: GitHub's git-trees API is eventually consistent and can
 * omit a just-pushed file for a while. Acting on that silence evicts the slug
 * from the store and breaks wikilinks pointing at it. The opposite error — a
 * file deleted on another device lingering locally a few extra minutes — is
 * invisible and benign, and barely ever fires: a genuinely remote-deleted file
 * has an old updatedAt, so the window is not even consulted for it.
 *
 * Deliberately applied to the delete branch only (see below) — not to the
 * changed branch, which confirms itself via a fresh read.
 */
const RECONCILE_DELETE_GRACE_MS = 5 * 60_000

/**
 * Pure reconciliation planner: given the backend's listing tokens and the local
 * cache records, decide which paths to pull (`changed`) and which to drop
 * (`deleted`). Extracted as a side-effect-free function so the branching logic
 * can be unit-tested without Dexie, a backend, or the store.
 */
export function planReconcile(
  diskTokens: Map<string, string>,
  cacheRecords: CacheRecord[],
  skipPaths: Set<string> = new Set(),
  now: number = Date.now(),
): { changed: string[]; deleted: string[] } {
  const cacheMap = new Map(cacheRecords.map(r => [r.path, r]))
  const changed: string[] = []
  const deleted: string[] = []

  for (const [path, diskToken] of diskTokens) {
    // Skip paths we authoritatively wrote/deleted in this same sync cycle: we
    // already hold their true state, and GitHub's listing API is eventually
    // consistent, so it may still report the pre-push SHA (or omit a just-created
    // file). Trusting it here would re-pull stale content over our fresh write.
    if (skipPaths.has(path)) continue
    const entry = cacheMap.get(path)
    // Pull a file the cache has never seen, OR one whose backend version drifted
    // while we hold no pending local change. Skip dirty entries (pending write)
    // and tombstones (pending delete) — any genuine divergence on those is caught
    // by the CAS write in pushDirty. Deliberately no grace-window check here:
    // this branch re-reads the file through a fresher endpoint (the Contents
    // API) before trusting anything, so a stale listing here costs a redundant
    // read rather than a wrong outcome.
    if (!entry || (entry.version !== diskToken && entry.status === 'clean')) {
      changed.push(path)
    }
  }
  for (const entry of cacheRecords) {
    if (skipPaths.has(entry.path)) continue
    // Drop locally-cached files that vanished from the backend — but don't
    // clobber pending local changes (dirty), pending deletes (tombstone), or a
    // file we wrote recently enough that the listing's silence about it isn't
    // trustworthy yet (see RECONCILE_DELETE_GRACE_MS). Unlike the changed
    // branch above, there is no confirming read here — deleting is the only
    // action available — so silence alone must not be enough to trigger it.
    const recentlyWritten = now - entry.updatedAt < RECONCILE_DELETE_GRACE_MS
    if (!diskTokens.has(entry.path) && entry.status === 'clean' && !recentlyWritten) deleted.push(entry.path)
  }

  return { changed, deleted }
}

/**
 * Merge freshly-fetched file records into `vaultId`'s store layer, keeping
 * items/roots for every other file — in this vault and every other one —
 * untouched. Each record's own key counts as affected automatically; pass
 * `alsoAffected` for keys to evict with no replacement record (e.g. a delete
 * with nothing to parse in its place).
 *
 * Reads and writes **one layer**, not the merge. Filtering `getItems()` (the
 * cross-vault merge) and writing the result back would fold every other
 * registered vault's entries into this vault's layer, and the next reconcile
 * for any of them would then re-flatten duplicates over the top. `vaultId` is
 * also what every path is resolved against, so an identically-slugged file in
 * another vault is never in this set to begin with.
 */
function mergeChangedIntoStore(
  vaultId: string,
  records: Array<{ path: string; content: string }>,
  alsoAffected: Iterable<EntryKey> = [],
): void {
  const affected = new Set(alsoAffected)
  for (const r of records) affected.add(pathToKey(vaultId, r.path))

  const layer     = getVaultLayer(vaultId)
  const keptItems = layer.items.filter(item => !affected.has(item.entryKey))
  const keptRoots: Roots = new Map(
    [...layer.roots].filter(([key]) => !affected.has(key)),
  )
  // `unreadableFiles` is genuinely cross-vault (one map keyed by EntryKey), but
  // the keys carry their vault, so filtering by `affected` only ever drops this
  // vault's entries.
  const keptUnreadable = new Map(
    [...getUnreadableFiles()].filter(([key]) => !affected.has(key)),
  )

  const { items: newItems, roots: newRoots, failures, auditRoundTrip } = parseFiles(records, vaultId)
  setVaultLayer(vaultId, {
    items: [...keptItems, ...newItems],
    roots: new Map([...keptRoots, ...newRoots]),
  })
  for (const f of failures) keptUnreadable.set(f.key, { path: f.path, message: f.message })
  setUnreadableFiles(keptUnreadable)
  reportParseFailures(failures)
  auditRoundTrip()
}

// Above this many changed paths, a per-file readFiles() fan-out risks the same
// secondary-rate-limit burst readAll() avoids on initial load — e.g. a
// collaborator's bulk push, or the first reconcile after a long offline
// stretch. Route through readAll()'s batched fetch instead in that case.
const LARGE_RECONCILE_THRESHOLD = 50

export async function reconcileWithBackend(
  backend: StorageBackend,
  vaultId: string,
  skipPaths: Set<string> = new Set(),
): Promise<void> {
  const diskTokens = await backend.statAll()
  // Deliberately re-read rather than reusing the snapshot activation already
  // loaded (hydrateFromCache): planReconcile branches on `status === 'clean'`
  // and on `updatedAt`, and the gap between that hydrate and this call is
  // unbounded (a token refresh, two round trips, and the user actively
  // editing the whole time). A stale snapshot could report a record as clean
  // that has since gone dirty — exactly what planReconcile's freshness checks
  // exist to prevent. Not an optimisation target.
  const cached     = await cacheLoadAll(vaultId)
  const cacheMap   = new Map(cached.map(r => [r.path, r]))

  // Union in any path with a write/delete currently in flight (see
  // markInFlight/getInFlightPaths in inFlight.ts) — snapshotted here, immediately
  // before planning, so it reflects everything in flight at the moment this
  // cycle decides.
  const inFlight = getInFlightPaths(vaultId)
  const effectiveSkip = inFlight.size === 0
    ? skipPaths
    : new Set([...skipPaths, ...inFlight])

  const { changed, deleted } = planReconcile(diskTokens, cached, effectiveSkip, Date.now())

  // Paths applyRemoteBatch actually wrote — it skips any path a local edit
  // or delete touched since the cacheLoadAll snapshot above (readFiles/readAll
  // below is a real await, and a genuine window). A skipped path's cache and
  // store both stay untouched this cycle rather than being merged from either
  // stale snapshot.
  let written = new Set<string>()
  if (changed.length > 0) {
    let freshFiles: RawFile[]
    if (changed.length > LARGE_RECONCILE_THRESHOLD) {
      const changedSet = new Set(changed)
      freshFiles = (await backend.readAll()).filter(f => changedSet.has(f.path))
    } else {
      freshFiles = await backend.readFiles(changed)
    }
    written = new Set(await applyRemoteBatch(vaultId, freshFiles))
    for (const f of freshFiles) {
      if (!written.has(f.path)) continue
      cacheMap.set(f.path, { vaultPath: `${vaultId}::${f.path}`, vaultId, path: f.path, content: f.content, status: 'clean', updatedAt: Date.now(), version: f.version })
    }
  }

  await Promise.all(deleted.map(p => confirmDeleted(vaultId, p)))
  for (const p of deleted) cacheMap.delete(p)

  // Cache writes above are keyed by vaultId and stay correct regardless — but
  // the store layer only exists while the vault is registered. Since activation
  // no longer awaits the first sync (see syncOnActivate), a sync started at
  // registration can still be in flight when the user removes that vault in
  // Settings; merging its results would resurrect a layer `removeVault` just
  // dropped. Under the layered store this is the only remaining hazard — a
  // *different* vault's content can no longer be painted over, because each
  // reconcile writes only its own layer.
  if (!getBackend(vaultId)) return

  const changedWritten = changed.filter(p => written.has(p))
  if (changedWritten.length === 0 && deleted.length === 0) { updateSyncUI(backend); return }

  // Parse only the changed files; deleted paths have no replacement record and
  // are evicted via alsoAffected.
  const changedRecords = changedWritten
    .map(p => cacheMap.get(p))
    .filter((r): r is NonNullable<typeof r> => r != null)
  const deletedKeys = deleted.map(p => pathToKey(vaultId, p))

  mergeChangedIntoStore(vaultId, changedRecords, deletedKeys)
  updateSyncUI(backend)
}

// ── SYNC CORE ─────────────────────────────────────────────────────────

/**
 * All of sync.ts's mutable state for **one** vault. PR 0 collected six
 * module-level singletons into this record; now there is one instance per
 * registered vault, so two vaults keep independent backoff, independent
 * debounce timers and independent error dedupe — a GitHub vault whose token
 * expired must not stall a local folder that is syncing fine.
 */
interface VaultSyncState {
  syncing: boolean
  pushTimer: ReturnType<typeof setTimeout> | null
  /**
   * Set when a push was requested (scheduleAutoPush's timer firing, or an
   * explicit flushPendingPush()) while a sync was already in flight. runSync's
   * early `if (syncing) return` would otherwise silently drop that request —
   * there's no rescheduling on that path today — stranding the write until the
   * next autoSyncTick. Re-armed from runSync's `finally` once the in-flight
   * sync settles.
   */
  pushQueued: boolean
  consecutiveFailures: number
  nextRetryAt: number
  /** Dedupe toasts for actionable (non-transient) errors across silent ticks. */
  lastErrorSig: string | null
  /**
   * When a cycle was last *attempted* for this vault — success or failure.
   * The scheduler's per-vault minimum interval is measured from here rather
   * than from `lastSyncedAt`, so a vault that keeps failing is paced the same
   * as one that keeps succeeding (the backoff below then spaces it out
   * further).
   */
  lastAttemptAt: number
}

function createVaultSyncState(): VaultSyncState {
  return {
    syncing: false, pushTimer: null, pushQueued: false,
    consecutiveFailures: 0, nextRetryAt: 0, lastErrorSig: null,
    lastAttemptAt: 0,
  }
}

const _syncStates = new Map<string, VaultSyncState>()

function syncStateFor(vaultId: string): VaultSyncState {
  let state = _syncStates.get(vaultId)
  if (!state) { state = createVaultSyncState(); _syncStates.set(vaultId, state) }
  return state
}

/** Forget a vault's sync state and cancel its pending debounce. Called on unmount. */
export function dropSyncState(vaultId: string): void {
  const state = _syncStates.get(vaultId)
  if (state?.pushTimer) clearTimeout(state.pushTimer)
  _syncStates.delete(vaultId)
}

/** Drop every vault's sync state. Tests only — production unmounts one at a time. */
export function dropAllSyncState(): void {
  for (const vaultId of [..._syncStates.keys()]) dropSyncState(vaultId)
}

// ── BACKOFF STATE ─────────────────────────────────────────────────────
const BACKOFF_BASE_MS  = 60_000
const BACKOFF_MAX_MS   = 30 * 60_000

/** Clear the retry backoff for every registered vault (e.g. the `online` event). */
export function resetSyncBackoff(): void {
  for (const state of _syncStates.values()) {
    state.consecutiveFailures = 0
    state.nextRetryAt         = 0
  }
}

/**
 * Push pending local changes to the backend. Returns whether a collision
 * occurred and the set of paths we authoritatively wrote/deleted this cycle —
 * the latter must be skipped by a same-cycle reconcile (see planReconcile),
 * since the backend's listing API is eventually consistent and may not yet
 * reflect these writes.
 */
async function pushDirty(
  backend: StorageBackend,
  vaultId: string,
): Promise<{ hadCollision: boolean; pushed: Set<string> }> {
  const dirty      = await cacheGetDirty(vaultId)
  const tombstones = await cacheGetTombstones(vaultId)
  const pushed     = new Set<string>()
  if (!dirty.length && !tombstones.length) return { hadCollision: false, pushed }

  let hadCollision = false
  // Path+content pairs resolveCollision produced this cycle — merged into the
  // store below instead of left to a same-cycle reconcile, which skips these
  // exact paths (see planReconcile's skipPaths) and would otherwise leave the
  // conflict copy invisible until a later reconcile happens to see it as
  // changed, or a full restart re-hydrates from cache.
  const collisionMerges: Array<{ path: string; content: string }> = []

  for (const f of dirty) {
    try {
      // CAS write: pass the base version as the precondition. The backend
      // throws ConflictError only when the content genuinely diverged — it
      // never false-positives due to stale listing tokens.
      const newVersion = await backend.write(f.path, f.content, f.version)
      // markPushed (not setResolvedClean): f.content was captured before
      // this network round trip, and another edit to this same path may have
      // landed in the meantime. An unconditional clean write would silently
      // discard that edit — see its doc comment in cache/files.ts.
      await markPushed(vaultId, f.path, f.content, newVersion)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        const outcome = await resolveCollision(backend, vaultId, f.path, f.content)
        hadCollision = true
        pushed.add(f.path)
        if (outcome.kind === 'copied') {
          pushed.add(outcome.copy)
          collisionMerges.push(...outcome.merges)
        }
        // 'recreated' contributes no merges: the store is already the source of
        // this content, so there is nothing to merge back into it.
      } else {
        throw e
      }
    }
  }

  for (const f of tombstones) {
    try {
      // Pass the cached version (blob SHA for GitHub) so the delete works even
      // when the backend's in-memory SHA cache is cold after a page reload.
      await backend.delete(f.path, f.version)
      await confirmDeleted(vaultId, f.path)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        // The file was edited remotely after our tombstone was staged.
        // Drop the tombstone without deleting anything — leaving no cache
        // entry behind — and let this cycle's reconcile (triggered below via
        // hadCollision) pull the remote edit back in, so it isn't silently
        // destroyed. Deliberately NOT added to `pushed`: that set skips
        // reconcile's re-pull, and here we want the opposite.
        await confirmDeleted(vaultId, f.path)
        hadCollision = true
        warn(`${f.path} was edited remotely — kept the remote version instead of deleting.`)
      } else {
        throw e
      }
    }
  }

  if (collisionMerges.length > 0) mergeChangedIntoStore(vaultId, collisionMerges)

  return { hadCollision, pushed }
}

/**
 * Run one sync cycle for one vault.
 *
 * `backend` is threaded in explicitly by every caller (each of which looks it
 * up exactly once, at its own entry point) rather than looked up again here —
 * so a backend captured at the start of a call can never silently diverge from
 * what the registry would return by the time this runs.
 *
 * Concurrency is per vault: the `syncing` guard below is on this vault's own
 * state, so two vaults *can* be mid-cycle simultaneously if something drives
 * them that way. The scheduler deliberately does not (see `autoSyncTick`), but
 * a manual "Sync now" on one vault must not be swallowed just because another
 * vault happens to be reconciling.
 */
async function runSync(backend: StorageBackend, opts: { silent: boolean; pull: boolean }): Promise<void> {
  const vaultId    = backend.id
  const syncState  = syncStateFor(vaultId)

  if (backend.readOnly) {
    // Nothing to push, and (until the iCal vault kind lands) nothing to pull
    // either — the Tutorial vault is synthesized fresh on every load.
    if (!opts.silent) notify(`"${backend.name}" is read-only — there is nothing to sync.`)
    updateSyncUI(backend)
    return
  }
  if (syncState.syncing) return
  syncState.syncing       = true
  syncState.lastAttemptAt = Date.now()
  setVaultSync(vaultId, { inProgress: true })

  let attemptedRefresh = false

  try {
    // A single retry-after-refresh: a 401 here means the access token expired
    // or was revoked despite looking fresh locally (clock skew, early
    // revocation, etc.) — try one forced refresh before giving up. PAT-managed
    // vaults have no refresh token, so ensureFreshAccessToken(force) is a
    // no-op for them and the retry loop exits immediately via the thrown error.
    while (true) {
      try {
        const { hadCollision, pushed } = await pushDirty(backend, vaultId)
        if (opts.pull || hadCollision) {
          await reconcileWithBackend(backend, vaultId, pushed)
        }
        break
      } catch (e) {
        if (e instanceof AuthSyncError && !attemptedRefresh && backend.refreshAuth) {
          attemptedRefresh = true
          if (await backend.refreshAuth()) continue
        }
        throw e
      }
    }
    // ── SUCCESS ──────────────────────────────────────────────────
    setVaultSync(vaultId, { error: null, offline: false, lastSyncedAt: Date.now() })
    syncState.consecutiveFailures = 0
    syncState.nextRetryAt         = 0
    syncState.lastErrorSig        = null
    updateSyncUI(backend)
  } catch (e) {
    console.error(`[vault] sync failed for ${vaultId}:`, e)

    if (isTransientSyncError(e)) {
      // ── TRANSIENT (offline / network drop) ───────────────────
      setVaultSync(vaultId, { offline: true })
      syncState.consecutiveFailures++
      syncState.nextRetryAt = Date.now() + Math.min(
        BACKOFF_BASE_MS * Math.pow(2, syncState.consecutiveFailures - 1),
        BACKOFF_MAX_MS,
      )
      if (!opts.silent) {
        notify("You're offline — changes are saved locally and will sync when you reconnect.")
      }
    } else {
      // ── ACTIONABLE (auth, repo missing, etc.) ────────────────
      const msg = (e as Error).message || (e as Error).name || 'Unknown error'
      setVaultSync(vaultId, { error: msg })
      // Dedupe per vault, and name the vault: with several registered, "Sync
      // failed" alone leaves the user guessing which one needs attention.
      if (!opts.silent || syncState.lastErrorSig !== msg) {
        notifyError(`Sync failed for "${backend.name}"`, e)
        syncState.lastErrorSig = msg
      }
    }
  } finally {
    syncState.syncing = false
    setVaultSync(vaultId, { inProgress: false })
    // A push that arrived mid-sync was queued (see attemptPush) instead of
    // dropped — re-arm the debounced push now that this sync has settled.
    if (syncState.pushQueued) { syncState.pushQueued = false; scheduleAutoPush(backend) }
  }
}

/** Push one vault's pending local changes, or queue the request if its sync is already running. */
function attemptPush(backend: StorageBackend): void {
  const syncState = syncStateFor(backend.id)
  if (syncState.syncing) { syncState.pushQueued = true; return }
  void runSync(backend, { silent: true, pull: false })
}

function scheduleAutoPush(backend: StorageBackend): void {
  if (backend.readOnly) return
  const syncState = syncStateFor(backend.id)
  if (syncState.pushTimer) clearTimeout(syncState.pushTimer)
  syncState.pushTimer = setTimeout(() => { syncState.pushTimer = null; attemptPush(backend) }, 1000)
}

/**
 * Push anything still dirty right now, in **every** registered vault —
 * bypassing the 1s debounce and without waiting for the next autoSyncTick.
 * Used to rescue writes stranded by a prior session (vault registration) or
 * about to be stranded by the page going away (tab hidden/backgrounded).
 *
 * Every vault, not just one: `pagehide` is the last moment anything runs, and
 * a vault skipped here keeps its edit stranded in Dexie until the next launch.
 * A no-op per vault when nothing is dirty — pushDirty returns immediately if
 * the cache has no dirty/tombstoned records — so this stays cheap.
 */
export function flushPendingPush(): void {
  for (const backend of getMountedBackends()) {
    if (!backend.readOnly) attemptPush(backend)
  }
}

/**
 * The first sync after a vault activates. Replaces the old
 * `reconcileWithBackend(...)` + `flushPendingPush()` pair at the activation
 * site, and is deliberately routed through runSync rather than calling
 * reconcile directly, because runSync is where all four of these live:
 *
 *  - pushDirty runs *before* reconcile and feeds its `pushed` set into
 *    planReconcile's skipPaths — the two used to be independent cycles racing
 *    each other over an eventually-consistent listing;
 *  - transient-vs-actionable classification (isTransientSyncError) and the
 *    retry backoff, so an offline activation degrades instead of throwing;
 *  - setLastSyncedAt — reconcileWithBackend never set it, which is why
 *    SyncButton read "Not synced yet" for 60s after every startup;
 *  - the retry-after-401 forced token refresh.
 *
 * `silent: true`: an offline start must not toast. The backoff is reset
 * first — a fresh activation is a deliberate user-visible moment and deserves
 * an attempt regardless of the previous session's failures.
 *
 * Never rejects (runSync swallows everything in its own catch), so callers can
 * fire-and-forget without risking an unhandled rejection.
 */
export async function syncOnActivate(backend: StorageBackend): Promise<void> {
  const state = syncStateFor(backend.id)
  state.consecutiveFailures = 0
  state.nextRetryAt         = 0
  await runSync(backend, { silent: true, pull: true })
}

// ── SCHEDULER ─────────────────────────────────────────────────────────

/**
 * How long a vault of each kind waits between automatic cycles.
 *
 * Per kind because the cost of a cycle is not the same for all of them: a
 * local folder's `statAll` is a cheap filesystem walk, a GitHub vault's is a
 * network round trip against a rate-limited API. Unknown kinds (the iCal one
 * lands next) get the conservative default rather than the aggressive one.
 */
const MIN_SYNC_INTERVAL_MS: Partial<Record<VaultKind, number>> = {
  local:  30_000,
  github: 60_000,
}
const DEFAULT_MIN_SYNC_INTERVAL_MS = 15 * 60_000

/**
 * The base tick is 60s, so an interval of exactly 60s would be skipped roughly
 * every other tick on timer drift alone. Treat a vault as due slightly early
 * rather than letting it slip to 120s.
 */
const DUE_TOLERANCE_MS = 5_000

function isDue(backend: StorageBackend, now: number): boolean {
  const state = syncStateFor(backend.id)
  if (now < state.nextRetryAt) return false
  const elapsed = now - state.lastAttemptAt
  // A wall clock that jumped backwards (a device correcting its time, a
  // timezone-less NTP step) would otherwise park `lastAttemptAt` in the future
  // and starve this vault until the clock caught up. Treat it as due instead:
  // one extra cycle costs nothing, a stranded vault costs the user their sync.
  if (elapsed < 0) return true
  const interval = MIN_SYNC_INTERVAL_MS[backend.kind] ?? DEFAULT_MIN_SYNC_INTERVAL_MS
  return elapsed + DUE_TOLERANCE_MS >= interval
}

/** True while a scheduler pass is walking the vaults, so passes never overlap. */
let _tickRunning = false

/**
 * One scheduler pass over every registered vault.
 *
 * **Oldest-synced first, one at a time.** Serial rather than parallel on
 * purpose: each `GitHubBackend` owns its own throttled Octokit client, so
 * nothing coordinates bursts across vaults — the same secondary-rate-limit
 * concern that already makes `reconcileWithBackend` switch to `readAll()`
 * above 50 changed paths. It also keeps mobile wake cost flat as vaults are
 * added: N vaults cost N cycles spread over time, not N simultaneous bursts.
 *
 * Ordering by last attempt means a vault that has been waiting longest goes
 * first, so no vault can be starved by a chattier one ahead of it. Vaults
 * whose own minimum interval hasn't elapsed, and vaults inside their retry
 * backoff, are skipped rather than queued.
 *
 * Re-entrancy: a tick that is still walking (a slow vault mid-cycle when the
 * next 60s interval fires, or a `visibilitychange` landing on top of the
 * timer) returns immediately instead of starting a second interleaved walk.
 */
export function autoSyncTick(): void {
  if (_tickRunning) return
  _tickRunning = true
  void (async () => {
    try {
      const due = getMountedBackends()
        .filter(b => !b.readOnly)
        .sort((a, b) => syncStateFor(a.id).lastAttemptAt - syncStateFor(b.id).lastAttemptAt)
      for (const backend of due) {
        // Re-checked per vault rather than filtered up front: an earlier
        // vault's cycle can take long enough for a later one to fall due, and
        // for the registry to change underneath us.
        if (!getBackend(backend.id)) continue
        if (!isDue(backend, Date.now())) continue
        await runSync(backend, { silent: true, pull: true })
      }
    } finally {
      _tickRunning = false
    }
  })()
}

/**
 * Manual "Sync now". With a vault id, that vault; without, every registered
 * writable vault in turn — the topbar button speaks for the whole app, the
 * per-vault rows in its popover speak for one.
 *
 * Always bypasses the backoff gate: an explicit user gesture is a deliberate
 * "try again now".
 */
export async function syncToBackend(vaultId?: string): Promise<void> {
  const targets = vaultId
    ? [getBackend(vaultId)].filter((b): b is StorageBackend => !!b)
    : getMountedBackends().filter(b => !b.readOnly)

  if (targets.length === 0) {
    notify('No writable vault connected. Add a local folder first.')
    return
  }
  for (const backend of targets) {
    syncStateFor(backend.id).nextRetryAt = 0
    await runSync(backend, { silent: false, pull: true })
  }
}

// ── CACHE WRITE / DELETE ──────────────────────────────────────
//
// The in-flight write registry (markInFlight/clearInFlight/getInFlightPaths)
// lives in inFlight.ts — pure in-memory bookkeeping overlaying the persisted
// status; see its doc comment there for why marking is refcounted.

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

export async function writeEntityToCache(entryKey: EntryKey): Promise<void> {
  const path = keyToPath(entryKey)
  markInFlight(entryKey)
  try {
    const backend = backendFor(entryKey)
    if (!backend || backend.readOnly) return
    // This vault's layer, not the merge. Correctness doesn't hinge on it —
    // `EntryKey` is unique across vaults, so the merge would find the same
    // items — but scanning it would make every save's cost grow with the total
    // number of registered vaults, and the file being written only ever lives
    // in one of them.
    const layer      = getVaultLayer(backend.id)
    const slugItems  = entryKeyItems(layer.items, entryKey)
    const root       = layer.roots.get(entryKey)
    if (slugItems.length === 0) {
      // Only genuinely delete when the root is gone too (the real
      // deleteByFileSlug outcome). getItems()/getRoots() here can be a
      // snapshot that lags the commit that triggered this call — e.g. a
      // second setData landing in between — so a root surviving with zero
      // items is a transient inconsistency, not a real delete. Treating it as
      // one would silently tombstone a brand-new item whose creating commit
      // just hadn't landed in this snapshot yet. Skip: a subsequent commit
      // will write the real content.
      if (!root) { await deleteFromBackend(entryKey); return }
      console.warn('[vault] writeEntityToCache: skipping — root exists but no items yet for', entryKey)
      return
    }
    const frontmatter = collapseToYaml(slugItems, root)
    const body        = root?.body ?? ''
    const content     = saveFile(frontmatter, body, root?.fileConvention)
    await recordLocalEdit(backend.id, path, content)
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
    if (!backend || backend.readOnly) return
    await recordLocalDelete(backend.id, path)
    updateSyncUI(backend)
    scheduleAutoPush(backend)
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  } finally {
    clearInFlight(entryKey)
  }
}
