import {
  recordLocalEdit, applyRemoteBatch, confirmDeleted, cacheGetDirty,
  setResolvedClean, markPushed, cacheDirtyCount, cacheLoadAll, cacheGetRecord,
  recordLocalDelete, cacheGetTombstones, markMerged,
} from '@/storage/cache/files'
import type { CacheRecord } from '@/storage/cache/files'
import { pendingMovesLoad, pendingMoveDrop, heldDeletePaths } from '@/storage/cache/pendingMoves'
import type { PendingMove } from '@/storage/cache/pendingMoves'
import { markInFlight, clearInFlight, getInFlightPaths } from '@/storage/inFlight'
import { conflictPath } from './conflictName'
import { ConflictError, AuthSyncError, isTransientSyncError } from './conflictError'
import type { StorageBackend, RawFile } from './backend'
import type { VaultKind } from '@/vaultRef'
import { mergeFileContent } from '@/model'
import { pathToKey, keyToPath, keySlug, keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { Entries } from '@/types'
import {
  getVaultLayer, setVaultLayer,
  setVaultSync,
  getUnreadableFiles, setUnreadableFiles,
  getVaults,
} from '@/storeBridge'
import type { AttentionKind } from '@/store'
import { notify, warn, warnWithDetails, notifyError } from './notifications'
import { getBackend, getMountedBackends } from './backends'
import { journal, hashContent, syncJournalDump } from './syncJournal'
import { parseFiles, reportParseFailures } from './parseReport'

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

// ── COLLISION RESOLUTION ───────────────────────────────────────────

/**
 * What a failed CAS write resolved to. `copied` and `merged` carry `merges`
 * because both put content on the backend that the store has never seen — the
 * other side's, combined with ours or beside it. In the remaining outcomes the
 * store already holds what ended up there (it is where the dirty record came
 * from), so there is nothing to merge back into it.
 *
 * `settled` is the *spurious* outcome — the backend refused the write but
 * nothing had actually diverged. It is not a conflict in any sense the user
 * should hear about: no copy is made, no toast is shown, and the cycle does not
 * need a reconcile afterwards.
 *
 * `merged` is the *resolved* outcome — something did diverge, and the two sides
 * turned out to be disjoint, so both changes are now in the file at `path`.
 * Also silent: a conflict the user would have had to do nothing about is not
 * worth interrupting them for. The journal records it either way.
 */
type CollisionOutcome =
  | { kind: 'copied'; copy: string; merges: Array<{ path: string; content: string }> }
  | { kind: 'merged'; merges: Array<{ path: string; content: string }> }
  | { kind: 'recreated' }
  | { kind: 'settled' }

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
  journal('version-repair', backend.id, path, { actual: fresh?.version }, backend.kind)
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
 * Handle a failed CAS write. Four outcomes, chosen by what the backend actually
 * holds now — which is why this re-reads rather than trusting the listing:
 *
 *  - **Nothing diverged; our content is already there.** The write landed and
 *    the refusal came after the fact — GitHub's Contents API answers 409 when
 *    it cannot fast-forward the branch ref behind a commit pushed moments
 *    earlier, which is routine when one user action writes two files and then
 *    edits one of them again (promote a checklist line, then change its
 *    priority). Nothing is preserved because nothing was lost: the record
 *    adopts the backend's token and goes clean, with no copy and no toast.
 *    Without this check that case produced a conflict copy whose content was
 *    byte-identical to the original — a duplicate entry conjured out of a
 *    conflict that never happened.
 *  - **Nothing diverged; the backend is still at our base version.** Same
 *    spurious refusal, caught one step earlier — the CAS precondition we sent
 *    is *still* what the backend holds, so no second writer can exist. Retry
 *    the write once rather than treating our own edit as a conflict.
 *  - **The remote diverged, on fields we did not touch.** Someone else's content
 *    sits at `path`, but the two edits are disjoint — the classic case being one
 *    person rescheduling a task while another writes its description. A
 *    three-way merge against `baseContent` produces a file with both changes in
 *    it, which goes out as a CAS write against the remote's own version. No
 *    copy, no toast: nothing was lost, so there is nothing to tell the user
 *    about. Needs an ancestor to work from, so a record with no `baseContent`
 *    (created before the field existed) skips straight to the copy below.
 *  - **The remote diverged, over the same ground.** Someone else's content sits
 *    at `path` and the two edits overlap — the same frontmatter key set two
 *    ways, or both bodies rewritten. Both sides are kept: the remote wins the
 *    path, the local content lands in a timestamped conflict copy.
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
  expectedVersion: string | undefined,
  baseContent: string | undefined,
): Promise<CollisionOutcome> {
  let [remote] = await backend.readFiles([path])

  // Every branch below wants the same three facts about what we just found, and
  // the journal wants them whichever way the branch goes.
  const localHash = hashContent(localContent)
  const facts = () => ({
    expected:   expectedVersion,
    actual:     remote?.version,
    localHash,
    remoteHash: remote ? hashContent(remote.content) : undefined,
    bytes:      localContent.length,
  })

  if (!remote) {
    try {
      // No `expectedVersion`: the record's base version points at the blob that
      // was deleted, so this has to go out as a create, not a compare-and-swap.
      const written = await backend.write(path, localContent, undefined)
      // markPushed, not setResolvedClean: another edit may have landed during
      // the round trip above, and it must stay dirty rather than be stamped
      // clean under content it no longer holds.
      await markPushed(vaultId, path, localContent, await versionAfterWrite(backend, path, written))
      journal('collision-recreated', vaultId, path, facts(), backend.kind)
      warn(`${path} was deleted on another device — your unsaved changes were restored. Delete it again if that was intended.`)
      return { kind: 'recreated' }
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      // Lost a race: the path was re-created between our two writes. Re-read and
      // fall through — there is remote content to preserve after all.
      ;[remote] = await backend.readFiles([path])
    }
  }

  // ── Spurious #1: the backend already holds exactly what we were pushing ────
  // Nothing was lost, so nothing needs preserving. markPushed (not
  // setResolvedClean) because a further edit may have landed while we were
  // reading: that edit must stay dirty and merely inherit the fresh token.
  if (remote && remote.content === localContent) {
    await markPushed(vaultId, path, localContent, remote.version)
    journal('collision-already-landed', vaultId, path, facts(), backend.kind)
    return { kind: 'settled' }
  }

  // ── Spurious #2: the backend is still at the version we CASed against ──────
  // A precondition that still matches cannot have been violated by a second
  // writer — the refusal came from somewhere else (a branch-ref race, a
  // retried request). Try the same write once more. A second refusal is not
  // retried again: at that point something really is moving underneath us, and
  // the copy-out below is the safe answer.
  if (remote && expectedVersion !== undefined && remote.version === expectedVersion) {
    try {
      const written = await backend.write(path, localContent, expectedVersion)
      await markPushed(vaultId, path, localContent, await versionAfterWrite(backend, path, written))
      journal('collision-retried', vaultId, path, facts(), backend.kind)
      return { kind: 'settled' }
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      ;[remote] = await backend.readFiles([path])
      if (remote && remote.content === localContent) {
        await markPushed(vaultId, path, localContent, remote.version)
        journal('collision-already-landed', vaultId, path, { ...facts(), note: 'after-retry' }, backend.kind)
        return { kind: 'settled' }
      }
    }
  }

  // ── Diverged on disjoint fields: merge, and nobody needs to hear about it ──
  // Conditioned on the remote's *current* version, so a third writer landing
  // between the read above and this write is refused rather than overwritten.
  // One attempt only: a refusal here means the path is moving under us, and
  // the copy-out below is the answer that cannot lose anything.
  if (remote && baseContent !== undefined) {
    const merged = mergeFileContent(path, baseContent, localContent, remote.content)
    if (merged !== null) {
      try {
        const written = await backend.write(path, merged, remote.version)
        const mergedVersion = await versionAfterWrite(backend, path, written)
        await markMerged(vaultId, path, localContent, merged, mergedVersion)
        journal('collision-merged', vaultId, path, { ...facts(), note: hashContent(merged) }, backend.kind)
        return { kind: 'merged', merges: [{ path, content: merged }] }
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        ;[remote] = await backend.readFiles([path])
      }
    }
  }

  // ── Diverged over the same ground: copy out first, revert the original second ──
  const { copy, version: copyVersion } = await writeConflictCopy(backend, path, localContent)
  await setResolvedClean(vaultId, copy, localContent, copyVersion)
  const merges: Array<{ path: string; content: string }> = [{ path: copy, content: localContent }]

  if (remote) {
    await setResolvedClean(vaultId, path, remote.content, remote.version)
    merges.unshift({ path, content: remote.content })
  }

  journal('collision-copied', vaultId, path, { ...facts(), note: copy }, backend.kind)
  // The details action carries this path's whole journal, not just the verdict:
  // a conflict with no second writer is only diagnosable from the *sequence* of
  // writes that preceded it, and in a PWA there is no console to read it from.
  warnWithDetails(
    `Conflict on ${path} — your version saved as ${copy}.`,
    () => syncJournalDump({ path }),
  )
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

  const layer = getVaultLayer(vaultId)
  const kept: Entries = new Map(
    [...layer].filter(([key]) => !affected.has(key)),
  )
  // `unreadableFiles` is genuinely cross-vault (one map keyed by EntryKey), but
  // the keys carry their vault, so filtering by `affected` only ever drops this
  // vault's entries.
  const keptUnreadable = new Map(
    [...getUnreadableFiles()].filter(([key]) => !affected.has(key)),
  )

  const { entries: reparsed, failures, auditRoundTrip } = parseFiles(records, vaultId)
  // Evict-then-re-add, both sides in the same shape. An entry is one object, so
  // a key is either kept whole or replaced whole — there is no longer a way for
  // the eviction and the re-add to disagree about what an entry is and drop one
  // half of it on a sync.
  setVaultLayer(vaultId, new Map([...kept, ...reparsed]))
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
      // A pull is the other way a record's base version changes, so it belongs
      // in the same journal as the pushes — a conflict caused by a reconcile
      // stamping an older token over a fresher one is otherwise invisible.
      journal('pull', vaultId, f.path, {
        expected: cached.find(r => r.path === f.path)?.version,
        actual:   f.version,
        remoteHash: hashContent(f.content),
      }, backend.kind)
    }
  }

  await Promise.all(deleted.map(p => confirmDeleted(vaultId, p)))
  for (const p of deleted) {
    cacheMap.delete(p)
    journal('drop', vaultId, p, undefined, backend.kind)
  }

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
   * Used only to order `autoSyncTick`'s walk (oldest-attempted first) — the
   * pull interval itself is paced from `lastPullAt` below, not from this.
   */
  lastAttemptAt: number
  /**
   * When a cycle last actually **pulled** — i.e. `reconcileWithBackend` ran,
   * whether because the cycle asked for a pull or a collision forced one.
   * `isDue` measures the per-vault pull interval from here rather than from
   * `lastAttemptAt`, so a push-only cycle (the debounced auto-push from
   * typing) advancing `lastAttemptAt` on every keystroke can no longer make a
   * vault look "recently synced" when it has not actually pulled in minutes —
   * see finding #1, "every push defers the next pull by a full interval".
   * Deliberately a separate field from `lastAttemptAt`, which the retry
   * backoff and the scheduler's ordering still need untouched.
   */
  lastPullAt: number
}

