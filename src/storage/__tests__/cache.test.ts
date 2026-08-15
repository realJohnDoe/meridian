/**
 * Real-Dexie tests for src/storage/cache/ — the durability and credentials
 * layer (`db`, `files`, `credentials`, `registry`).
 *
 * Every other test that touches this directory replaces it with a hand-written
 * in-memory fake (see sync.test.ts, vaultRegistry.test.ts, githubOAuth.test.ts),
 * which is the right call there — those suites are about sync/registry/OAuth
 * logic, not storage. But it left the layer that decides whether an offline
 * edit survives a reload, and where GitHub tokens live, with no test of its
 * own. These tests run the *real* Dexie code against `fake-indexeddb`, so the
 * two things a fake cannot check are checked here:
 *
 *  1. **The persisted representation.** `dirty` is stored as a number (0/1/2)
 *     and mapped to the `SyncStatus` union on the way out, specifically so an
 *     existing user's cache doesn't need a re-import. A fake that stores the
 *     union directly would keep passing if that mapping inverted or drifted,
 *     so the assertions below read raw rows out of Dexie and pin the numbers.
 *  2. **The transactional preconditions.** `recordLocalEdit`, `markPushed` and
 *     `applyRemoteBatch` each do a read-then-conditional-write inside one
 *     transaction ("don't clobber a locally-modified record"). Those guards are
 *     what stand between a mid-push local edit and silent data loss.
 *
 * Isolation: `db.ts` memoises the database in module state, so each test gets a
 * fresh module graph (`vi.resetModules()`) over a freshly-deleted database.
 * Resetting modules alone is what makes the pre-`cacheInit()` state
 * (`openedDb() === null`) reachable; deleting the database is what stops one
 * test's rows from being visible to the next. Note the two are separate steps
 * on purpose — swapping in a new `IDBFactory` would *not* work, because
 * `vi.resetModules()` doesn't re-evaluate externalised node_modules, so dexie
 * keeps serving whichever factory was on `globalThis` when it first loaded.
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { VaultRef } from '@/vaultRef'
import type * as DbModule from '@/storage/cache/db'
import type * as FilesModule from '@/storage/cache/files'
import type * as CredentialsModule from '@/storage/cache/credentials'
import type * as RegistryModule from '@/storage/cache/registry'

// ── Fixtures and helpers ───────────────────────────────────────

/**
 * Stand-in for the OS directory handle `credentials.ts` persists.
 *
 * A real browser round-trips a `FileSystemDirectoryHandle` through IndexedDB
 * with its type intact; fake-indexeddb's structured clone returns a plain
 * object, so a prototype-based `instanceof` would fail here for a reason that
 * has nothing to do with the code under test. Branding via `Symbol.hasInstance`
 * keeps `handleLoad`'s guard genuinely exercised on both paths — it accepts
 * this value and still rejects a non-handle stored under the same key.
 */
class FakeDirectoryHandle {
  static [Symbol.hasInstance](v: unknown): boolean {
    return typeof v === 'object' && v !== null && '__fsDirHandle' in v
  }

  readonly __fsDirHandle = true
  readonly kind = 'directory'
  constructor(readonly name: string) {}
}

type CacheModules = {
  db:    typeof DbModule
  files: typeof FilesModule
  creds: typeof CredentialsModule
  reg:   typeof RegistryModule
}

let m!: CacheModules

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => { resolve() }
    req.onerror   = () => { reject(new Error(`deleteDatabase(${name}) failed`)) }
    req.onblocked = () => { reject(new Error(`deleteDatabase(${name}) blocked by an open connection`)) }
  })
}

/**
 * Fresh module graph over an empty IndexedDB. Imports only — `cacheInit()` is
 * deliberately not called, so a test can observe the not-yet-opened state.
 */
async function freshCache(): Promise<CacheModules> {
  vi.resetModules()
  // afterEach has already closed the previous connection; without that,
  // deleteDatabase would block rather than delete.
  for (const { name } of await indexedDB.databases()) {
    if (name !== undefined) await deleteDatabase(name)
  }
  globalThis.FileSystemDirectoryHandle =
    FakeDirectoryHandle as unknown as typeof globalThis.FileSystemDirectoryHandle
  return {
    db:    await import('@/storage/cache/db'),
    files: await import('@/storage/cache/files'),
    creds: await import('@/storage/cache/credentials'),
    reg:   await import('@/storage/cache/registry'),
  }
}

