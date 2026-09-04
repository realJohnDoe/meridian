import Dexie from 'dexie'

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
  /**
   * The content the backend held at `version` — the common ancestor a dirty
   * record's edit was made from, kept so a collision can be merged rather
   * than only copied out (see `mergeFileContent`).
   *
   * Set on dirty records only: a clean record's `content` *is* its base, and
   * storing a second copy of every file would double the cache for nothing.
   * Absent on a dirty record written before this field existed, which is why
   * every reader treats "no base" as "cannot merge" rather than as a default.
   *
   * Not indexed, so it needs no Dexie version bump — `stores()` below declares
   * the primary key and indexes, not the row's shape.
   */
  baseContent?: string
  /**
   * The retention sweep's age signal — see `RawFile.lastModified`, whose
   * value this carries forward into the cache. Same no-version-bump shape as
   * `baseContent` above, and the same rule for absence: a row written before
   * this field existed, or one the backend never supplied a value for, reads
   * back `undefined` — never defaulted to `updatedAt` (that is when *this
   * device's* cache row was written, not the file; see `CacheRecord`'s doc
   * comment) or to `0`. Absent means unknown, and unknown never archives.
   */
  lastModified?: number
}

/**
 * Row shape stored in Dexie's `meta` table — the key/value store behind
 * cache/credentials.ts (handles, tokens), cache/registry.ts (vault list) and
 * cache/pendingMoves.ts (held cross-vault deletes).
 *
 * `value` is `unknown`, not a union of those modules' payload types. Two
 * reasons, and the first is the one that matters: this is the bottom of the
 * directory — every other file here imports `cacheInit` from it — so a union
 * naming `VaultRef[]` and `PendingMove[]` had the Dexie seam importing its own
 * consumers back, which is a cycle (invariant 4 counts type edges, and
 * `PendingMove` closed a real one with cache/pendingMoves.ts).
 *
 * The second is that the union was never load-bearing anyway. A heterogeneous
 * key/value table cannot say which type a given key holds, so every reader
 * already re-establishes that itself against whatever came back out of
 * IndexedDB — `v instanceof FileSystemDirectoryHandle`, `typeof v === 'string'`,
 * `isVaultRef`, `isPendingMove`. That validation is not belt-and-braces; it is
 * the only thing standing between a hand-edited or half-written row and the
 * code downstream of it. `unknown` is what those readers were treating `value`
 * as regardless, now said out loud — and it makes the check mandatory rather
 * than merely conventional for the next reader added here.
 */
interface MetaRecord {
  key:   string
  value: unknown
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
