import {
  cacheWrite, cacheBulkWriteClean, cacheDelete, cacheGetDirty,
  cacheWriteClean, cacheDirtyCount, cacheLoadAll,
  cacheWriteTombstone, cacheGetTombstones,
} from '@/storage/cache'
import type { CacheRecord } from '@/storage/cache'
import { conflictPath } from './conflictName'
import { ConflictError, AuthSyncError, isTransientSyncError } from './conflictError'
import type { StorageBackend, RawFile } from './backend'
import { collapseToYaml, parseToStoreItems, fileSlugItems, saveFile } from '@/model'
import type { StoreItem, Roots } from '@/types'
import {
  getItems, getRoots, setData,
  setSyncDirtyCount, setSyncError, setSyncOffline, setLastSyncedAt, getSyncError,
} from '@/storeBridge'
import { notify, warn, notifyError } from './notifications'
import { getActiveBackend } from './activeBackend'

// ── HELPERS ────────────────────────────────────────────────────

function fileSlugToPath(fileSlug: string): string {
  return fileSlug + '.md'
}

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

export function parseFiles(
  files: Array<{ path: string; content: string }>,
): { items: StoreItem[]; roots: Roots } {
  const loaded: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { path, content } of files) {
    try {
      const parsed = parseToStoreItems(path, content)
      loaded.push(...parsed.items)
      roots.set(path.replace(/\.(md|yaml|yml)$/, ''), parsed.root)
    } catch (e) { console.warn('[vault] parse failed for', path, e) }
  }
  return { items: loaded, roots }
}

// ── COLLISION RESOLUTION ───────────────────────────────────────────

/**
 * Handle a write collision: backend version of `path` has drifted while the
 * cache also has unsaved local edits.
 *
 * Resolution:
 *  1. Re-pull the backend's copy → overwrite the original path in cache (clean).
 *  2. Write the local content to a timestamped copy on the backend immediately.
 *  3. Cache the copy (clean) and notify the user.
 *
 * Returns the copy's path plus a `merges` list of the path+content pairs this
 * resolved (the re-pulled original, the new copy, or both) — the caller merges
 * these into the store immediately (see mergeChangedIntoStore) rather than
 * leaving them to a same-cycle reconcile, which deliberately skips paths this
 * cycle already resolved (see planReconcile's skipPaths).
 */
async function resolveCollision(
  backend: StorageBackend,
  vaultId: string,
  path: string,
  localContent: string,
  cacheMap?: Map<string, CacheRecord>,
): Promise<{ copy: string; merges: Array<{ path: string; content: string }> }> {
  const merges: Array<{ path: string; content: string }> = []

  const [fresh] = await backend.readFiles([path])
  if (fresh) {
    await cacheWriteClean(vaultId, path, fresh.content, fresh.version)
    merges.push({ path, content: fresh.content })
    if (cacheMap) {
      cacheMap.set(path, {
        vaultPath: `${vaultId}::${path}`,
        vaultId, path,
        content: fresh.content,
        dirty: 0,
        updatedAt: Date.now(),
        version: fresh.version,
      })
    }
  }

  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)

  let copyVersion: string | undefined
  const [copyFresh] = await backend.readFiles([copy])
  if (copyFresh) copyVersion = copyFresh.version

  await cacheWriteClean(vaultId, copy, localContent, copyVersion)
  merges.push({ path: copy, content: localContent })
  if (cacheMap && copyVersion !== undefined) {
    cacheMap.set(copy, {
      vaultPath: `${vaultId}::${copy}`,
      vaultId, path: copy,
      content: localContent,
      dirty: 0,
      updatedAt: Date.now(),
      version: copyVersion,
    })
  }

  warn(`Conflict on ${path} — your version saved as ${copy}.`)
  return { copy, merges }
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
    if (!entry || (entry.version !== diskToken && entry.dirty === 0)) {
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
    if (!diskTokens.has(entry.path) && entry.dirty === 0 && !recentlyWritten) deleted.push(entry.path)
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
  for (const r of records) affectedSlugs.add(r.path.replace(/\.(md|yaml|yml)$/, ''))

  const keptItems = getItems().filter(item => !affectedSlugs.has(item.fileSlug))
  const keptRoots: Roots = new Map(
    [...getRoots()].filter(([slug]) => !affectedSlugs.has(slug)),
  )

  const { items: newItems, roots: newRoots } = parseFiles(records)
  setData({ items: [...keptItems, ...newItems], roots: new Map([...keptRoots, ...newRoots]) })
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
  const cached     = await cacheLoadAll(vaultId)
  const cacheMap   = new Map(cached.map(r => [r.path, r]))

  const { changed, deleted } = planReconcile(diskTokens, cached, skipPaths, Date.now())

  if (changed.length > 0) {
    let freshFiles: RawFile[]
    if (changed.length > LARGE_RECONCILE_THRESHOLD) {
      const changedSet = new Set(changed)
      freshFiles = (await backend.readAll()).filter(f => changedSet.has(f.path))
    } else {
      freshFiles = await backend.readFiles(changed)
    }
    await cacheBulkWriteClean(vaultId, freshFiles)
    for (const f of freshFiles) {
      cacheMap.set(f.path, { vaultPath: `${vaultId}::${f.path}`, vaultId, path: f.path, content: f.content, dirty: 0, updatedAt: Date.now(), version: f.version })
    }
  }

  await Promise.all(deleted.map(p => cacheDelete(vaultId, p)))
  for (const p of deleted) cacheMap.delete(p)

  if (changed.length === 0 && deleted.length === 0) { updateSyncUI(); return }

  // Parse only the changed files; deleted paths have no replacement record and
  // are evicted via alsoAffected.
  const changedRecords = changed
    .map(p => cacheMap.get(p))
    .filter((r): r is NonNullable<typeof r> => r != null)
  const deletedSlugs = deleted.map(p => p.replace(/\.(md|yaml|yml)$/, ''))

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
      await cacheWriteClean(vaultId, f.path, f.content, newVersion)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        const { copy, merges } = await resolveCollision(backend, vaultId, f.path, f.content)
        hadCollision = true
        pushed.add(f.path)
        pushed.add(copy)
        collisionMerges.push(...merges)
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
      await cacheDelete(vaultId, f.path)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        // The file was edited remotely after our tombstone was staged.
        // Drop the tombstone without deleting anything — leaving no cache
        // entry behind — and let this cycle's reconcile (triggered below via
        // hadCollision) pull the remote edit back in, so it isn't silently
        // destroyed. Deliberately NOT added to `pushed`: that set skips
        // reconcile's re-pull, and here we want the opposite.
        await cacheDelete(vaultId, f.path)
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

export async function writeEntityToCache(fileSlug: string): Promise<void> {
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
    const content     = saveFile(frontmatter, body)
    const path        = fileSlugToPath(fileSlug)
    await cacheWrite(backend.id, path, content)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] writeEntityToCache failed:', e)
    notifyError('Save failed', e)
  }
}

export async function deleteFromBackend(fileSlug: string): Promise<void> {
  try {
    const backend = getActiveBackend()
    if (!backend || backend.readOnly) return
    const path = fileSlugToPath(fileSlug)
    await cacheWriteTombstone(backend.id, path)
    updateSyncUI()
    scheduleAutoPush()
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  }
}
