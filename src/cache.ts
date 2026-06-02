import Dexie from 'dexie'

// ── Types ──────────────────────────────────────────────────────

export interface CacheRecord {
  path:      string
  content:   string
  dirty:     number
  updatedAt: number
}

export interface MetaRecord {
  key:   string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
}

// ── Dexie DB ───────────────────────────────────────────────────

class MeridianDB extends Dexie {
  files!: Dexie.Table<CacheRecord, string>
  meta!:  Dexie.Table<MetaRecord,  string>
  constructor() {
    super('meridian_v2')
    this.version(1).stores({ files: 'path,dirty,updatedAt' })
    this.version(2).stores({ files: 'path,dirty,updatedAt', meta: 'key' })
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

export async function cacheWrite(path: string, content: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ path, content, dirty: 1, updatedAt: Date.now() })
}

export async function cacheWriteClean(path: string, content: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ path, content, dirty: 0, updatedAt: Date.now() })
}

export async function cacheDelete(path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.delete(path)
}

export async function cacheGetDirty(): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('dirty').equals(1).toArray()
}

export async function cacheMarkClean(path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.update(path, { dirty: 0 })
}

export async function cacheDirtyCount(): Promise<number> {
  if (!db) return 0
  try { return await db.files.where('dirty').equals(1).count() }
  catch { return 0 }
}

// ── Directory handle persistence ───────────────────────────────

export async function dirHandleSave(h: FileSystemDirectoryHandle): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: 'dirHandle', value: h })
}

export async function dirHandleLoad(): Promise<FileSystemDirectoryHandle | null> {
  const d = await cacheInit()
  const record = await d.meta.get('dirHandle')
  return (record?.value as FileSystemDirectoryHandle) ?? null
}

export async function dirHandleClear(): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete('dirHandle')
}
