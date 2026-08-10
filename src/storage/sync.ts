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
import { collapseToYaml, parseToStoreItems, fileSlugItems, saveFile, roundTripLoss } from '@/model'
import { pathToSlug, slugToPath } from '@/fileIO'
import type { StoreItem, Roots } from '@/types'
import {
  getItems, getRoots, setData,
  setSyncDirtyCount, setSyncError, setSyncOffline, setLastSyncedAt, getSyncError,
  setSyncInProgress, getUnreadableFiles, setUnreadableFiles,
} from '@/storeBridge'
import { notify, warn, notifyError } from './notifications'
import { getActiveBackend } from './activeBackend'

// ── HELPERS ────────────────────────────────────────────────────

export function updateSyncUI(): void {
  const backend = getActiveBackend()
  if (!backend?.id || backend.readOnly) {
    setSyncDirtyCount(0)
    setSyncError('Read-only vault')
    return
  }
  // Clear the read-only sentinel left over from a previous (read-only)
  // vault — but leave a real sync error (auth failure, etc.) in place so
  // it isn't wiped by an unrelated local edit.
  if (getSyncError() === 'Read-only vault') setSyncError(null)
  cacheDirtyCount(backend.id).then(n => setSyncDirtyCount(n)).catch(() => {})
}

/** A file that failed to parse, keyed by its path (see `ParseFailure.slug` for the store key). */
export interface ParseFailure {
  path:    string
  slug:    string
  message: string
}

/** A file that loads fine but would lose frontmatter on save — see `roundTripLoss`. */
export interface RoundTripLoss {
  path: string
  /** The `key=value` pairs a save would drop. Never empty. */
  lost: string[]
}

