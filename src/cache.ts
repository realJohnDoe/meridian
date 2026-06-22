import Dexie from 'dexie'
import type { VaultRef } from './storage/backend'

// ── Types ──────────────────────────────────────────────────────

export interface CacheRecord {
  /** Primary key: `${vaultId}::${path}` */
  vaultPath: string
  vaultId:   string
  path:      string
  content:   string
  dirty:     number
  updatedAt: number
  /**
   * Opaque base-version token from the backend the content was last synced
   * against (FS: `${lastModified}:${size}`, GitHub: blob SHA). Used to detect
   * drift. Undefined for files created locally that were never pulled/pushed.
   */
  version?:  string
}

export interface MetaRecord {
  key:   string
  value: FileSystemDirectoryHandle | string | VaultRef[]
}

// ── Dexie DB ───────────────────────────────────────────────────

class MeridianDB extends Dexie {
  files!: Dexie.Table<CacheRecord, string>
  meta!:  Dexie.Table<MetaRecord,  string>
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

/**
 * Records a local edit (dirty=1). Preserves the existing record's `version` —
 * the *base* backend token the edit derives from — so collision detection can
 * tell whether the backend has drifted since we last synced. A brand-new file
 * has no base version (undefined).
 */
export async function cacheWrite(vaultId: string, path: string, content: string): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  const existing = await d.files.get(key)
  if (existing && existing.content === content) return
  await d.files.put({ vaultPath: key, vaultId, path, content, dirty: 1, updatedAt: Date.now(), version: existing?.version })
}

export async function cacheWriteClean(vaultId: string, path: string, content: string, version?: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ vaultPath: vp(vaultId, path), vaultId, path, content, dirty: 0, updatedAt: Date.now(), version })
}

export async function cacheBulkWriteClean(
  vaultId: string,
  records: Array<{ path: string; content: string; version?: string }>,
): Promise<void> {
  const d = await cacheInit()
  const now = Date.now()
  await d.files.bulkPut(records.map(r => ({ vaultPath: vp(vaultId, r.path), vaultId, ...r, dirty: 0, updatedAt: now })))
}

export async function cacheLoadAll(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('vaultId').equals(vaultId).toArray()
}

export async function cacheDelete(vaultId: string, path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.delete(vp(vaultId, path))
}

export async function cacheGetDirty(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('vaultId').equals(vaultId).filter(r => r.dirty === 1).toArray()
}

/**
 * Stage a pending remote delete. dirty=2 acts as a tombstone: the file is
 * removed from the UI immediately but the backend delete is deferred to the
 * next sync (pushDirty). The base version is preserved so GitHub's delete API
 * can use it as the required blob SHA even after a page reload.
 */
export async function cacheWriteTombstone(vaultId: string, path: string): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  const existing = await d.files.get(key)
  await d.files.put({ vaultPath: key, vaultId, path, content: '', dirty: 2, updatedAt: Date.now(), version: existing?.version })
}

export async function cacheGetTombstones(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('vaultId').equals(vaultId).filter(r => r.dirty === 2).toArray()
}

export async function cacheDirtyCount(vaultId: string): Promise<number> {
  if (!db) return 0
  try { return await db.files.where('vaultId').equals(vaultId).filter(r => r.dirty === 1 || r.dirty === 2).count() }
  catch { return 0 }
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
