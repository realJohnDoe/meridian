import Dexie from 'dexie'
import type { VaultRef } from '@/vaultRef'

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
}

/** Row shape actually stored in Dexie — `dirty` stays a persisted number. */
interface DexieFileRow {
  vaultPath: string
  vaultId:   string
  path:      string
  content:   string
  dirty:     number
  updatedAt: number
  version?:  string
}

function toCacheRecord(r: DexieFileRow): CacheRecord {
  return {
    vaultPath: r.vaultPath, vaultId: r.vaultId, path: r.path, content: r.content,
    status: toStatus(r.dirty), updatedAt: r.updatedAt, version: r.version,
  }
}

interface MetaRecord {
  key:   string
  value: FileSystemDirectoryHandle | string | number | VaultRef[]
}

// ── Dexie DB ───────────────────────────────────────────────────

class MeridianDB extends Dexie {
  files!: Dexie.Table<DexieFileRow, string>
  meta!:  Dexie.Table<MetaRecord,   string>
  constructor() {
    // New database name (meridian_v3) — avoids any upgrade conflicts with the
    // old meridian_v2 schema. Users re-import their vault once.
    super('meridian_v3')
    this.version(1).stores({
      files: 'vaultPath,dirty,updatedAt,vaultId',
      meta:  'key',
    })
  }
}

let db: MeridianDB | null = null
let _cacheInitPromise: Promise<MeridianDB> | null = null

export async function cacheInit(): Promise<MeridianDB> {
  if (db) return db
  if (_cacheInitPromise) return _cacheInitPromise
  _cacheInitPromise = (async () => {
    db = new MeridianDB()
    await db.open()
    return db
  })()
  return _cacheInitPromise
}

// ── Key helpers ────────────────────────────────────────────────

function vp(vaultId: string, path: string): string {
  return `${vaultId}::${path}`
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
    await d.files.put({ vaultPath: key, vaultId, path, content, dirty: DIRTY_BY_STATUS.dirty, updatedAt: Date.now(), version: existing?.version })
  })
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
      await d.files.put({ ...existing, version, updatedAt: Date.now() })
      return
    }
    await d.files.put({ vaultPath: key, vaultId, path, content: pushedContent, dirty: DIRTY_BY_STATUS.clean, updatedAt: Date.now(), version })
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
  if (!db) return 0
  try {
    return await db.files.where('vaultId').equals(vaultId)
      .filter(r => r.dirty === DIRTY_BY_STATUS.dirty || r.dirty === DIRTY_BY_STATUS.deleted).count()
  }
  catch { return 0 }
}

// ── In-flight write registry ──────────────────────────────────
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

// ── Per-vault handle persistence ──────────────────────────────

export async function handleSave(vaultId: string, h: FileSystemDirectoryHandle): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `handle:${vaultId}`, value: h })
}

export async function handleLoad(vaultId: string): Promise<FileSystemDirectoryHandle | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`handle:${vaultId}`)
  const v = record?.value
  return (v instanceof FileSystemDirectoryHandle) ? v : null
}

export async function handleClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`handle:${vaultId}`)
}

// ── Per-vault token persistence ───────────────────────────────

export async function tokenSave(vaultId: string, token: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `token:${vaultId}`, value: token })
}

export async function tokenLoad(vaultId: string): Promise<string | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`token:${vaultId}`)
  const v = record?.value
  return typeof v === 'string' ? v : null
}

export async function tokenClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`token:${vaultId}`)
}

// ── Per-vault OAuth refresh-token + expiry (OAuth-managed vaults only) ────
// Presence of a refresh token is what marks a vault as OAuth-managed rather
// than PAT-managed — PAT vaults never have one.

export async function refreshTokenSave(vaultId: string, refreshToken: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `refreshToken:${vaultId}`, value: refreshToken })
}

export async function refreshTokenLoad(vaultId: string): Promise<string | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`refreshToken:${vaultId}`)
  const v = record?.value
  return typeof v === 'string' ? v : null
}

export async function refreshTokenClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`refreshToken:${vaultId}`)
}

export async function tokenExpirySave(vaultId: string, expiresAt: number): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `tokenExpiry:${vaultId}`, value: expiresAt })
}

export async function tokenExpiryLoad(vaultId: string): Promise<number | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`tokenExpiry:${vaultId}`)
  const v = record?.value
  return typeof v === 'number' ? v : null
}

export async function tokenExpiryClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`tokenExpiry:${vaultId}`)
}

export async function cacheDeleteAll(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.files.where('vaultId').equals(vaultId).delete()
}

// ── Vault registry ─────────────────────────────────────────────

export async function vaultRefsSave(refs: VaultRef[]): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: 'vaults', value: refs })
}

function isVaultRef(v: unknown): v is VaultRef {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r['id'] === 'string'
    && typeof r['name'] === 'string'
    && (r['kind'] === 'local' || r['kind'] === 'example' || r['kind'] === 'github')
}

export async function vaultRefsLoad(): Promise<VaultRef[]> {
  const d = await cacheInit()
  const record = await d.meta.get('vaults')
  const v = record?.value
  return Array.isArray(v) ? v.filter(isVaultRef) : []
}

export async function activeVaultIdSave(id: string | null): Promise<void> {
  const d = await cacheInit()
  if (id === null) {
    await d.meta.delete('activeVaultId')
  } else {
    await d.meta.put({ key: 'activeVaultId', value: id })
  }
}

export async function activeVaultIdLoad(): Promise<string | null> {
  const d = await cacheInit()
  const record = await d.meta.get('activeVaultId')
  const v = record?.value
  return typeof v === 'string' ? v : null
}