export function parseFiles(
  files: Array<{ path: string; content: string }>,
): { items: StoreItem[]; roots: Roots; failures: ParseFailure[]; lossy: RoundTripLoss[] } {
  const loaded: StoreItem[] = []
  const roots: Roots = new Map()
  const failures: ParseFailure[] = []
  const lossy: RoundTripLoss[] = []
  for (const { path, content } of files) {
    try {
      const parsed = parseToStoreItems(path, content)
      loaded.push(...parsed.items)
      roots.set(pathToSlug(path), parsed.root)
      // Expected to be empty for every file — see roundTripCheck.ts. Runs here
      // rather than at save because it is only sound on an UNEDITED round trip
      // (after an edit, an intentional change reads as a "loss"), and because
      // here it fires while the file on disk is still untouched.
      const lost = roundTripLoss(path, content, parsed)
      if (lost.length > 0) {
        lossy.push({ path, lost })
        console.warn('[vault] save would drop frontmatter from', path, lost)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failures.push({ path, slug: pathToSlug(path), message })
      console.warn('[vault] parse failed for', path, e)
    }
  }
  return { items: loaded, roots, failures, lossy }
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
 * Surface a file that loads fine but would lose frontmatter on save.
 *
 * This is a Meridian bug, not something the user did wrong — every known cause
 * is fixed and test-pinned — so the message says so and asks for a report
 * rather than offering a fix. Deliberately just a warning: it does not block
 * the write or quarantine the file. If this ever actually fires, that is the
 * point to decide whether it should. See `roundTripCheck.ts`.
 */
export function reportRoundTripLosses(lossy: RoundTripLoss[]): void {
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
 * Merge freshly-fetched file records into the store, keeping items/roots for
 * every other file untouched. Each record's own slug counts as affected
 * automatically; pass `alsoAffected` for slugs to evict with no replacement
 * record (e.g. a delete with nothing to parse in its place).
 */
function mergeChangedIntoStore(
  records: Array<{ path: string; content: string }>,
  alsoAffected: Iterable<string> = [],
): void {
  const affectedSlugs = new Set(alsoAffected)
  for (const r of records) affectedSlugs.add(pathToSlug(r.path))

  const keptItems = getItems().filter(item => !affectedSlugs.has(item.fileSlug))
  const keptRoots: Roots = new Map(
    [...getRoots()].filter(([slug]) => !affectedSlugs.has(slug)),
  )
  const keptUnreadable = new Map(
    [...getUnreadableFiles()].filter(([slug]) => !affectedSlugs.has(slug)),
  )

  const { items: newItems, roots: newRoots, failures, lossy } = parseFiles(records)
  setData({ items: [...keptItems, ...newItems], roots: new Map([...keptRoots, ...newRoots]) })
  for (const f of failures) keptUnreadable.set(f.slug, { path: f.path, message: f.message })
  setUnreadableFiles(keptUnreadable)
  reportParseFailures(failures)
  reportRoundTripLosses(lossy)
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
  const inFlight = getInFlightPaths()
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
  // the store belongs to whichever vault is active *now*. Since activation no
  // longer awaits the first sync (see syncOnActivate), a sync started at
  // activation can still be in flight when the user switches vaults; merging
  // its results would paint the old vault's content over the new one.
  if (getActiveBackend()?.id !== vaultId) return

  const changedWritten = changed.filter(p => written.has(p))
  if (changedWritten.length === 0 && deleted.length === 0) { updateSyncUI(); return }

  // Parse only the changed files; deleted paths have no replacement record and
  // are evicted via alsoAffected.
  const changedRecords = changedWritten
    .map(p => cacheMap.get(p))
    .filter((r): r is NonNullable<typeof r> => r != null)
  const deletedSlugs = deleted.map(pathToSlug)

  mergeChangedIntoStore(changedRecords, deletedSlugs)
  updateSyncUI()
}

// ── SYNC CORE ─────────────────────────────────────────────────────────

let _syncing = false
let _pushTimer: ReturnType<typeof setTimeout> | null = null
// Set when a push was requested (scheduleAutoPush's timer firing, or an
// explicit flushPendingPush()) while a sync was already in flight. runSync's
// early `if (_syncing) return` would otherwise silently drop that request —
// there's no rescheduling on that path today — stranding the write until the
// next 60s autoSyncTick. Re-armed from runSync's `finally` once the in-flight
// sync settles.
let _pushQueued = false

// ── BACKOFF STATE ─────────────────────────────────────────────────────
const BACKOFF_BASE_MS  = 60_000
const BACKOFF_MAX_MS   = 30 * 60_000

let _consecutiveFailures = 0
let _nextRetryAt         = 0
// Dedupe toasts for actionable (non-transient) errors across silent ticks.
let _lastErrorSig: string | null = null

export function resetSyncBackoff(): void {
  _consecutiveFailures = 0
  _nextRetryAt         = 0
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

  if (collisionMerges.length > 0) mergeChangedIntoStore(collisionMerges)

  return { hadCollision, pushed }
}

async function runSync(opts: { silent: boolean; pull: boolean }): Promise<void> {
  const backend = getActiveBackend()
  if (!backend || backend.readOnly) {
    if (!opts.silent) notify('No writable vault connected. Add a local folder first.')
    return
  }
  if (_syncing) return
  _syncing = true
  setSyncInProgress(true)

  const vaultId = backend.id
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
    setSyncError(null)
    setSyncOffline(false)
    setLastSyncedAt(Date.now())
    _consecutiveFailures = 0
    _nextRetryAt         = 0
    _lastErrorSig        = null
    updateSyncUI()
  } catch (e) {
    console.error('[vault] sync failed:', e)

    if (isTransientSyncError(e)) {
      // ── TRANSIENT (offline / network drop) ───────────────────
      setSyncOffline(true)
      _consecutiveFailures++
      _nextRetryAt = Date.now() + Math.min(
        BACKOFF_BASE_MS * Math.pow(2, _consecutiveFailures - 1),
        BACKOFF_MAX_MS,
      )
      if (!opts.silent) {
        notify("You're offline — changes are saved locally and will sync when you reconnect.")
      }
    } else {
      // ── ACTIONABLE (auth, repo missing, etc.) ────────────────
      const msg = (e as Error).message || (e as Error).name || 'Unknown error'
      setSyncError(msg)
      if (!opts.silent || _lastErrorSig !== msg) {
        notifyError('Sync failed', e)
        _lastErrorSig = msg
      }
    }
  } finally {
    _syncing = false
    setSyncInProgress(false)
    // A push that arrived mid-sync was queued (see attemptPush) instead of
    // dropped — re-arm the debounced push now that this sync has settled.
    if (_pushQueued) { _pushQueued = false; scheduleAutoPush() }
  }
}

/** Push pending local changes, or queue the request if a sync is already running. */
function attemptPush(): void {
  if (_syncing) { _pushQueued = true; return }
  void runSync({ silent: true, pull: false })
}

function scheduleAutoPush(): void {
  const backend = getActiveBackend()
  if (!backend || backend.readOnly) return
  if (_pushTimer) clearTimeout(_pushTimer)
  _pushTimer = setTimeout(() => { _pushTimer = null; attemptPush() }, 1000)
}

/**
 * Push anything still dirty in the cache right now — bypassing the 1s debounce —
 * without waiting for the next 60s autoSyncTick. Used to rescue writes stranded
 * by a prior session (vault activation) or about to be stranded by the page
 * going away (tab hidden/backgrounded). A no-op when nothing is dirty: pushDirty
 * returns immediately if the cache has no dirty/tombstoned records.
 */
export function flushPendingPush(): void {
  attemptPush()
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
export async function syncOnActivate(): Promise<void> {
  resetSyncBackoff()
  await runSync({ silent: true, pull: true })
}

export function autoSyncTick(): void {
  if (Date.now() < _nextRetryAt) return
  void runSync({ silent: true, pull: true })
}

export async function syncToBackend(): Promise<void> {
  // Manual sync always bypasses the backoff gate.
  _nextRetryAt = 0
  await runSync({ silent: false, pull: true })
}

// ── CACHE WRITE / DELETE ──────────────────────────────────────
//
// The in-flight write registry (markInFlight/clearInFlight/getInFlightPaths)
// lives in inFlight.ts — pure in-memory bookkeeping overlaying the persisted
// status; see its doc comment there for why marking is refcounted.

export async function writeEntityToCache(fileSlug: string): Promise<void> {
  const path = slugToPath(fileSlug)
  markInFlight(path)
  try {
    const backend = getActiveBackend()
    if (!backend || backend.readOnly) return
    const slugItems = fileSlugItems(getItems(), fileSlug)
    const root       = getRoots().get(fileSlug)
    if (slugItems.length === 0) {
      // Only genuinely delete when the root is gone too (the real
      // deleteByFileSlug outcome). getItems()/getRoots() here can be a
      // snapshot that lags the commit that triggered this call — e.g. a
      // second setData landing in between — so a root surviving with zero
      // items is a transient inconsistency, not a real delete. Treating it as
      // one would silently tombstone a brand-new item whose creating commit
      // just hadn't landed in this snapshot yet. Skip: a subsequent commit
      // will write the real content.
      if (!root) { await deleteFromBackend(fileSlug); return }
      console.warn('[vault] writeEntityToCache: skipping — root exists but no items yet for', fileSlug)
      return
    }
    const frontmatter = collapseToYaml(slugItems, root)
    const body        = root?.body ?? ''
    const content     = saveFile(frontmatter, body, root?.fileConvention)
    await recordLocalEdit(backend.id, path, content)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notifyError('Save failed', e)
  } finally {
    clearInFlight(path)
  }
}

export async function deleteFromBackend(fileSlug: string): Promise<void> {
  const path = slugToPath(fileSlug)
  markInFlight(path)
  try {
    const backend = getActiveBackend()
    if (!backend || backend.readOnly) return
    await recordLocalDelete(backend.id, path)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  } finally {
    clearInFlight(path)
  }
}
