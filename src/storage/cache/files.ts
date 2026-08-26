import { cacheInit, openedDb, vp, type DexieFileRow } from './db'

// ── Types ──────────────────────────────────────────────────────

/**
 * Per-file sync status. Persisted in Dexie as a number (see DIRTY_BY_STATUS
 * below) — no schema/DB-name change, so an existing vault's cache doesn't
 * need a re-import — but every call site outside this file's mapping
 * functions deals only in this named union, so TypeScript can
 * exhaustiveness-check status branches instead of a magic 0/1/2 scattered
 * across sync.ts and its tests. Not exported: external code narrows via
 * `CacheRecord['status']` (see reconcile.test.ts) rather than importing this
 * type name directly, so there's no outside reference to it.
 */
type SyncStatus = 'clean' | 'dirty' | 'deleted'

const DIRTY_BY_STATUS: Record<SyncStatus, number> = { clean: 0, dirty: 1, deleted: 2 }
const STATUS_BY_DIRTY: Record<number, SyncStatus> = { 0: 'clean', 1: 'dirty', 2: 'deleted' }

function toStatus(dirty: number): SyncStatus {
  return STATUS_BY_DIRTY[dirty] ?? 'clean'
}

/** Public shape returned by this module's query functions. */
export interface CacheRecord {
  /** Primary key: `${vaultId}::${path}` */
  vaultPath: string
  vaultId:   string
  path:      string
  content:   string
  status:    SyncStatus
  updatedAt: number
  /**
   * Opaque base-version token from the backend the content was last synced
   * against (FS: `${lastModified}:${size}`, GitHub: blob SHA). Used to detect
   * drift. Undefined for files created locally that were never pulled/pushed.
   */
  version?:  string
  /**
   * The backend's content at `version` — the ancestor this record's edit was
   * made from, for a three-way merge on collision. Dirty records only; see
   * `DexieFileRow.baseContent`.
   */
  baseContent?: string
}

function toCacheRecord(r: DexieFileRow): CacheRecord {
  return {
    vaultPath: r.vaultPath, vaultId: r.vaultId, path: r.path, content: r.content,
    status: toStatus(r.dirty), updatedAt: r.updatedAt, version: r.version,
    baseContent: r.baseContent,
  }
}

// ── Cache CRUD ─────────────────────────────────────────────────
//
// Six transitions cover every way a record's status can legitimately change.
// Each is a single transaction with its precondition built in, so "don't
// clobber a locally-modified record" is not a rule call sites must remember —
// there is no function that does an unconditional clean write except
// setResolvedClean, which exists solely for resolveCollision's two
// intentional overwrites (the local content has already been copied out by
// the time it's called).

/**
 * Records a local edit (status: dirty). Preserves the existing record's
 * `version` — the *base* backend token the edit derives from — so collision
 * detection can tell whether the backend has drifted since we last synced. A
 * brand-new file has no base version (undefined).
 */
export async function recordLocalEdit(vaultId: string, path: string, content: string): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  await d.transaction('rw', d.files, async () => {
    const existing = await d.files.get(key)
    if (existing && existing.content === content) return
    await d.files.put({
      vaultPath: key, vaultId, path, content,
      dirty: DIRTY_BY_STATUS.dirty, updatedAt: Date.now(),
      version: existing?.version,
      baseContent: baseFor(existing),
    })
  })
}

/**
 * The ancestor content to carry onto a record about to go dirty.
 *
 * A clean record's own content *is* the ancestor — this is the moment it gets
 * captured, since the next edit will overwrite `content` with the local
 * version. A record already dirty keeps the base its first edit captured, so a
 * run of keystrokes still merges against what the backend actually holds
 * rather than against the previous keystroke.
 *
 * A dirty row written before `baseContent` existed answers `undefined` — the
 * fallback must not be `existing.content`, which for a dirty row is the local
 * edit itself: a merge told that base equals local concludes the local side
 * changed nothing and silently takes the remote, discarding the user's work.
 */
function baseFor(existing: DexieFileRow | undefined): string | undefined {
  if (!existing) return undefined
  return existing.dirty === DIRTY_BY_STATUS.clean ? existing.content : existing.baseContent
}

/** Unconditional clean write — used only by resolveCollision, where the
 * local content has already been copied out to a conflict-copy path first. */
export async function setResolvedClean(vaultId: string, path: string, content: string, version?: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ vaultPath: vp(vaultId, path), vaultId, path, content, dirty: DIRTY_BY_STATUS.clean, updatedAt: Date.now(), version })
}

/**
 * Mark a pushed record clean — but only if it still holds the content we
 * pushed. A local edit can land during the push's network round trip; an
 * unconditional put would overwrite it AND clear its dirty status, losing it
 * silently (the store keeps it, so nothing looks wrong until a reload).
 * When the content moved on, keep status/content as-is and only advance
 * `version`, so the next push CASes against what we just wrote. Also does the
 * right thing for a tombstone staged mid-push: content '' !== the pushed
 * content, so the tombstone survives and inherits the fresh blob SHA.
 */
export async function markPushed(
  vaultId: string, path: string, pushedContent: string, version?: string,
): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  await d.transaction('rw', d.files, async () => {
    const existing = await d.files.get(key)
    if (existing && existing.content !== pushedContent) {
      // The record moved on mid-push, so it stays dirty — but the backend now
      // holds `pushedContent`, so that, not the older ancestor, is what its
      // next collision has to merge against.
      await d.files.put({ ...existing, version, updatedAt: Date.now(), baseContent: pushedContent })
      return
    }
    // Clean again: content is its own ancestor, so no separate base is kept.
    await d.files.put({ vaultPath: key, vaultId, path, content: pushedContent, dirty: DIRTY_BY_STATUS.clean, updatedAt: Date.now(), version })
  })
}

