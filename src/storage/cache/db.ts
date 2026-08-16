import Dexie from 'dexie'
import type { VaultRef } from '@/vaultRef'

// The single Dexie seam. Every other file in this directory reaches IndexedDB
// through `cacheInit()` — this is the only module allowed to import dexie
// (enforced by the `no-restricted-imports` ignores list in eslint.config.js),
// which is what keeps the database a singleton without also forcing every
// persistence concern into one file.

/** Row shape actually stored in Dexie's `files` table — `dirty` stays a
 * persisted number; see cache/files.ts for the status mapping it carries. */
export interface DexieFileRow {
  vaultPath: string
  vaultId:   string
  path:      string
  content:   string
  dirty:     number
  updatedAt: number
  version?:  string
}

/** Row shape stored in Dexie's `meta` table — the key/value store behind
 * cache/credentials.ts (handles, tokens) and cache/registry.ts (vault list). */
interface MetaRecord {
  key:   string
  value: FileSystemDirectoryHandle | string | number | boolean | VaultRef[]
}

export class MeridianDB extends Dexie {
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

/** The already-open database, or null if `cacheInit()` hasn't resolved yet —
 * for callers that must answer synchronously-ish rather than force the DB
 * open (see cacheDirtyCount). */
export function openedDb(): MeridianDB | null {
  return db
}

/** Primary key of a `files` row. */
export function vp(vaultId: string, path: string): string {
  return `${vaultId}::${path}`
}