function createVaultSyncState(): VaultSyncState {
  return {
    syncing: false, pushTimer: null, pushQueued: false,
    consecutiveFailures: 0, nextRetryAt: 0, lastErrorSig: null,
    lastAttemptAt: 0, lastPullAt: 0,
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
  const staged     = await cacheGetTombstones(vaultId)
  const pushed     = new Set<string>()
  if (!dirty.length && !staged.length) return { hadCollision: false, pushed }

  // A tombstone staged by a cross-vault move is held back until the target
  // vault's copy is confirmed on its own remote — see settlePendingMoves. The
  // held record still hides the entry locally; only the remote delete waits.
  const held = staged.length > 0 ? await heldDeletePaths(vaultId) : new Set<string>()
  const tombstones = held.size > 0 ? staged.filter(f => !held.has(f.path)) : staged

  let hadCollision = false
  // Path+content pairs resolveCollision produced this cycle — merged into the
  // store below instead of left to a same-cycle reconcile, which skips these
  // exact paths (see planReconcile's skipPaths) and would otherwise leave the
  // conflict copy invisible until a later reconcile happens to see it as
  // changed, or a full restart re-hydrates from cache.
  const collisionMerges: Array<{ path: string; content: string }> = []

  for (const f of dirty) {
    journal('push', vaultId, f.path, { expected: f.version, localHash: hashContent(f.content), bytes: f.content.length }, backend.kind)
    try {
      // CAS write: pass the base version as the precondition. The backend
      // throws ConflictError only when the content genuinely diverged — it
      // never false-positives due to stale listing tokens.
      const written = await backend.write(f.path, f.content, f.version)
      // Never record the raw return value: `write` reports the new token only
      // "if the backend can determine it", and an `undefined` recorded here
      // makes the *next* push a create ("the path must be absent"), which every
      // backend refuses for a file that plainly exists — a conflict, and a
      // conflict copy, manufactured entirely by us. See versionAfterWrite.
      const newVersion = await versionAfterWrite(backend, f.path, written)
      // markPushed (not setResolvedClean): f.content was captured before
      // this network round trip, and another edit to this same path may have
      // landed in the meantime. An unconditional clean write would silently
      // discard that edit — see its doc comment in cache/files.ts.
      await markPushed(vaultId, f.path, f.content, newVersion)
      journal('push-ok', vaultId, f.path, { expected: f.version, actual: newVersion }, backend.kind)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        journal('push-conflict', vaultId, f.path, { expected: f.version, status: e.detail?.status, reason: e.detail?.reason }, backend.kind)
        const outcome = await resolveCollision(backend, vaultId, f.path, f.content, f.version, f.baseContent)
        pushed.add(f.path)
        if (outcome.kind === 'copied') pushed.add(outcome.copy)
        if (outcome.kind === 'copied' || outcome.kind === 'merged') collisionMerges.push(...outcome.merges)
        // Only the outcomes that leave something un-pulled ask for a reconcile.
        // 'settled' means the refusal was spurious and the backend now holds our
        // content; 'merged' means we just wrote the combined version and know
        // exactly what is there. Both are fully accounted for. 'recreated'
        // contributes no merges either — the store is already the source of that
        // content — but it does re-run reconcile, since a file that vanished
        // remotely suggests the listing moved in ways this cycle hasn't seen.
        if (outcome.kind === 'copied' || outcome.kind === 'recreated') hadCollision = true
      } else {
        throw e
      }
    }
  }

  for (const f of tombstones) {
    journal('delete-push', vaultId, f.path, { expected: f.version }, backend.kind)
    try {
      // Pass the cached version (blob SHA for GitHub) so the delete works even
      // when the backend's in-memory SHA cache is cold after a page reload.
      await backend.delete(f.path, f.version)
      await confirmDeleted(vaultId, f.path)
      journal('delete-ok', vaultId, f.path, undefined, backend.kind)
      pushed.add(f.path)
    } catch (e) {
      if (e instanceof ConflictError) {
        journal('delete-conflict', vaultId, f.path, { expected: f.version, status: e.detail?.status, reason: e.detail?.reason }, backend.kind)
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
 */
async function settlePendingMoves(): Promise<void> {
  let moves: PendingMove[]
  try {
    moves = await pendingMovesLoad()
  } catch (e) {
    console.error('[vault] could not read staged moves:', e)
    return
  }
  for (const move of moves) {
    try {
      await settleMove(move)
    } catch (e) {
      console.error('[vault] could not settle move', move.id, e)
    }
  }
}

async function settleMove(move: PendingMove): Promise<void> {
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
  await releaseMove(move)
}

/** The target's remote has the entry — let the source's delete go out. */
async function releaseMove(move: PendingMove): Promise<void> {
  await pendingMoveDrop(move.id)
  const fromVault = keyVaultId(move.fromKey)
  journal('move-released', fromVault, keyToPath(move.fromKey), { note: move.id })
  const from = getBackend(fromVault)
  if (!from || from.readOnly) return
  updateSyncUI(from)
  scheduleAutoPush(from)
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

  // A read-only vault is no longer a dead end — only a vault with no remote is.
  // The Tutorial vault is synthesized fresh on every load, so there is nothing
  // to push AND nothing to pull; a calendar subscription is equally unwritable
  // but has a live feed behind it, and skipping it here is what used to make a
  // separate refresh loop necessary.
  if (!backend.hasRemote) {
    if (!opts.silent) notify(`"${backend.name}" is read-only — there is nothing to sync.`)
    updateSyncUI(backend)
    return
  }
  if (syncState.syncing) return
  syncState.syncing       = true
  syncState.lastAttemptAt = Date.now()
  setVaultSync(vaultId, { inProgress: true })

  let attemptedRefresh = false
  let pulled = false

  try {
    // A single retry-after-refresh: a 401 here means the access token expired
    // or was revoked despite looking fresh locally (clock skew, early
    // revocation, etc.) — try one forced refresh before giving up. PAT-managed
    // vaults have no refresh token, so ensureFreshAccessToken(force) is a
    // no-op for them and the retry loop exits immediately via the thrown error.
    while (true) {
      try {
        // Push is skipped for a read-only vault, reconcile is not: pulling is
        // the entire point of a subscription's cycle. `hadCollision` is
        // vacuously false there — nothing was written, so nothing can conflict.
        const { hadCollision, pushed } = backend.readOnly
          ? { hadCollision: false, pushed: new Set<string>() }
          : await pushDirty(backend, vaultId)
        if (opts.pull || hadCollision) {
          await reconcileWithBackend(backend, vaultId, pushed)
          pulled = true
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
    // Any vault's successful cycle re-decides every staged move, not just the
    // ones this vault is half of: the question a move waits on — has the
    // target's copy reached its remote? — is answered by the target's cache
    // record, which any cycle can read. That way a move still settles when the
    // vault that would have noticed is the one sitting in backoff.
    await settlePendingMoves()
    setVaultSync(vaultId, { error: null, offline: false, lastSyncedAt: Date.now(), needsAttention: null })
    syncState.consecutiveFailures = 0
    syncState.nextRetryAt         = 0
    syncState.lastErrorSig        = null
    if (pulled) syncState.lastPullAt = Date.now()
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
      // AuthSyncError's own `kind` is how "sign in again" gets told apart from
      // "the App lost this repo" and "the branch is gone" — no re-parsing the
      // message. Anything else actionable (e.g. ConflictError) leaves
      // needsAttention as it was; only these three kinds are ever its writer.
      const attentionKind: AttentionKind | null =
        e instanceof AuthSyncError ? (e.kind === 'auth' ? 'reauth' : e.kind) : null
      setVaultSync(vaultId, {
        error: msg,
        ...(attentionKind ? { needsAttention: { kind: attentionKind, message: msg } } : {}),
      })
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

/**
 * Push one vault's pending local changes, or queue the request if its sync is
 * already running.
 *
 * Piggybacks a pull when the vault is already overdue for one (`isDue`) —
 * it's the same round trip the write already pays for. Without this, a vault
 * edited more often than its pull interval (the common case: autosave debounces
 * to a 1s push, well under any pull interval) never reaches the `autoSyncTick`
 * that would otherwise pull it, because every push-only cycle used to advance
 * the same clock the pull interval was paced from. See finding #1.
 */
function attemptPush(backend: StorageBackend): void {
  const syncState = syncStateFor(backend.id)
  if (syncState.syncing) { syncState.pushQueued = true; return }
  void runSync(backend, { silent: true, pull: isDue(backend, Date.now()) })
}

/** Debounced push for one vault. Exported for `moveEntry.ts`, which writes two vaults at once. */
export function scheduleAutoPush(backend: StorageBackend): void {
  if (backend.readOnly) return
  const syncState = syncStateFor(backend.id)
  if (syncState.pushTimer) clearTimeout(syncState.pushTimer)
  syncState.pushTimer = setTimeout(() => { syncState.pushTimer = null; attemptPush(backend) }, 1000)
}

/**
 * Push anything still dirty right now, in **every** registered vault at
 * once — bypassing the 1s debounce and without waiting for the next
 * autoSyncTick. Both call sites (`routes/__root.tsx`'s `visibilitychange`
 * going hidden, and `pagehide`) fire when the page is about to be
 * backgrounded or torn down, so there is no time left to be polite: unlike
 * `autoSyncTick`, which serializes vaults deliberately (see its doc comment)
 * because nothing else coordinates bursts across vaults' Octokit clients,
 * here a vault skipped or delayed behind another keeps its edit stranded in
 * Dexie until the next launch, which is strictly worse than a burst. If a
 * future caller reaches this from a non-teardown context, it should get its
 * own serial helper instead of reusing this one.
 *
 * Every vault, not just one, for the same reason: `pagehide` is the last
 * moment anything runs. A no-op per vault when nothing is dirty — pushDirty
 * returns immediately if the cache has no dirty/tombstoned records — so this
 * stays cheap.
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
  // GitHub's git-trees listing now goes out as a conditional request (see
  // GitHubBackend.statAll's ETag/If-None-Match handling) — an unchanged tree
  // answers 304 and doesn't count against the rate limit, so this can afford
  // to be much closer to the local-folder interval than the old 60s budget
  // that assumed every poll was a full, metered request.
  github: 20_000,
  // A subscription is somebody else's calendar: it changes rarely, the fetch
  // crosses two networks (Meridian's Worker, then the provider), and a
  // conditional request makes most of these cycles a 304 with no body anyway.
  ical:   15 * 60_000,
}
const DEFAULT_MIN_SYNC_INTERVAL_MS = 15 * 60_000

/**
 * The base tick is 60s, so an interval of exactly 60s would be skipped roughly
 * every other tick on timer drift alone. Treat a vault as due slightly early
 * rather than letting it slip to 120s.
 */
const DUE_TOLERANCE_MS = 5_000

/**
 * Whether `backend` is due for a **pull** — measured from `lastPullAt`, not
 * `lastAttemptAt` (see that field's doc comment). Two callers: `autoSyncTick`,
 * to decide whether a vault's periodic full cycle runs at all, and
 * `attemptPush`, to decide whether a debounced push should piggyback a pull
 * it would otherwise have to wait a full interval for.
 */
function isDue(backend: StorageBackend, now: number): boolean {
  const state = syncStateFor(backend.id)
  if (now < state.nextRetryAt) return false
  const elapsed = now - state.lastPullAt
  // A wall clock that jumped backwards (a device correcting its time, a
  // timezone-less NTP step) would otherwise park `lastPullAt` in the future
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
        .filter(b => b.hasRemote)
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
 * vault that has a remote — the topbar button speaks for the whole app, the
 * per-vault rows in its popover speak for one.
 *
 * Read-only vaults with a remote are included: "Sync now" on a subscription is
 * "refresh this calendar", which is exactly what the user means by it.
 *
 * Always bypasses the backoff gate: an explicit user gesture is a deliberate
 * "try again now".
 */
export async function syncToBackend(vaultId?: string): Promise<void> {
  const targets = vaultId
    ? [getBackend(vaultId)].filter((b): b is StorageBackend => !!b)
    : getMountedBackends().filter(b => b.hasRemote)

  if (targets.length === 0) {
    if (vaultId) {
      const name = getVaults().find(v => v.id === vaultId)?.name ?? vaultId
      notify(`"${name}" isn't connected — it may still be restoring, or failed to mount.`)
    } else {
      notify('No writable vault connected. Add a local folder first.')
    }
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

/**
 * The vault for `key` was removed (or never mounted) between the store commit
 * and this write reaching the backend — e.g. deleted in Settings while an
 * editor was open on it, or a deferred commit landing after the vault
 * unmounted. Unlike `readOnly` (expected, e.g. an iCal subscription), this is
 * an anomaly: the store already shows the change as saved, so silence here
 * would let it vanish on reload with no trace.
 */
function reportUnregisteredVault(key: EntryKey, path: string): void {
  const vaultId = keyVaultId(key)
  journal('write-refused', vaultId, path, { note: 'unregistered' })
  const name = getVaults().find(v => v.id === vaultId)?.name ?? vaultId
  warn(`"${name}" is no longer connected — this change was not saved.`)
}

/**
 * Make one entry's file durable in the cache, and queue it for push.
 *
 * `content` is handed in by the committing layer rather than resolved from the
 * store here — see `EntityPersistence`. That is what makes this function a
 * straight line: there is no lookup that could miss, no way for this side to
 * disagree with the caller about what the entry holds, and so no "it looks
 * incomplete, skip it" branch to silently drop a write. Whether a key is a
 * write or a delete is likewise the caller's call (`persistEntries`), made
 * against the data it is committing.
 */
export async function writeEntityToCache(entryKey: EntryKey, content: string): Promise<void> {
  const path = keyToPath(entryKey)
  markInFlight(entryKey)
  try {
    const backend = backendFor(entryKey)
    if (!backend) { reportUnregisteredVault(entryKey, path); return }
    if (backend.readOnly) return
    await recordLocalEdit(backend.id, path, content)
    // The first link in every chain a conflict investigation has to walk: when
    // the store handed this content to the write queue, and what it was.
    journal('edit', backend.id, path, { localHash: hashContent(content), bytes: content.length }, backend.kind)
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
    if (!backend) { reportUnregisteredVault(entryKey, path); return }
    if (backend.readOnly) return
    await recordLocalDelete(backend.id, path)
    journal('delete', backend.id, path, undefined, backend.kind)
    updateSyncUI(backend)
    scheduleAutoPush(backend)
  } catch (e) {
    console.error('[vault] deleteFromBackend failed:', e)
    notifyError('Delete failed', e)
  } finally {
    clearInFlight(entryKey)
  }
}