/**
 * Adopt the result of a three-way merge that has already been written to the
 * backend — the record's local edit is *inside* `mergedContent`, so replacing
 * it is preserving it, not discarding it.
 *
 * `markPushed` cannot serve here: its precondition is "the record still holds
 * exactly what we pushed", and a merge deliberately writes something the
 * record never held. It would take its diverged branch every time and leave
 * the pre-merge local content dirty, which the next cycle would push straight
 * back over the merge.
 *
 * So the precondition is the one that actually matters — the record still
 * holds the content that *went into* the merge. When it doesn't, a further
 * edit landed during the round trip and stays dirty, re-based on the merged
 * content the backend now holds.
 */
export async function markMerged(
  vaultId: string, path: string, mergedFrom: string, mergedContent: string, version?: string,
): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  await d.transaction('rw', d.files, async () => {
    const existing = await d.files.get(key)
    if (existing && existing.content !== mergedFrom) {
      await d.files.put({ ...existing, version, updatedAt: Date.now(), baseContent: mergedContent })
      return
    }
    await d.files.put({ vaultPath: key, vaultId, path, content: mergedContent, dirty: DIRTY_BY_STATUS.clean, updatedAt: Date.now(), version })
  })
}

/**
 * Bulk-write freshly-pulled remote content as clean — but skip any record a
 * local edit or delete has touched since the caller's cacheLoadAll snapshot
 * (reconcileWithBackend awaits a network read between that snapshot and this
 * call, a real window). Overwriting such a record would clean-stamp
 * now-stale remote content over it, discarding the local change the same way
 * the single-record setResolvedClean used to (see markPushed). Skipped
 * records keep their stale base `version`, so the next push CASes against it
 * and correctly detects the conflict rather than silently winning.
 *
 * Returns the paths actually written, so the caller only merges those into
 * the store — a skipped path's cache and store both keep whatever they held
 * (typically the user's still-in-progress edit) rather than either the
 * pre-edit snapshot or the now-superseded remote content.
 */
export async function applyRemoteBatch(
  vaultId: string,
  records: Array<{ path: string; content: string; version?: string }>,
): Promise<string[]> {
  const d = await cacheInit()
  const now = Date.now()
  const written: string[] = []
  await d.transaction('rw', d.files, async () => {
    const keys = records.map(r => vp(vaultId, r.path))
    const existingRecords = await d.files.bulkGet(keys)
    const toPut: DexieFileRow[] = []
    records.forEach((r, i) => {
      const existing = existingRecords[i]
      if (existing && existing.dirty !== DIRTY_BY_STATUS.clean) return
      toPut.push({ vaultPath: vp(vaultId, r.path), vaultId, ...r, dirty: DIRTY_BY_STATUS.clean, updatedAt: now })
      written.push(r.path)
    })
    if (toPut.length > 0) await d.files.bulkPut(toPut)
  })
  return written
}

/**
 * One record, or undefined when the cache has never held that path. The
 * whole-vault `cacheLoadAll` is the wrong tool for a caller that wants a
 * single file's status (`settlePendingMoves` asking whether one entry has
 * reached its remote yet) — this is a primary-key lookup instead of a scan.
 */
export async function cacheGetRecord(vaultId: string, path: string): Promise<CacheRecord | undefined> {
  const d = await cacheInit()
  const row = await d.files.get(vp(vaultId, path))
  return row ? toCacheRecord(row) : undefined
}

export async function cacheLoadAll(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  const rows = await d.files.where('vaultId').equals(vaultId).toArray()
  return rows.map(toCacheRecord)
}

/** Removes a record entirely — a confirmed push of a pending delete, or a
 * reconcile evicting a row that genuinely no longer exists on the backend. */
export async function confirmDeleted(vaultId: string, path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.delete(vp(vaultId, path))
}

export async function cacheGetDirty(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  const rows = await d.files.where('vaultId').equals(vaultId).filter(r => r.dirty === DIRTY_BY_STATUS.dirty).toArray()
  return rows.map(toCacheRecord)
}

/**
 * Stage a pending remote delete (status: deleted). The file is removed from
 * the UI immediately but the backend delete is deferred to the next sync
 * (pushDirty). The base version is preserved so GitHub's delete API can use
 * it as the required blob SHA even after a page reload.
 */
export async function recordLocalDelete(vaultId: string, path: string): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  const existing = await d.files.get(key)
  await d.files.put({ vaultPath: key, vaultId, path, content: '', dirty: DIRTY_BY_STATUS.deleted, updatedAt: Date.now(), version: existing?.version })
}

export async function cacheGetTombstones(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  const rows = await d.files.where('vaultId').equals(vaultId).filter(r => r.dirty === DIRTY_BY_STATUS.deleted).toArray()
  return rows.map(toCacheRecord)
}

export async function cacheDirtyCount(vaultId: string): Promise<number> {
  const d = openedDb()
  if (!d) return 0
  try {
    return await d.files.where('vaultId').equals(vaultId)
      .filter(r => r.dirty === DIRTY_BY_STATUS.dirty || r.dirty === DIRTY_BY_STATUS.deleted).count()
  }
  catch { return 0 }
}

export async function cacheDeleteAll(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.files.where('vaultId').equals(vaultId).delete()
}
