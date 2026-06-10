import Dexie from 'dexie'
import type { VaultRef } from './storage/backend'

// ── Types ──────────────────────────────────────────────────────

export interface CacheRecord {
  vaultId:   string
  path:      string
  content:   string
  dirty:     number
  updatedAt: number
  /** Opaque change-detection token. FS backend: `${lastModified}:${size}`. In-memory edits: `local:${Date.now()}`. */
  version?:  string
}

export interface MetaRecord {
  key:   string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
}

// ── Dexie DB ───────────────────────────────────────────────────

class MeridianDB extends Dexie {
  files!: Dexie.Table<CacheRecord, [string, string]>
  meta!:  Dexie.Table<MetaRecord,  string>
  constructor() {
    super('meridian_v2')
    this.version(1).stores({ files: 'path,dirty,updatedAt' })
    this.version(2).stores({ files: 'path,dirty,updatedAt', meta: 'key' })
    this.version(3).stores({ files: 'path,dirty,updatedAt', meta: 'key' })
    // v4: adds vaultId to CacheRecord; compound primary key [vaultId+path].
    // Existing rows (no vaultId) are cleared — local vaults re-read on next startup.
    this.version(4).stores({
      files: '[vaultId+path],dirty,updatedAt,vaultId',
      meta:  'key',
    }).upgrade(tx => tx.table('files').clear())
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

// ── Cache CRUD ─────────────────────────────────────────────────

export async function cacheWrite(vaultId: string, path: string, content: string, version?: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ vaultId, path, content, dirty: 1, updatedAt: Date.now(), version })
}

export async function cacheWriteClean(vaultId: string, path: string, content: string, version?: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ vaultId, path, content, dirty: 0, updatedAt: Date.now(), version })
}

export async function cacheBulkWriteClean(
  vaultId: string,
  records: Array<{ path: string; content: string; version?: string }>,
): Promise<void> {
  const d = await cacheInit()
  const now = Date.now()
  await d.files.bulkPut(records.map(r => ({ vaultId, ...r, dirty: 0, updatedAt: now })))
}

export async function cacheLoadAll(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('vaultId').equals(vaultId).toArray()
}

export async function cacheDelete(vaultId: string, path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.delete([vaultId, path])
}

export async function cacheGetDirty(vaultId: string): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('vaultId').equals(vaultId).filter(r => r.dirty === 1).toArray()
}

export async function cacheMarkClean(vaultId: string, path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.update([vaultId, path], { dirty: 0 })
}

export async function cacheDirtyCount(vaultId: string): Promise<number> {
  if (!db) return 0
  try { return await db.files.where('vaultId').equals(vaultId).filter(r => r.dirty === 1).count() }
  catch { return 0 }
}

// ── Directory handle persistence ───────────────────────────────

export async function handleSave(vaultId: string, h: FileSystemDirectoryHandle): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `handle:${vaultId}`, value: h })
}

export async function handleLoad(vaultId: string): Promise<FileSystemDirectoryHandle | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`handle:${vaultId}`)
  return (record?.value as FileSystemDirectoryHandle) ?? null
}

export async function handleClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`handle:${vaultId}`)
}

// ── Legacy single-vault handle (migration only) ────────────────

/** Used only when migrating from the pre-registry (v3) schema. */
export async function legacyDirHandleLoad(): Promise<FileSystemDirectoryHandle | null> {
  const d = await cacheInit()
  const record = await d.meta.get('dirHandle')
  return (record?.value as FileSystemDirectoryHandle) ?? null
}

export async function legacyDirHandleClear(): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete('dirHandle')
}

// ── Vault registry ─────────────────────────────────────────────

export async function vaultRefsSave(refs: VaultRef[]): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: 'vaults', value: refs })
}

export async function vaultRefsLoad(): Promise<VaultRef[]> {
  const d = await cacheInit()
  const record = await d.meta.get('vaults')
  return (record?.value as VaultRef[]) ?? []
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
  return (record?.value as string) ?? null
}