/** The open database, for assertions that must see the raw persisted row. */
function open(): Promise<DbModule.MeridianDB> {
  return m.db.cacheInit()
}

/** Raw Dexie row — `dirty` as the number actually on disk, not the mapped union. */
async function rawRow(vaultId: string, path: string): Promise<DbModule.DexieFileRow | undefined> {
  const d = await open()
  return d.files.get(m.db.vp(vaultId, path))
}

const V = 'vault-1'
const OTHER = 'vault-2'

beforeEach(async () => {
  m = await freshCache()
})

afterEach(() => {
  m.db.openedDb()?.close()
})

// ── db.ts ──────────────────────────────────────────────────────

describe('cache/db', () => {
  it('builds the files primary key as `${vaultId}::${path}`', () => {
    expect(m.db.vp(V, 'notes/task.md')).toBe('vault-1::notes/task.md')
  })

  it('reports no database until cacheInit resolves', async () => {
    expect(m.db.openedDb()).toBeNull()
    const d = await m.db.cacheInit()
    expect(m.db.openedDb()).toBe(d)
  })

  it('opens the database exactly once, including for concurrent callers', async () => {
    // Both the in-flight-promise path and the already-resolved path — a second
    // MeridianDB would be a second connection fighting over the same schema.
    const [a, b] = await Promise.all([m.db.cacheInit(), m.db.cacheInit()])
    const c = await m.db.cacheInit()
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

// ── files.ts: the persisted dirty↔status mapping ───────────────

describe('cache/files — persisted status representation', () => {
  it('persists clean/dirty/deleted as 0/1/2', async () => {
    // Pinned deliberately: the numbers are the on-disk format for caches that
    // already exist in users' browsers. Changing them silently is a migration.
    await m.files.recordLocalEdit(V, 'a.md', 'body')
    expect((await rawRow(V, 'a.md'))?.dirty).toBe(1)

    await m.files.markPushed(V, 'a.md', 'body', 'sha1')
    expect((await rawRow(V, 'a.md'))?.dirty).toBe(0)

    await m.files.recordLocalDelete(V, 'a.md')
    expect((await rawRow(V, 'a.md'))?.dirty).toBe(2)
  })

  it('maps those numbers back to the status union on read', async () => {
    await m.files.recordLocalEdit(V, 'dirty.md', 'body')
    await m.files.setResolvedClean(V, 'clean.md', 'body', 'sha1')
    await m.files.recordLocalDelete(V, 'gone.md')

    const byPath = new Map((await m.files.cacheLoadAll(V)).map(r => [r.path, r.status]))
    expect(byPath.get('dirty.md')).toBe('dirty')
    expect(byPath.get('clean.md')).toBe('clean')
    expect(byPath.get('gone.md')).toBe('deleted')
  })

  it('reads an unrecognised persisted dirty value as clean rather than undefined', async () => {
    // Forward-compatibility: a row written by a newer build must not surface a
    // status that fails every `status === ...` branch downstream.
    const d = await open()
    await d.files.put({
      vaultPath: m.db.vp(V, 'future.md'), vaultId: V, path: 'future.md',
      content: 'body', dirty: 7, updatedAt: 1,
    })

    const [rec] = await m.files.cacheLoadAll(V)
    expect(rec?.status).toBe('clean')
  })
})

// ── files.ts: local edit lifecycle ─────────────────────────────

describe('cache/files — recordLocalEdit', () => {
  it('stores a new file dirty with no base version', async () => {
    await m.files.recordLocalEdit(V, 'a.md', 'body')

    const [rec] = await m.files.cacheLoadAll(V)
    expect(rec).toMatchObject({ vaultPath: 'vault-1::a.md', vaultId: V, path: 'a.md', content: 'body', status: 'dirty' })
    expect(rec?.version).toBeUndefined()
  })

  it('preserves the base version the edit derives from', async () => {
    // The *base* token, not a fresh one: collision detection compares it
    // against the backend to decide whether the remote drifted under us.
    await m.files.setResolvedClean(V, 'a.md', 'remote', 'sha1')
    await m.files.recordLocalEdit(V, 'a.md', 'edited')

    expect(await rawRow(V, 'a.md')).toMatchObject({ content: 'edited', dirty: 1, version: 'sha1' })
  })

  it('is a no-op when the content is unchanged, so a clean file stays clean', async () => {
    await m.files.setResolvedClean(V, 'a.md', 'body', 'sha1')
    await m.files.recordLocalEdit(V, 'a.md', 'body')

    expect((await rawRow(V, 'a.md'))?.dirty).toBe(0)
  })
})

// ── files.ts: push confirmation (the mid-push CAS) ─────────────

describe('cache/files — markPushed', () => {
  it('marks the record clean and stamps the new version when the content still matches', async () => {
    await m.files.recordLocalEdit(V, 'a.md', 'body')
    await m.files.markPushed(V, 'a.md', 'body', 'sha1')

    expect(await rawRow(V, 'a.md')).toMatchObject({ content: 'body', dirty: 0, version: 'sha1' })
  })

  it('keeps an edit that landed during the push and only advances the version', async () => {
    // The silent-data-loss case: an unconditional clean write here would drop
    // the newer body AND clear its dirty flag, so nothing would look wrong
    // until the next reload.
    await m.files.recordLocalEdit(V, 'a.md', 'v1')
    await m.files.recordLocalEdit(V, 'a.md', 'v2')
    await m.files.markPushed(V, 'a.md', 'v1', 'sha1')

    expect(await rawRow(V, 'a.md')).toMatchObject({ content: 'v2', dirty: 1, version: 'sha1' })
  })

  it('lets a tombstone staged mid-push survive and inherit the fresh version', async () => {
    await m.files.setResolvedClean(V, 'a.md', 'body', 'sha1')
    await m.files.recordLocalDelete(V, 'a.md')
    await m.files.markPushed(V, 'a.md', 'body', 'sha2')

    expect(await rawRow(V, 'a.md')).toMatchObject({ content: '', dirty: 2, version: 'sha2' })
  })

  it('writes a clean record with no version when the push had none and no row existed', async () => {
    await m.files.markPushed(V, 'a.md', 'body')

    const row = await rawRow(V, 'a.md')
    expect(row).toMatchObject({ content: 'body', dirty: 0 })
    expect(row?.version).toBeUndefined()
  })
})

// ── files.ts: remote batch application ─────────────────────────

describe('cache/files — applyRemoteBatch', () => {
  it('writes clean and new records, skips locally-touched ones, and reports only what it wrote', async () => {
    // The skip window is real: reconcileWithBackend awaits a network read
    // between snapshotting the cache and calling this.
    await m.files.setResolvedClean(V, 'clean.md', 'old', 'sha1')
    await m.files.recordLocalEdit(V, 'dirty.md', 'local edit')
    await m.files.setResolvedClean(V, 'gone.md', 'old', 'sha9')
    await m.files.recordLocalDelete(V, 'gone.md')

    const written = await m.files.applyRemoteBatch(V, [
      { path: 'clean.md', content: 'remote', version: 'sha2' },
      { path: 'dirty.md', content: 'remote', version: 'sha3' },
      { path: 'gone.md',  content: 'remote', version: 'sha4' },
      { path: 'new.md',   content: 'remote', version: 'sha5' },
    ])

    expect([...written].sort()).toEqual(['clean.md', 'new.md'])
    expect(await rawRow(V, 'clean.md')).toMatchObject({ content: 'remote', dirty: 0, version: 'sha2' })
    expect(await rawRow(V, 'new.md')).toMatchObject({ content: 'remote', dirty: 0, version: 'sha5' })
    // Skipped records keep their stale base version, so the next push CASes
    // against it and detects the conflict instead of silently winning.
    expect(await rawRow(V, 'dirty.md')).toMatchObject({ content: 'local edit', dirty: 1 })
    expect(await rawRow(V, 'gone.md')).toMatchObject({ content: '', dirty: 2, version: 'sha9' })
  })

  it('handles an empty batch without opening a write', async () => {
    expect(await m.files.applyRemoteBatch(V, [])).toEqual([])
  })

  it('writes a record with no version when the backend supplied none', async () => {
    await m.files.applyRemoteBatch(V, [{ path: 'a.md', content: 'remote' }])

    const row = await rawRow(V, 'a.md')
    expect(row).toMatchObject({ content: 'remote', dirty: 0 })
    expect(row?.version).toBeUndefined()
  })
})

// ── files.ts: queries, counts and deletion ─────────────────────

describe('cache/files — queries', () => {
  beforeEach(async () => {
    await m.files.recordLocalEdit(V, 'dirty.md', 'body')
    await m.files.setResolvedClean(V, 'clean.md', 'body', 'sha1')
    await m.files.recordLocalDelete(V, 'gone.md')
    await m.files.recordLocalEdit(OTHER, 'other.md', 'body')
  })

  it('scopes cacheLoadAll to one vault', async () => {
    expect((await m.files.cacheLoadAll(V)).map(r => r.path).sort())
      .toEqual(['clean.md', 'dirty.md', 'gone.md'])
    expect((await m.files.cacheLoadAll(OTHER)).map(r => r.path)).toEqual(['other.md'])
  })

  it('returns only dirty records from cacheGetDirty', async () => {
    expect((await m.files.cacheGetDirty(V)).map(r => r.path)).toEqual(['dirty.md'])
  })

  it('returns only tombstones from cacheGetTombstones', async () => {
    expect((await m.files.cacheGetTombstones(V)).map(r => r.path)).toEqual(['gone.md'])
  })

  it('counts dirty and deleted records together, per vault', async () => {
    // Both count as unsynced work — the badge would under-report otherwise.
    expect(await m.files.cacheDirtyCount(V)).toBe(2)
    expect(await m.files.cacheDirtyCount(OTHER)).toBe(1)
  })

  it('drops a record entirely on confirmDeleted', async () => {
    await m.files.confirmDeleted(V, 'gone.md')

    expect(await rawRow(V, 'gone.md')).toBeUndefined()
    expect(await m.files.cacheDirtyCount(V)).toBe(1)
  })

  it('deletes only the named vault on cacheDeleteAll', async () => {
    await m.files.cacheDeleteAll(V)

    expect(await m.files.cacheLoadAll(V)).toEqual([])
    expect((await m.files.cacheLoadAll(OTHER)).map(r => r.path)).toEqual(['other.md'])
  })
})

describe('cache/files — cacheDirtyCount degrades to 0 rather than throwing', () => {
  it('returns 0 before the database has been opened', async () => {
    // It is called from render paths that must not force the DB open.
    expect(m.db.openedDb()).toBeNull()
    expect(await m.files.cacheDirtyCount(V)).toBe(0)
    expect(m.db.openedDb()).toBeNull()
  })

  it('returns 0 when the query fails on a closed database', async () => {
    await m.files.recordLocalEdit(V, 'a.md', 'body')
    const d = await open()
    d.close()

    expect(await m.files.cacheDirtyCount(V)).toBe(0)
  })
})

// ── credentials.ts ─────────────────────────────────────────────

describe('cache/credentials — tokens', () => {
  it('round-trips an access token and clears it', async () => {
    expect(await m.creds.tokenLoad(V)).toBeNull()

    await m.creds.tokenSave(V, 'gho_secret')
    expect(await m.creds.tokenLoad(V)).toBe('gho_secret')

    await m.creds.tokenClear(V)
    expect(await m.creds.tokenLoad(V)).toBeNull()
  })

  it('round-trips a refresh token and clears it', async () => {
    expect(await m.creds.refreshTokenLoad(V)).toBeNull()

    await m.creds.refreshTokenSave(V, 'ghr_secret')
    expect(await m.creds.refreshTokenLoad(V)).toBe('ghr_secret')

    await m.creds.refreshTokenClear(V)
    expect(await m.creds.refreshTokenLoad(V)).toBeNull()
  })

  it('round-trips a token expiry and clears it', async () => {
    expect(await m.creds.tokenExpiryLoad(V)).toBeNull()

    await m.creds.tokenExpirySave(V, 1_700_000_000_000)
    expect(await m.creds.tokenExpiryLoad(V)).toBe(1_700_000_000_000)

    await m.creds.tokenExpiryClear(V)
    expect(await m.creds.tokenExpiryLoad(V)).toBeNull()
  })

  it('keys every credential per vault', async () => {
    // A second GitHub vault must not inherit the first one's token — these
    // share one `meta` table, so the key prefixes are the whole isolation.
    await m.creds.tokenSave(V, 'token-1')
    await m.creds.refreshTokenSave(V, 'refresh-1')
    await m.creds.tokenExpirySave(V, 1)
    await m.creds.tokenSave(OTHER, 'token-2')

    expect(await m.creds.tokenLoad(OTHER)).toBe('token-2')
    expect(await m.creds.refreshTokenLoad(OTHER)).toBeNull()
    expect(await m.creds.tokenExpiryLoad(OTHER)).toBeNull()

    await m.creds.tokenClear(V)
    expect(await m.creds.tokenLoad(OTHER)).toBe('token-2')
  })

  it('rejects a stored value of the wrong type instead of returning it', async () => {
    const d = await open()
    await d.meta.put({ key: `token:${V}`,       value: 42 })
    await d.meta.put({ key: `refreshToken:${V}`, value: 42 })
    await d.meta.put({ key: `tokenExpiry:${V}`, value: 'not-a-number' })

    expect(await m.creds.tokenLoad(V)).toBeNull()
    expect(await m.creds.refreshTokenLoad(V)).toBeNull()
    expect(await m.creds.tokenExpiryLoad(V)).toBeNull()
  })
})

describe('cache/credentials — directory handles', () => {
  it('round-trips a directory handle and clears it', async () => {
    expect(await m.creds.handleLoad(V)).toBeNull()

    const handle = new FakeDirectoryHandle('vault-dir') as unknown as FileSystemDirectoryHandle
    await m.creds.handleSave(V, handle)
    expect(await m.creds.handleLoad(V)).toMatchObject({ name: 'vault-dir', kind: 'directory' })

    await m.creds.handleClear(V)
    expect(await m.creds.handleLoad(V)).toBeNull()
  })

  it('rejects a stored value that is not a directory handle', async () => {
    const d = await open()
    await d.meta.put({ key: `handle:${V}`, value: 'not-a-handle' })

    expect(await m.creds.handleLoad(V)).toBeNull()
  })
})

// ── registry.ts ────────────────────────────────────────────────

const localRef:  VaultRef = { id: V,     name: 'Local',  kind: 'local' }
const githubRef: VaultRef = { id: OTHER, name: 'GitHub', kind: 'github', github: { owner: 'o', repo: 'r', branch: 'main' } }
const icalRef:   VaultRef = { id: 'cal', name: 'Family', kind: 'ical', ical: { url: 'https://cal.example/f.ics' } }

describe('cache/registry — vault list', () => {
  it('returns an empty list before anything is saved', async () => {
    expect(await m.reg.vaultRefsLoad()).toEqual([])
  })

  it('round-trips the vault list', async () => {
    await m.reg.vaultRefsSave([localRef, githubRef, icalRef])

    expect(await m.reg.vaultRefsLoad()).toEqual([localRef, githubRef, icalRef])
  })

  it('drops an iCal ref that lost its feed URL', async () => {
    // Without the URL there is no backend to build, so the vault would mount
    // into a permanently empty layer. Rejecting it here is the cheaper failure.
    await m.reg.vaultRefsSave([
      icalRef,
      { id: 'a', name: 'No ical block', kind: 'ical' },
      { id: 'b', name: 'Empty ical block', kind: 'ical', ical: {} },
      { id: 'c', name: 'Non-string url', kind: 'ical', ical: { url: 42 } },
      { id: 'd', name: 'Null ical block', kind: 'ical', ical: null },
    ] as unknown as VaultRef[])

    expect(await m.reg.vaultRefsLoad()).toEqual([icalRef])
  })

  it('drops entries that are not vault refs', async () => {
    // The list survives across releases, so a row written by an older or
    // partly-failed build must not become a malformed VaultRef in the store.
    await m.reg.vaultRefsSave([
      localRef,
      null,
      'a string',
      { id: 'x' },
      { id: 'y', name: 'No kind' },
      { id: 'z', name: 'Bad kind', kind: 'ftp' },
      { id: 4, name: 'Numeric id', kind: 'local' },
    ] as unknown as VaultRef[])

    expect(await m.reg.vaultRefsLoad()).toEqual([localRef])
  })

  it('returns an empty list when the stored value is not an array', async () => {
    const d = await open()
    await d.meta.put({ key: 'vaults', value: 'nonsense' })

    expect(await m.reg.vaultRefsLoad()).toEqual([])
  })
})

describe('cache/registry — active vault', () => {
  it('round-trips the active vault id', async () => {
    expect(await m.reg.activeVaultIdLoad()).toBeNull()

    await m.reg.activeVaultIdSave(V)
    expect(await m.reg.activeVaultIdLoad()).toBe(V)
  })

  it('removes the row when set to null', async () => {
    await m.reg.activeVaultIdSave(V)
    await m.reg.activeVaultIdSave(null)

    const d = await open()
    expect(await d.meta.get('activeVaultId')).toBeUndefined()
    expect(await m.reg.activeVaultIdLoad()).toBeNull()
  })

  it('ignores a stored value of the wrong type', async () => {
    const d = await open()
    await d.meta.put({ key: 'activeVaultId', value: 42 })

    expect(await m.reg.activeVaultIdLoad()).toBeNull()
  })
})
