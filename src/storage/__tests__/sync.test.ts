/**
 * Unit tests for the effectful sync core in sync.ts: pushDirty's collision and
 * tombstone-conflict handling, runSync's auth-retry-after-401 logic, and the
 * exponential backoff that gates autoSyncTick.
 *
 * sync.ts is exercised only through its public surface (syncToBackend,
 * autoSyncTick, resetSyncBackoff) — pushDirty/resolveCollision/runSync are
 * module-private. `@/storage/cache/files`, `@/storeBridge`, and
 * `@/storage/notifications` are replaced with in-memory fakes so the test
 * doesn't need Dexie/IndexedDB or a DOM-backed zustand store/sonner toast.
 * `@/storage/inFlight` is deliberately NOT mocked — it holds no Dexie state,
 * so the real refcounted registry is what these tests exercise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StorageBackend, RawFile } from '@/storage/backend'
import type { VaultKind } from '@/vaultRef'
import type { VaultAttention } from '@/store'
import { ConflictError, AuthSyncError, TransientSyncError } from '@/storage/conflictError'
import type * as MeridianModel from '@/model'
import { entryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'

// ── Hoisted shared fakes (referenced by the vi.mock factories below, which
// run before the rest of this file's top-level code) ──────────────────────

const { cacheStore, storeState, notifyFns, roundTripLossMock } = vi.hoisted(() => ({
  cacheStore: new Map<string, {
    vaultPath: string; vaultId: string; path: string; content: string
    status: 'clean' | 'dirty' | 'deleted'; updatedAt: number; version?: string
  }>(),
  storeState: {
    /** Per-vault layers — the shape the real store holds. */
    layers: new Map<string, { items: unknown[]; roots: Map<string, unknown> }>(),
    /** The flattening of `layers`, maintained by the setVaultLayer mock exactly as the store does. */
    items: [] as unknown[],
    roots: new Map<string, unknown>(),
    unreadableFiles: new Map<string, { path: string; message: string }>(),
    /** vaultId → the fields `setVaultSync` writes. */
    syncByVault: new Map<string, {
      dirtyCount: number; error: string | null; offline: boolean
      inProgress: boolean; lastSyncedAt: number | null; readOnly: boolean
      needsAttention: VaultAttention | null
    }>(),
  },
  // `warnWithDetails` records the *rendered* details string, not the thunk, so
  // a test can assert on what the toast's "Copy details" action would hand the
  // user without reaching into sonner.
  notifyFns: {
    notify: vi.fn(), warn: vi.fn(), notifyError: vi.fn(),
    warnWithDetails: vi.fn((msg: string, details: () => string) => { void msg; void details() }),
  },
  // The round-trip guard is the only part of @/model stubbed here: it is
  // expected never to fire on a real file (see roundTripCheck.ts), so the tests
  // for its *scheduling* need to drive its verdict directly. Everything else in
  // @/model stays real — reconcile leans on the genuine parse/collapse.
  roundTripLossMock: vi.fn<(path: string, content: string, parsed: unknown) => string[]>(() => []),
}))

/** The FakeBackend's vault id — the one every fixture below belongs to. */
const VAULT = 'fake-vault'
/** `entryKey(VAULT, slug)` — the identity the store is keyed by. */
const K = (slug: string): EntryKey => entryKey(VAULT, slug)
/** A complete root for `slug`, including the runtime provenance a parse supplies. */
const rootFor = (slug: string, meta: { title: string; tags: string[]; items: string[] }) =>
  ({ ...meta, vaultId: VAULT, fileSlug: slug })

function vp(vaultId: string, path: string): string {
  return `${vaultId}::${path}`
}

vi.mock('@/storage/cache/files', () => {
  return {
    recordLocalEdit: vi.fn(async (vaultId: string, path: string, content: string) => {
      const key = vp(vaultId, path)
      const existing = cacheStore.get(key)
      if (existing && existing.content === content) return
      cacheStore.set(key, { vaultPath: key, vaultId, path, content, status: 'dirty', updatedAt: Date.now(), version: existing?.version })
    }),
    setResolvedClean: vi.fn(async (vaultId: string, path: string, content: string, version?: string) => {
      const key = vp(vaultId, path)
      cacheStore.set(key, { vaultPath: key, vaultId, path, content, status: 'clean', updatedAt: Date.now(), version })
    }),
    markPushed: vi.fn(async (vaultId: string, path: string, pushedContent: string, version?: string) => {
      const key = vp(vaultId, path)
      const existing = cacheStore.get(key)
      if (existing && existing.content !== pushedContent) {
        cacheStore.set(key, { ...existing, version, updatedAt: Date.now() })
        return
      }
      cacheStore.set(key, { vaultPath: key, vaultId, path, content: pushedContent, status: 'clean', updatedAt: Date.now(), version })
    }),
    applyRemoteBatch: vi.fn(async (vaultId: string, records: Array<{ path: string; content: string; version?: string }>) => {
      const written: string[] = []
      for (const r of records) {
        const key = vp(vaultId, r.path)
        const existing = cacheStore.get(key)
        if (existing && existing.status !== 'clean') continue
        cacheStore.set(key, { vaultPath: key, vaultId, path: r.path, content: r.content, status: 'clean', updatedAt: Date.now(), version: r.version })
        written.push(r.path)
      }
      return written
    }),
    cacheLoadAll: vi.fn(async (vaultId: string) => {
      return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId)
    }),
    confirmDeleted: vi.fn(async (vaultId: string, path: string) => {
      cacheStore.delete(vp(vaultId, path))
    }),
    cacheGetDirty: vi.fn(async (vaultId: string) => {
      return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId && r.status === 'dirty')
    }),
    recordLocalDelete: vi.fn(async (vaultId: string, path: string) => {
      const key = vp(vaultId, path)
      const existing = cacheStore.get(key)
      cacheStore.set(key, { vaultPath: key, vaultId, path, content: '', status: 'deleted', updatedAt: Date.now(), version: existing?.version })
    }),
    cacheGetTombstones: vi.fn(async (vaultId: string) => {
      return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId && r.status === 'deleted')
    }),
    cacheDirtyCount: vi.fn(async (vaultId: string) => {
      return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId && (r.status === 'dirty' || r.status === 'deleted')).length
    }),
  }
})

vi.mock('@/storeBridge', () => ({
  getVaultLayer: vi.fn((vaultId: string) => storeState.layers.get(vaultId) ?? { items: [], roots: new Map() }),
  setVaultLayer: vi.fn((vaultId: string, data: { items: unknown[]; roots: Map<string, unknown> }) => {
    storeState.layers.set(vaultId, data)
    // Re-flatten exactly as the real store does, so assertions on the merged
    // view stay meaningful and a cross-vault leak in the merge would show up.
    storeState.items = [...storeState.layers.values()].flatMap(l => l.items)
    storeState.roots = new Map([...storeState.layers.values()].flatMap(l => [...l.roots]))
  }),
  setVaultSync: vi.fn((vaultId: string, patch: Record<string, unknown>) => {
    const prev = storeState.syncByVault.get(vaultId) ?? {
      dirtyCount: 0, error: null, offline: false, inProgress: false, lastSyncedAt: null, readOnly: false,
      needsAttention: null,
    }
    storeState.syncByVault.set(vaultId, { ...prev, ...patch })
  }),
  getUnreadableFiles: vi.fn(() => storeState.unreadableFiles),
  setUnreadableFiles: vi.fn((files: Map<string, { path: string; message: string }>) => { storeState.unreadableFiles = files }),
  setStoreState: vi.fn((partial: Partial<typeof storeState>) => { Object.assign(storeState, partial) }),
}))

vi.mock('@/storage/notifications', () => notifyFns)

vi.mock('@/model', async (importActual) => ({
  ...await importActual<typeof MeridianModel>(),
  roundTripLoss: roundTripLossMock,
}))

// Imports of the module under test (and its non-mocked collaborators) must
// come after the vi.mock calls above.
import { syncToBackend, autoSyncTick, resetSyncBackoff, dropAllSyncState, flushPendingPush, syncOnActivate, writeEntityToCache, reconcileWithBackend, parseFiles, reportParseFailures } from '@/storage/sync'
import { mountBackend, unmountAllBackends } from '@/storage/backends'
import { syncJournalEvents, clearSyncJournal } from '@/storage/syncJournal'

/**
 * One vault's row in the mocked `syncByVault`. Defaults to the single vault
 * most of these tests use, so an assertion reads the same as it did when this
 * state was flat.
 */
function seedLayer(
  vaultId: string,
  items: unknown[],
  roots: Map<string, unknown> = new Map(),
): void {
  storeState.layers.set(vaultId, { items, roots })
  storeState.items = [...storeState.layers.values()].flatMap(l => l.items)
  storeState.roots = new Map([...storeState.layers.values()].flatMap(l => [...l.roots]))
}

function syncOf(vaultId = 'fake-vault') {
  return storeState.syncByVault.get(vaultId) ?? {
    dirtyCount: 0, error: null as string | null, offline: false,
    inProgress: false, lastSyncedAt: null as number | null, readOnly: false,
    needsAttention: null as VaultAttention | null,
  }
}
import { recordLocalEdit, recordLocalDelete } from '@/storage/cache/files'

// ── FakeBackend ──────────────────────────────────────────────────────────

type FakeFile = { content: string; version: string }

class FakeBackend implements StorageBackend {
  readonly id       = 'fake-vault'
  readonly name     = 'Fake'
  readonly kind: VaultKind = 'local'
  readonly readOnly = false
  readonly hasRemote = true
  refreshAuth?: () => Promise<boolean>

  writeCallCount     = 0
  deleteCallCount    = 0
  statAllCallCount   = 0
  readFilesCallCount = 0
  readAllCallCount   = 0

  private _files = new Map<string, FakeFile>()
  private _versionCounter = 0
  private _writeErrorQueue:   Error[] = []
  private _writeReportsNoVersion = false
  private _writeFailPattern:  { pattern: RegExp; error: () => Error } | null = null
  private _afterNextReadFiles: (() => void) | null = null
  private _deleteErrorQueue:  Error[] = []
  private _statAllErrorQueue: Error[] = []
  private _hidden = new Set<string>()
  private _pendingWriteGate: Promise<void> | null = null
  private _pendingReadFilesGate: Promise<void> | null = null

  seed(path: string, content: string, version: string): void {
    this._files.set(path, { content, version })
  }

  get(path: string): FakeFile | undefined { return this._files.get(path) }
  listPaths(): string[] { return Array.from(this._files.keys()) }

  queueWriteError(e: Error): void { this._writeErrorQueue.push(e) }

  /**
   * Make write() perform the write but report no new version token — which the
   * StorageBackend contract explicitly permits ("returns the new version token,
   * *if the backend can determine it*"), and which `diskWrite` really does when
   * its post-write re-stat throws.
   */
  writeReportsNoVersion(): void { this._writeReportsNoVersion = true }

  /** Fail every write whose path matches — used to simulate a network drop that
   *  lands specifically on the conflict-copy write, mid-resolution. */
  failWritesTo(pattern: RegExp, error: () => Error): void {
    this._writeFailPattern = { pattern, error }
  }

  /** Run `fn` once, immediately after the next readFiles() resolves — lets a
   *  test land a concurrent remote change inside a resolution's own window. */
  onNextReadFiles(fn: () => void): void { this._afterNextReadFiles = fn }
  queueDeleteError(e: Error): void { this._deleteErrorQueue.push(e) }
  queueStatAllError(e: Error): void { this._statAllErrorQueue.push(e) }

  /** Simulates GitHub's eventually-consistent git-trees listing omitting a
   * file that genuinely exists on the backend — statAll() won't report it,
   * but readFiles()/get() still serve it, matching the real API's split
   * between the trees endpoint and the Contents API. */
  hideFromListing(path: string): void { this._hidden.add(path) }

  /** Holds the next write() call pending until the returned function is
   * called — simulates a slow network round trip so a test can land a
   * concurrent local edit while the push is still in flight. */
  blockNextWrite(): () => void {
    let release!: () => void
    this._pendingWriteGate = new Promise<void>(resolve => { release = resolve })
    return release
  }

  /** Holds the next readFiles() call pending — simulates the network read a
   * reconcile does between its cacheLoadAll snapshot and writing the fresh
   * content back clean, so a test can land a concurrent local edit in that
   * window. */
  blockNextReadFiles(): () => void {
    let release!: () => void
    this._pendingReadFilesGate = new Promise<void>(resolve => { release = resolve })
    return release
  }

  async statAll(): Promise<Map<string, string>> {
    this.statAllCallCount++
    if (this._statAllErrorQueue.length) throw this._statAllErrorQueue.shift()!
    const m = new Map<string, string>()
    for (const [p, f] of this._files) {
      if (this._hidden.has(p)) continue
      m.set(p, f.version)
    }
    return m
  }

  async readFiles(paths: string[]): Promise<RawFile[]> {
    this.readFilesCallCount++
    if (this._pendingReadFilesGate) {
      const gate = this._pendingReadFilesGate
      this._pendingReadFilesGate = null
      await gate
    }
    const result = paths.flatMap(p => {
      const f = this._files.get(p)
      return f ? [{ path: p, content: f.content, version: f.version }] : []
    })
    if (this._afterNextReadFiles) {
      const fn = this._afterNextReadFiles
      this._afterNextReadFiles = null
      fn()
    }
    return result
  }

  async readAll(): Promise<RawFile[]> {
    this.readAllCallCount++
    return Array.from(this._files.entries()).map(([p, f]) => ({ path: p, content: f.content, version: f.version }))
  }

  async write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> {
    this.writeCallCount++
    if (this._writeErrorQueue.length) throw this._writeErrorQueue.shift()!
    if (this._writeFailPattern?.pattern.test(path)) throw this._writeFailPattern.error()
    if (this._pendingWriteGate) {
      const gate = this._pendingWriteGate
      this._pendingWriteGate = null
      await gate
    }
    const existing = this._files.get(path)
    if (expectedVersion !== undefined) {
      if (existing === undefined || existing.version !== expectedVersion) throw new ConflictError(path)
    } else if (existing !== undefined) {
      throw new ConflictError(path)
    }
    const newVersion = `v${++this._versionCounter}`
    this._files.set(path, { content, version: newVersion })
    return this._writeReportsNoVersion ? undefined : newVersion
  }

  async delete(path: string, expectedVersion?: string): Promise<void> {
    this.deleteCallCount++
    if (this._deleteErrorQueue.length) throw this._deleteErrorQueue.shift()!
    const existing = this._files.get(path)
    if (existing === undefined) return
    if (expectedVersion !== undefined && existing.version !== expectedVersion) throw new ConflictError(path)
    this._files.delete(path)
  }

  async ensurePermission(): Promise<PermissionState> { return 'granted' }
}

function seedDirty(vaultId: string, path: string, content: string, version: string | undefined): void {
  cacheStore.set(vp(vaultId, path), { vaultPath: vp(vaultId, path), vaultId, path, content, status: 'dirty', updatedAt: Date.now(), version })
}

function seedTombstone(vaultId: string, path: string, version: string | undefined): void {
  cacheStore.set(vp(vaultId, path), { vaultPath: vp(vaultId, path), vaultId, path, content: '', status: 'deleted', updatedAt: Date.now(), version })
}

function seedClean(vaultId: string, path: string, content: string, version: string | undefined, updatedAt: number): void {
  cacheStore.set(vp(vaultId, path), { vaultPath: vp(vaultId, path), vaultId, path, content, status: 'clean', updatedAt, version })
}

// autoSyncTick fires runSync fire-and-forget (`void runSync(...)`), so it
// doesn't return a promise callers can await. Flush a real macrotask so any
// pending microtasks from the in-flight runSync settle before we assert.
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  cacheStore.clear()
  storeState.items = []
  storeState.roots = new Map()
  storeState.unreadableFiles = new Map()
  storeState.layers.clear()
  storeState.syncByVault.clear()
  notifyFns.notify.mockClear()
  notifyFns.warn.mockClear()
  notifyFns.warnWithDetails.mockClear()
  clearSyncJournal()
  notifyFns.notifyError.mockClear()
  roundTripLossMock.mockClear()
  roundTripLossMock.mockReturnValue([])
  unmountAllBackends()
  // Per-vault sync state is module-level and now survives a backend being
  // unmounted, so it has to be dropped explicitly — otherwise one test's
  // lastAttemptAt paces the next test's scheduler.
  dropAllSyncState()
  resetSyncBackoff()
})

// ── Write-conflict collision copy-out ───────────────────────────────────

describe('pushDirty — write-conflict collision', () => {
  it('pulls the fresh remote copy, writes local content to a timestamped conflict copy, and warns', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    mountBackend(backend)

    // Local dirty edit derived from base 'sha1', but the backend has since
    // diverged (simulates another device pushing 'remote v2' first).
    await backend.write('task.md', 'remote v2', 'sha1')
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    await syncToBackend()

    const paths = backend.listPaths()
    expect(paths).toContain('task.md')
    expect(backend.get('task.md')?.content).toBe('remote v2')

    const copyPath = paths.find(p => p !== 'task.md' && /^task_\d{8}-\d{6}\.md$/.test(p))
    expect(copyPath).toBeDefined()
    expect(backend.get(copyPath!)?.content).toBe('local edit')

    // Cache reflects both paths as clean (no more dirty edit lost or left dangling).
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.status).toBe('clean')
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.content).toBe('remote v2')
    expect(cacheStore.get(vp('fake-vault', copyPath!))?.status).toBe('clean')

    // Both the reverted original and the new conflict copy must be visible in
    // the store immediately — not just the cache — since a same-cycle
    // reconcile deliberately skips paths this cycle already resolved (see
    // planReconcile's skipPaths) and would otherwise leave them invisible
    // until a later reconcile or a full restart re-hydrate.
    const taskRoot = storeState.roots.get(K('task')) as { body?: string } | undefined
    expect(taskRoot?.body).toBe('remote v2')
    const copySlug = copyPath!.replace(/\.md$/, '')
    const copyRoot = storeState.roots.get(K(copySlug)) as { body?: string } | undefined
    expect(copyRoot?.body).toBe('local edit')

    expect(notifyFns.warnWithDetails).toHaveBeenCalledTimes(1)
    expect(notifyFns.warnWithDetails.mock.calls[0]![0]).toContain('task.md')

    // The collision doesn't surface as a sync failure — it's a handled outcome.
    expect(syncOf().error).toBeNull()
  })

  // Data-integrity survey, finding #1. resolveCollision used to revert the dirty
  // cache record to the remote copy BEFORE writing the local content anywhere,
  // so a failure in between left the edit in neither place — while the UI
  // reported "changes are saved locally and will sync when you reconnect".
  it('keeps the local edit recoverable when the conflict-copy write fails mid-resolution', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    mountBackend(backend)
    await backend.write('task.md', 'REMOTE v2', 'sha1')          // another device pushed first
    seedDirty('fake-vault', 'task.md', 'MY LOCAL EDIT', 'sha1')
    // The network drops precisely on the conflict-copy write.
    backend.failWritesTo(/^task_\d/, () => new TransientSyncError('Failed to fetch'))

    await syncToBackend()

    // The edit must survive somewhere: either copied out, or still dirty for
    // the next cycle. What must never happen is neither.
    const copy = backend.listPaths().find(p => p !== 'task.md')
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    const survived = copy ? backend.get(copy)!.content : cached?.content
    expect(survived).toBe('MY LOCAL EDIT')
    // Specifically: the record stays dirty, so the next sync retries it.
    expect(cached?.status).toBe('dirty')
  })

  // Two collisions on one path inside the same second used to generate the same
  // conflict-copy name twice; the second write hit an existing file and the
  // ConflictError escaped resolveCollision, surfacing as an actionable sync
  // failure rather than being handled.
  it('finds a free name when two conflicts on one path land in the same second', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 31, 8, 0, 0).getTime())
    try {
      backend.seed('a.md', 'r1', 'sha1')
      await backend.write('a.md', 'R2', 'sha1')
      seedDirty('fake-vault', 'a.md', 'local one', 'sha1')
      await syncToBackend()

      // Second conflict on the same path, same wall-clock second.
      await backend.write('a.md', 'R3', backend.get('a.md')!.version)
      seedDirty('fake-vault', 'a.md', 'local two', 'stale')
      await syncToBackend()
    } finally {
      vi.useRealTimers()
    }

    const copies = backend.listPaths().filter(p => p !== 'a.md')
    expect(copies).toHaveLength(2)
    expect(copies.map(p => backend.get(p)!.content).sort()).toEqual(['local one', 'local two'])
    expect(syncOf().error).toBeNull()
  })
})

// ── Remote-deleted file with a pending local edit ────────────────────────
//
// An edit beats a delete — the same rule the tombstone branch below applies
// from the other side. The local content is restored at its ORIGINAL path
// rather than landing in a conflict copy: a copy would orphan every wikilink
// pointing at this slug, and re-deleting is one gesture where finding a stray
// copy and renaming it back is several.

describe('pushDirty — the file was deleted remotely while a local edit was pending', () => {
  it('restores the local content at its original path and tells the user', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    // The file existed (base version sha1) but another device deleted it.
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    await syncToBackend()

    expect(backend.get('task.md')?.content).toBe('local edit')
    // No conflict copy — the path itself is kept.
    expect(backend.listPaths()).toEqual(['task.md'])
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.status).toBe('clean')
    expect(cached?.version).toBeDefined()   // a real token, so the next edit CASes correctly
    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
    expect(notifyFns.warn.mock.calls[0]![0]).toContain('deleted on another device')
    expect(syncOf().error).toBeNull()
  })

  it('converges — repeated syncs do not pile up conflict copies', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    vi.useFakeTimers({ toFake: ['Date'] })
    let now = new Date(2026, 6, 31, 8, 0, 0).getTime()
    try {
      for (let i = 0; i < 4; i++) {
        vi.setSystemTime(now)
        await syncToBackend()
        now += 61_000   // one autoSyncTick apart
      }
    } finally {
      vi.useRealTimers()
    }

    // Previously: one new conflict copy per tick, forever, with task.md stuck dirty.
    expect(backend.listPaths()).toEqual(['task.md'])
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.status).toBe('clean')
    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
  })

  it('falls back to a conflict copy if the path is re-created mid-resolution', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')
    // readFiles reports the path as gone, but a create lands before ours does —
    // the recreate must not clobber it.
    backend.onNextReadFiles(() => { backend.seed('task.md', 'RECREATED REMOTELY', 'sha9') })

    await syncToBackend()

    expect(backend.get('task.md')?.content).toBe('RECREATED REMOTELY')
    const copy = backend.listPaths().find(p => p !== 'task.md')
    expect(copy).toBeDefined()
    expect(backend.get(copy!)?.content).toBe('local edit')
  })
})

// ── Spurious conflicts: a refused write with nothing actually diverged ──
//
// Every case here has exactly one writer — this app, this device. A conflict
// copy in any of them is a duplicate entry conjured out of nothing, which is
// what the user sees: "a conflict warning and a resulting duplicate", with
// nobody else involved.

describe('pushDirty — a refused write that did not actually diverge', () => {
  it('adopts the backend version when the backend already holds exactly our content', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    // The write landed, but the response never came back as success — GitHub's
    // Contents API answers 409 when it cannot fast-forward the branch ref
    // behind a commit pushed moments earlier, which is routine when one user
    // action writes two files and then edits one again. Our base version is
    // stale precisely because our own earlier write is what moved it.
    backend.seed('task.md', 'local edit', 'sha2')
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    await syncToBackend()

    // No conflict copy anywhere — not on the backend, not in the cache, not in
    // the store (which is where the user would see the duplicate).
    expect(backend.listPaths()).toEqual(['task.md'])
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.status).toBe('clean')
    expect(cached?.version).toBe('sha2')
    expect(notifyFns.warnWithDetails).not.toHaveBeenCalled()
    expect(notifyFns.warn).not.toHaveBeenCalled()
    expect(syncOf().error).toBeNull()
  })

  it('retries once when the backend is still at the version the write was conditioned on', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    mountBackend(backend)
    // A refusal that carries no divergence at all: the precondition we sent is
    // still exactly what the backend holds, so no second writer can exist.
    backend.queueWriteError(new ConflictError('task.md', { status: 409, reason: 'is at 0000 but expected 1111' }))
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    await syncToBackend()

    expect(backend.listPaths()).toEqual(['task.md'])
    expect(backend.get('task.md')?.content).toBe('local edit')
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.status).toBe('clean')
    expect(cached?.content).toBe('local edit')
    expect(cached?.version).toBe(backend.get('task.md')?.version)
    expect(notifyFns.warnWithDetails).not.toHaveBeenCalled()
    expect(syncOf().error).toBeNull()
  })

  it('leaves a journal trail naming the layer each step happened in', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    mountBackend(backend)
    await backend.write('task.md', 'remote v2', 'sha1')
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')
    clearSyncJournal()

    await syncToBackend()

    const kinds = syncJournalEvents({ path: 'task.md' }).map(e => e.kind)
    // The chain a conflict investigation has to walk, in order: what went out,
    // that the backend refused it, and which resolution branch that led to.
    expect(kinds).toEqual(['push', 'push-conflict', 'collision-copied'])

    const copied = syncJournalEvents({ path: 'task.md' }).find(e => e.kind === 'collision-copied')!
    expect(copied.backend).toBe('local')
    // Both version tokens, and the fingerprints that say whether the two sides
    // actually differ — the facts that make a spurious conflict falsifiable.
    expect(copied.detail?.expected).toBe('sha1')
    expect(copied.detail?.actual).not.toBe('sha1')
    expect(copied.detail?.localHash).not.toBe(copied.detail?.remoteHash)
  })

  it('still copies out when a second refusal shows the remote genuinely moved', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    mountBackend(backend)
    // First write refused with the base version still intact, so the retry
    // fires — and loses, because a real remote edit lands in between.
    backend.queueWriteError(new ConflictError('task.md'))
    backend.onNextReadFiles(() => { backend.seed('task.md', 'remote v2', 'sha9') })
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    await syncToBackend()

    expect(backend.get('task.md')?.content).toBe('remote v2')
    const copy = backend.listPaths().find(p => p !== 'task.md')
    expect(copy).toBeDefined()
    expect(backend.get(copy!)?.content).toBe('local edit')
    expect(notifyFns.warnWithDetails).toHaveBeenCalledTimes(1)
  })

  it('records the version by re-reading when the backend cannot report one, so the next push is not a false create', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    backend.writeReportsNoVersion()
    // A brand-new file: no base version, so this push goes out as a create.
    seedDirty('fake-vault', 'new.md', 'first', undefined)

    await syncToBackend()

    // Recording `undefined` here would make the next push a create too, and
    // "the path must be absent" is refused by every backend for a file that
    // plainly exists — a conflict, and a duplicate, entirely of our own making.
    const afterCreate = cacheStore.get(vp('fake-vault', 'new.md'))
    expect(afterCreate?.status).toBe('clean')
    expect(afterCreate?.version).toBe(backend.get('new.md')?.version)

    // The second edit of the same file — the step in the reported repro that
    // produced the conflict — must push cleanly.
    seedDirty('fake-vault', 'new.md', 'second', afterCreate?.version)
    await syncToBackend()

    expect(backend.listPaths()).toEqual(['new.md'])
    expect(backend.get('new.md')?.content).toBe('second')
    expect(notifyFns.warnWithDetails).not.toHaveBeenCalled()
  })
})

// ── Delete-conflict (tombstone) handling ────────────────────────────────

describe('pushDirty — delete-conflict tombstone handling', () => {
  it('drops the tombstone and keeps the remote edit instead of destroying it', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'original', 'sha1')
    mountBackend(backend)

    // A remote edit lands after the local delete was staged — the tombstone
    // still holds the stale base version 'sha1'.
    await backend.write('task.md', 'remote edit after delete staged', 'sha1')
    seedTombstone('fake-vault', 'task.md', 'sha1')

    await syncToBackend()

    // The remote file must survive, not be deleted.
    expect(backend.get('task.md')?.content).toBe('remote edit after delete staged')
    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
    expect(notifyFns.warn.mock.calls[0]![0]).toContain('task.md')

    // hadCollision triggers a same-cycle reconcile that pulls the surviving
    // remote edit back into the cache as a clean record.
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.status).toBe('clean')
    expect(cached?.content).toBe('remote edit after delete staged')

    expect(syncOf().error).toBeNull()
  })

  it('is idempotent when the remote file is already gone', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    seedTombstone('fake-vault', 'gone.md', 'sha1')

    await syncToBackend()

    expect(backend.listPaths()).not.toContain('gone.md')
    expect(cacheStore.has(vp('fake-vault', 'gone.md'))).toBe(false)
    expect(notifyFns.warn).not.toHaveBeenCalled()
    expect(syncOf().error).toBeNull()
  })
})

// ── Post-push clean write must not clobber a concurrent edit ────────────
//
// pushDirty captures a dirty record's content before awaiting backend.write()
// — a real network round trip. If another edit to that same path lands
// during the wait, the post-push write must not silently discard it (or
// resurrect it as clean) just because the push that started earlier
// finishes later. See markPushed's doc comment in cache/files.ts.

describe('pushDirty — post-push write does not clobber a concurrent edit', () => {
  it('keeps an edit that lands while the push is still in flight', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'original', 'sha1')
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'C1', 'sha1')

    const release = backend.blockNextWrite()
    const syncPromise = syncToBackend()
    await flush() // let pushDirty capture its dirty/tombstone snapshots and reach the blocked write

    // Lands while backend.write('task.md', 'C1', ...) is still pending.
    await recordLocalEdit('fake-vault', 'task.md', 'C2')
    release()
    await syncPromise

    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.content).toBe('C2')
    expect(cached?.status).toBe('dirty')
    // The base version still advances, so the next push CASes against what
    // was actually written to the backend.
    expect(cached?.version).toBe('v1')
  })

  it('keeps a tombstone staged while the push is still in flight, with the fresh version', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'original', 'sha1')
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'C1', 'sha1')

    const release = backend.blockNextWrite()
    const syncPromise = syncToBackend()
    await flush() // let pushDirty capture its dirty/tombstone snapshots and reach the blocked write

    // The file is deleted locally while the earlier edit's push is in flight —
    // after pushDirty already captured its (empty) tombstone snapshot, so this
    // tombstone is NOT swept into the same pushDirty call's tombstone loop.
    await recordLocalDelete('fake-vault', 'task.md')
    release()
    await syncPromise

    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.status).toBe('deleted')
    expect(cached?.content).toBe('')
    expect(cached?.version).toBe('v1')
  })
})

// ── Auth-retry-after-401 ─────────────────────────────────────────────────

describe('runSync — auth retry after 401', () => {
  it('retries once via backend.refreshAuth() and succeeds on the retry', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    const refreshAuth = vi.fn().mockResolvedValue(true)
    backend.refreshAuth = refreshAuth
    backend.queueWriteError(new AuthSyncError('401 unauthorized'))

    await syncToBackend()

    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(backend.writeCallCount).toBe(2) // failed attempt + retry
    expect(backend.get('task.md')?.content).toBe('local edit')
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.status).toBe('clean')
    expect(syncOf().error).toBeNull()
    expect(syncOf().lastSyncedAt).not.toBeNull()
    expect(syncOf().needsAttention).toBeNull()
  })

  it('surfaces an actionable error when refreshAuth fails to recover', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    backend.refreshAuth = vi.fn().mockResolvedValue(false)
    backend.queueWriteError(new AuthSyncError('401 unauthorized'))

    await syncToBackend()

    expect(backend.refreshAuth).toHaveBeenCalledTimes(1)
    expect(backend.writeCallCount).toBe(1) // no retry attempted
    expect(syncOf().error).toBe('401 unauthorized')
    expect(syncOf().needsAttention).toEqual({ kind: 'reauth', message: '401 unauthorized' })
    expect(notifyFns.notifyError).toHaveBeenCalledTimes(1)
    // The dirty edit is preserved locally rather than lost.
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.status).toBe('dirty')
  })

  it('does not attempt a retry when the backend has no refreshAuth recovery path', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    backend.queueWriteError(new AuthSyncError('token revoked'))

    await syncToBackend()

    expect(backend.writeCallCount).toBe(1)
    expect(syncOf().error).toBe('token revoked')
    expect(syncOf().needsAttention).toEqual({ kind: 'reauth', message: 'token revoked' })
  })
})

// ── needsAttention by failure kind ────────────────────────────────────────
//
// AuthSyncError carries the FailureKind that produced it (see
// storage/failureKind.ts and mapGitHubError). runSync's job is only to
// translate that into the store's AttentionKind — 'auth' becomes 'reauth'
// since it names the fix, the other two pass through unchanged.

describe('runSync — needsAttention by AuthSyncError kind', () => {
  it('sets needsAttention: access when the App/user has lost repo access', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    backend.queueStatAllError(new AuthSyncError('Meridian no longer has write access — check the App\'s repository access on GitHub.', 'access'))

    await syncToBackend()

    expect(syncOf().needsAttention).toEqual({
      kind: 'access', message: 'Meridian no longer has write access — check the App\'s repository access on GitHub.',
    })
  })

  it('sets needsAttention: config when the repo or branch is gone', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    backend.queueStatAllError(new AuthSyncError("That repository or branch isn't reachable — it may have been renamed, deleted, or removed from the App.", 'config'))

    await syncToBackend()

    expect(syncOf().needsAttention).toEqual({
      kind: 'config', message: "That repository or branch isn't reachable — it may have been renamed, deleted, or removed from the App.",
    })
  })

  it('leaves needsAttention untouched for an actionable failure that is not an AuthSyncError', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')
    // Not wrapped as ConflictError (that's auto-resolved inside pushDirty and
    // never reaches this catch) — a generic actionable error that isn't
    // AuthSyncError is the case this guards: needsAttention is only ever
    // written for the three AuthSyncError kinds.
    backend.queueWriteError(Object.assign(new Error('validation failed'), { status: 422 }))

    await syncToBackend()

    expect(syncOf().error).not.toBeNull()
    expect(syncOf().needsAttention).toBeNull()
  })
})

// ── Backoff transitions ───────────────────────────────────────────────────

describe('runSync — exponential backoff on transient failures', () => {
  it('backs off after consecutive transient failures and gates autoSyncTick until it elapses, while manual sync always bypasses the gate', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)

    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    try {
      backend.queueStatAllError(new TransientSyncError('offline'))
      await syncToBackend() // failure #1 → backoff = 60_000ms
      expect(syncOf().offline).toBe(true)
      expect(backend.statAllCallCount).toBe(1)

      // Immediately after: still within the backoff window, autoSyncTick is gated.
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(1)

      // Just short of the 60s window: still gated.
      now += 59_000
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(1)

      // Past the 60s window: autoSyncTick attempts again and fails again,
      // doubling the backoff to 120_000ms.
      now += 2_000
      backend.queueStatAllError(new TransientSyncError('offline'))
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(2)
      expect(syncOf().offline).toBe(true)

      // Manual sync bypasses the backoff gate immediately, even mid-window.
      now += 500
      await syncToBackend() // succeeds — no error queued this time
      expect(backend.statAllCallCount).toBe(3)
      expect(syncOf().offline).toBe(false)

      // A successful sync resets the backoff. The next tick is then paced only
      // by this vault kind's own minimum interval (local: 30s) rather than by
      // a backoff window that would have been 240s by now.
      now += 500
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(3) // inside the 30s minimum

      now += 30_000
      backend.queueStatAllError(new TransientSyncError('offline'))
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(4)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('caps backoff at 30 minutes after many consecutive failures', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)

    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    try {
      // Fail enough times in a row (manual sync bypasses the gate each time,
      // so we can drive consecutive failures without needing to wait out
      // each backoff window) to exceed the 30-minute cap.
      for (let i = 0; i < 6; i++) {
        backend.queueStatAllError(new TransientSyncError('offline'))
        await syncToBackend()
      }
      expect(syncOf().offline).toBe(true)

      // 6th failure: backoff = min(60_000 * 2^5, 1_800_000) = min(1_920_000, 1_800_000) = 1_800_000
      now += 1_800_000 - 1
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(6) // still gated, one ms short

      now += 1
      autoSyncTick()
      await flush()
      expect(backend.statAllCallCount).toBe(7) // gate has now elapsed
    } finally {
      nowSpy.mockRestore()
    }
  })
})

// ── Grace window protects a just-pushed file from a stale listing ───────

describe('reconcileWithBackend — an eventually-consistent listing must not delete a just-pushed file', () => {
  it('keeps a just-pushed record the listing has not caught up to yet', async () => {
    const backend = new FakeBackend()
    backend.seed('new.md', 'content', 'v1')
    backend.hideFromListing('new.md') // simulates the trees API lagging behind the push

    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    try {
      seedClean('fake-vault', 'new.md', 'content', 'v1', now)
      storeState.roots.set(K('new'), rootFor('new', { title: 'New', tags: [], items: [] }))
      mountBackend(backend)

      now += 60_000 // one autoSyncTick interval later — well inside the 5-minute grace window
      await syncToBackend()

      expect(cacheStore.has(vp('fake-vault', 'new.md'))).toBe(true)
      expect(storeState.roots.has(K('new'))).toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('still propagates a genuine remote delete (old updatedAt, absent from the backend)', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    seedClean('fake-vault', 'old.md', 'content', 'v1', 0) // written long ago, well outside the window
    storeState.roots.set(K('old'), rootFor('old', { title: 'Old', tags: [], items: [] }))

    await syncToBackend()

    expect(cacheStore.has(vp('fake-vault', 'old.md'))).toBe(false)
    expect(storeState.roots.has(K('old'))).toBe(false)
  })
})

// ── Large-reconcile routing (readAll vs. readFiles) ─────────────────────

describe('reconcileWithBackend — large changed sets route through readAll()', () => {
  it('uses readAll() instead of a per-file readFiles() fan-out above the threshold', async () => {
    const backend = new FakeBackend()
    // 51 remote-only files: none cached yet, so planReconcile marks all of them
    // "changed" — above LARGE_RECONCILE_THRESHOLD (50), this must route through
    // readAll() rather than reproducing a 51-request readFiles() fan-out.
    for (let i = 0; i < 51; i++) backend.seed(`note-${i}.md`, `content ${i}`, `sha${i}`)
    mountBackend(backend)

    await syncToBackend()

    expect(backend.readAllCallCount).toBe(1)
    expect(backend.readFilesCallCount).toBe(0)
    for (let i = 0; i < 51; i++) {
      const cached = cacheStore.get(vp('fake-vault', `note-${i}.md`))
      expect(cached?.content).toBe(`content ${i}`)
      expect(cached?.status).toBe('clean')
    }
  })

  it('still uses readFiles() for small changed sets at/below the threshold', async () => {
    const backend = new FakeBackend()
    backend.seed('note.md', 'content', 'sha1')
    mountBackend(backend)

    await syncToBackend()

    expect(backend.readFilesCallCount).toBe(1)
    expect(backend.readAllCallCount).toBe(0)
    expect(cacheStore.get(vp('fake-vault', 'note.md'))?.content).toBe('content')
  })
})

// ── Bulk clean write must not clobber a concurrent edit ──────────────────
//
// reconcileWithBackend snapshots the cache (cacheLoadAll), decides what's
// changed, then awaits a real network read (readFiles/readAll) before
// writing the fresh content back clean. A local edit landing in that window
// must not be silently overwritten — same class of bug as PR 3's
// markPushed, just on the pull side and across a whole batch.

describe('reconcileWithBackend — a local edit landing mid-reconcile is not clobbered by the bulk clean write', () => {
  it('does not merge stale remote content over a local edit that lands between the cache snapshot and the write-back', async () => {
    const backend = new FakeBackend()
    backend.seed('note.md', 'remote v2', 'v2')
    mountBackend(backend)
    seedClean('fake-vault', 'note.md', 'remote v1', 'v1', Date.now()) // clean, version drifted → planReconcile marks it "changed"
    seedLayer('fake-vault', [], new Map([[K('note'), rootFor('note', { title: 'Local Edit', tags: [], items: [] })]]))

    const release = backend.blockNextReadFiles()
    const reconcilePromise = reconcileWithBackend(backend, 'fake-vault')
    await flush() // let reconcile capture its cacheLoadAll snapshot and reach the blocked readFiles call

    // Lands while backend.readFiles(['note.md']) is still pending — after
    // reconcile's cacheLoadAll snapshot but before it writes fresh content back.
    await recordLocalEdit('fake-vault', 'note.md', 'local edit')
    release()
    await reconcilePromise

    const cached = cacheStore.get(vp('fake-vault', 'note.md'))
    expect(cached?.status).toBe('dirty')
    expect(cached?.content).toBe('local edit')
    // The store must still show the local edit — not overwritten by the
    // now-stale remote pull.
    expect((storeState.roots.get(K('note')) as { title?: string } | undefined)?.title).toBe('Local Edit')
  })

  it('still writes and merges other paths in the same batch that were not touched locally', async () => {
    const backend = new FakeBackend()
    backend.seed('untouched.md', 'remote content', 'v2')
    backend.seed('edited.md', 'remote content 2', 'v2')
    mountBackend(backend)
    seedClean('fake-vault', 'untouched.md', 'old content', 'v1', Date.now())
    seedClean('fake-vault', 'edited.md', 'old content 2', 'v1', Date.now())

    const release = backend.blockNextReadFiles()
    const reconcilePromise = reconcileWithBackend(backend, 'fake-vault')
    await flush() // let reconcile capture its cacheLoadAll snapshot and reach the blocked readFiles call

    await recordLocalEdit('fake-vault', 'edited.md', 'local edit')
    release()
    await reconcilePromise

    expect(cacheStore.get(vp('fake-vault', 'untouched.md'))?.status).toBe('clean')
    expect(cacheStore.get(vp('fake-vault', 'untouched.md'))?.content).toBe('remote content')
    expect(cacheStore.get(vp('fake-vault', 'edited.md'))?.status).toBe('dirty')
    expect(cacheStore.get(vp('fake-vault', 'edited.md'))?.content).toBe('local edit')
  })
})

// ── reconcileWithBackend — the vault unregistered underneath an in-flight sync ──
//
// Reachable because registration fires its first sync un-awaited: the user can
// remove a vault in Settings while it is still running. The cache writes stay
// correct either way (they are keyed by vaultId, and removeVault drops those
// rows itself), but merging into the store would resurrect the layer that
// removal just dropped.
//
// Note what is NOT a hazard any more: another vault's reconcile landing late
// can no longer paint over this one, because each reconcile writes only its
// own layer.

describe('reconcileWithBackend — the vault being unregistered mid-flight', () => {
  it('still writes the cache but does not merge into the store when the vault was unmounted', async () => {
    const backend = new FakeBackend()
    backend.seed('note.md', 'remote v2', 'v2')
    mountBackend(backend)
    seedClean('fake-vault', 'note.md', 'remote v1', 'v1', Date.now())
    seedLayer('fake-vault', [{ entryKey: K('note') }])

    const release = backend.blockNextReadFiles()
    const reconcilePromise = reconcileWithBackend(backend, 'fake-vault')
    await flush()

    // The user removes the vault while readFiles is still in flight.
    unmountAllBackends()
    release()
    await reconcilePromise

    // Cache write completed — it is keyed by vaultId and stays correct.
    expect(cacheStore.get(vp('fake-vault', 'note.md'))?.content).toBe('remote v2')
    // ...but the layer was not rebuilt under a vault that no longer exists.
    expect(storeState.items).toEqual([{ entryKey: K('note') }])
  })
})

// ── Debounced push queued (not dropped) while a sync is already running ────

describe('scheduleAutoPush / attemptPush — never strand a push dropped mid-sync', () => {
  it('queues a push requested while a sync is in flight and retries it once that sync settles', async () => {
    vi.useFakeTimers()
    try {
      const backend = new FakeBackend()
      mountBackend(backend)

      // runSync sets the module-private `_syncing` flag synchronously, before
      // its first internal await — so this captures the "sync already
      // running" window without needing to artificially block the backend.
      const syncPromise = syncToBackend()

      // A dirty write lands (and its debounced auto-push timer fires) while
      // the first sync above is still in flight. Before this fix, runSync's
      // `if (_syncing) return` silently dropped this request; it wouldn't be
      // retried until the next 60s autoSyncTick.
      seedDirty('fake-vault', 'task.md', 'queued content', undefined)
      flushPendingPush()

      await syncPromise
      expect(backend.writeCallCount).toBe(0) // queued, not yet pushed

      await vi.advanceTimersByTimeAsync(1000) // the re-armed debounce timer fires

      expect(backend.writeCallCount).toBe(1)
      expect(backend.get('task.md')?.content).toBe('queued content')
      expect(cacheStore.get(vp('fake-vault', 'task.md'))?.status).toBe('clean')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── flushPendingPush ─────────────────────────────────────────────────────

describe('flushPendingPush', () => {
  it('pushes a pre-seeded dirty file immediately, bypassing the 1s debounce', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    seedDirty('fake-vault', 'task.md', 'rescued content', undefined)

    flushPendingPush()
    await flush()

    expect(backend.writeCallCount).toBe(1)
    expect(backend.get('task.md')?.content).toBe('rescued content')
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.status).toBe('clean')
  })

  it('is a no-op when nothing is dirty', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)

    flushPendingPush()
    await flush()

    expect(backend.writeCallCount).toBe(0)
    expect(backend.statAllCallCount).toBe(0) // pull:false — no reconcile triggered either
  })
})

// ── syncOnActivate ──────────────────────────────────────────────────────
//
// The first sync after a vault activates. Routed through runSync rather than
// calling reconcileWithBackend directly, which is what gives it pushDirty
// (subsuming the activation-site flushPendingPush), transient classification,
// and setLastSyncedAt. Activation fires it un-awaited on the painted path, so
// "never rejects" is a hard requirement, not a nicety.

describe('syncOnActivate', () => {
  it('pushes a previous session\'s dirty record and pulls remote changes in one cycle', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    // Stranded by a previous session — the old flushPendingPush()'s job.
    seedDirty('fake-vault', 'stranded.md', 'written while offline', undefined)
    // Landed on the backend since we last looked — the reconcile's job.
    backend.seed('remote.md', '# From another device', 'v-remote')

    await syncOnActivate(backend)

    expect(backend.writeCallCount).toBe(1)
    expect(backend.get('stranded.md')?.content).toBe('written while offline')
    expect(cacheStore.get(vp('fake-vault', 'remote.md'))?.content).toBe('# From another device')
  })

  it('sets lastSyncedAt, so the sync status does not read "Not synced yet" right after startup', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)

    await syncOnActivate(backend)

    expect(syncOf().lastSyncedAt).not.toBeNull()
  })

  it('resolves rather than rejecting when the backend is unreachable, and does not notify', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    backend.queueStatAllError(new TransientSyncError('offline'))

    // Activation fires this un-awaited; a rejection here would surface as an
    // unhandled rejection rather than a degraded-to-offline vault.
    await expect(syncOnActivate(backend)).resolves.toBeUndefined()

    expect(syncOf().offline).toBe(true)
    expect(notifyFns.notify).not.toHaveBeenCalled()
  })

  it('bypasses the backoff gate that would silence an autoSyncTick', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)
    // Arm the backoff with a failed sync.
    backend.queueStatAllError(new TransientSyncError('offline'))
    await syncToBackend()
    expect(backend.statAllCallCount).toBe(1)

    // A tick is gated by the backoff...
    autoSyncTick()
    await flush()
    expect(backend.statAllCallCount).toBe(1)

    // ...but a fresh activation is a deliberate moment and always attempts.
    await syncOnActivate(backend)
    expect(backend.statAllCallCount).toBe(2)
  })

  it('clears syncInProgress once the cycle settles', async () => {
    const backend = new FakeBackend()
    mountBackend(backend)

    await syncOnActivate(backend)

    expect(syncOf().inProgress).toBe(false)
  })
})

// Whether a key is a write or a delete is decided by `persistEntries` against
// the data being committed, not inferred here from an absence — see
// `src/storeCommit.test.ts`. This file's job stops at "the bytes it was handed
// become durable".

// ── In-flight write registry ──────────────────────────────────────────────
//
// setData updates the store synchronously, but the matching Dexie write
// lands later (a real IndexedDB round trip in production). A reconcile
// landing in that gap sees a clean status for a path that is, in fact, about
// to change — and could merge remote content over it, or worse, resurrect a
// note whose delete is still in flight (mergeChangedIntoStore would re-add
// it and nothing would ever evict it again). The in-flight registry closes
// that gap: marked synchronously, before writeEntityToCache/
// deleteFromBackend's first await, so it is never observably absent while a
// write is outstanding.

describe('in-flight write registry — protects against a concurrent reconcile', () => {
  const oneItem = () => [{ date: '', time: null, source: 'explicit' as const, entryKey: K('note'), id: 'i1', metadata: {} }]

  it('a reconcile landing mid-write does not pull remote content over the pending write', async () => {
    const backend = new FakeBackend()
    backend.seed('note.md', 'remote content', 'v2') // genuinely absent from (not yet reflected in) the cache
    mountBackend(backend)
    seedLayer('fake-vault', oneItem(), new Map([[K('note'), rootFor('note', { title: 'Note', tags: [], items: [] })]]))

    const originalRecordLocalEdit = vi.mocked(recordLocalEdit).getMockImplementation()!
    let releaseWrite!: () => void
    const gate = new Promise<void>(resolve => { releaseWrite = resolve })
    vi.mocked(recordLocalEdit).mockImplementationOnce(async (...args: Parameters<typeof recordLocalEdit>) => {
      await gate
      return originalRecordLocalEdit(...args)
    })

    // markInFlight('note.md') fires synchronously inside writeEntityToCache,
    // before its first await — so it is already in effect the instant this
    // call returns control here, well before recordLocalEdit's gated write settles.
    const writePromise = writeEntityToCache(K('note'), 'gated content')

    await reconcileWithBackend(backend, 'fake-vault')
    expect(backend.readFilesCallCount).toBe(0)
    expect(backend.readAllCallCount).toBe(0)

    releaseWrite()
    await writePromise

    // The write itself still lands once released.
    expect(cacheStore.get(vp('fake-vault', 'note.md'))?.status).toBe('dirty')
  })

  it('overlapping writes for the same slug both settle safely, with reconcile blocked throughout', async () => {
    // Not a Set-vs-Map discriminating test: once either write's recordLocalEdit
    // call actually lands, planReconcile's own status!=='clean' check already
    // protects the record independently of skipPaths, so this passes either
    // way. It still pins the sane outcome for the overlap the refcount
    // targets — no crash, reconcile still blocked mid-overlap, last write
    // wins — see the in-flight registry's doc comment for why the refcount is
    // kept anyway (the nested self-heal case, and not relying on that
    // coincidence).
    const backend = new FakeBackend()
    backend.seed('note.md', 'remote content', 'v2')
    mountBackend(backend)
    seedLayer('fake-vault', oneItem(), new Map([[K('note'), rootFor('note', { title: 'Note', tags: [], items: [] })]]))

    const originalRecordLocalEdit = vi.mocked(recordLocalEdit).getMockImplementation()!
    let releaseA!: () => void
    let releaseB!: () => void
    const gateA = new Promise<void>(resolve => { releaseA = resolve })
    const gateB = new Promise<void>(resolve => { releaseB = resolve })
    vi.mocked(recordLocalEdit)
      .mockImplementationOnce(async (...args: Parameters<typeof recordLocalEdit>) => { await gateA; return originalRecordLocalEdit(...args) })
      .mockImplementationOnce(async (...args: Parameters<typeof recordLocalEdit>) => { await gateB; return originalRecordLocalEdit(...args) })

    const writeA = writeEntityToCache(K('note'), 'content A')
    const writeB = writeEntityToCache(K('note'), 'content B')

    releaseA()
    await writeA // the first write settles; the second is still in flight

    await reconcileWithBackend(backend, 'fake-vault')
    expect(backend.readFilesCallCount).toBe(0) // still blocked

    releaseB()
    await writeB

    expect(cacheStore.get(vp('fake-vault', 'note.md'))?.status).toBe('dirty')
  })

  it('clears its mark when the write itself fails', async () => {
    // The path that does not reach `recordLocalEdit`'s success — the one where
    // a leaked mark is easiest to introduce, since nothing downstream runs.
    const backend = new FakeBackend()
    mountBackend(backend)
    seedLayer('fake-vault', oneItem(), new Map([[K('note'), rootFor('note', { title: 'Note', tags: [], items: [] })]]))
    vi.mocked(recordLocalEdit).mockRejectedValueOnce(new Error('quota exceeded'))

    await writeEntityToCache(K('note'), 'content')

    expect(notifyFns.notifyError).toHaveBeenCalled()
    // A leaked mark here would keep 'note.md' in skipPaths forever, hiding a
    // genuine remote delete from ever being reconciled.
    seedClean('fake-vault', 'note.md', 'old content', 'v1', 0) // long-past updatedAt — outside PR1's grace window
    await syncToBackend()

    expect(cacheStore.has(vp('fake-vault', 'note.md'))).toBe(false)
  })
})

// ── parseFiles / reportParseFailures ────────────────────────────────────

describe('parseFiles', () => {
  it('loads every well-formed file and collects a named failure per malformed one, without blocking the rest', () => {
    const files = [
      { path: 'good.md', content: '---\ntitle: Good\ndate: "2026-04-08"\n---\n\nfine' },
      { path: 'bad.md', content: '---\ntitle: Bad: with a colon\ndate: "2026-04-08"\n---\n\noops' },
      { path: 'tabs.md', content: '---\ntitle: Tabs\ndefaults:\n\tdone: false\n---' },
      { path: 'dup.md', content: '---\ntitle: A\ntitle: B\n---' },
      { path: 'also-good.md', content: '---\ntitle: Also good\n---' },
    ]

    const { roots, failures } = parseFiles(files, VAULT)

    expect([...roots.keys()].sort()).toEqual([K('also-good'), K('good')].sort())
    expect(failures.map(f => f.key).sort()).toEqual([K('bad'), K('dup'), K('tabs')].sort())
    // Every failure carries enough to act on, and to reserve its slug.
    for (const f of failures) {
      expect(f.path).toMatch(/\.md$/)
      expect(f.message.length).toBeGreaterThan(0)
    }
  })
})

// ── the deferred round-trip guard ───────────────────────────────────────
//
// The guard used to run inside the parseFiles loop, where it measured 75% of
// the total parse cost on a 300-file vault — all of it between the Dexie read
// and the agenda's first paint. It now runs in idle batches afterwards. What
// must not change is its coverage: every file that parsed still gets checked,
// and a real loss still reaches the user.

describe('parseFiles — round-trip guard scheduling', () => {
  const files = [
    { path: 'good.md', content: '---\ntitle: Good\n---' },
    { path: 'also-good.md', content: '---\ntitle: Also good\n---' },
    { path: 'broken.md', content: '---\ntitle: Bad: with a colon\n---' },
  ]

  it('does not run the guard during the parse itself', () => {
    const { items } = parseFiles(files, VAULT)

    expect(items).toBeDefined()
    expect(roundTripLossMock).not.toHaveBeenCalled()
  })

  it('checks every file that parsed — and only those — once the audit runs', async () => {
    const { auditRoundTrip } = parseFiles(files, VAULT)
    auditRoundTrip()

    await vi.waitFor(() => { expect(roundTripLossMock).toHaveBeenCalledTimes(2) })
    // broken.md never parsed, so there is nothing to round-trip it against.
    expect(roundTripLossMock.mock.calls.map(c => c[0])).toEqual(['good.md', 'also-good.md'])
  })

  it('still surfaces a genuine loss to the user, just later', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    roundTripLossMock.mockReturnValue(['project="apollo"'])

    const { auditRoundTrip } = parseFiles([{ path: 'deferred-loss.md', content: '---\ntitle: X\n---' }], VAULT)
    expect(notifyFns.warn).not.toHaveBeenCalled()
    auditRoundTrip()

    await vi.waitFor(() => {
      expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('deferred-loss.md'))
    })
    expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('project="apollo"'))
    warnSpy.mockRestore()
  })
})

describe('reportParseFailures', () => {
  it('warns with the message for a single failure', () => {
    reportParseFailures([{ path: 'bad.md', key: K('bad'), message: 'bad indentation' }])
    expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('bad.md'))
    expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('bad indentation'))
  })

  it('lists every path when several files fail', () => {
    reportParseFailures([
      { path: 'bad.md', key: K('bad'), message: 'x' },
      { path: 'tabs.md', key: K('tabs'), message: 'y' },
    ])
    expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('bad.md'))
    expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('tabs.md'))
  })

  it('stays silent when there is nothing to report', () => {
    reportParseFailures([])
    expect(notifyFns.warn).not.toHaveBeenCalled()
  })
})

// ── Several vaults, registered and synced side by side ────────────────────
//
// The scheduler is serial and oldest-attempted-first, and every piece of
// per-vault state (backoff, dirty count, debounce) is keyed by vault id. What
// these pin is that one vault can never speak for another: not for its retry
// timing, not for its error, and not for its content.

describe('multi-vault sync', () => {
  /** A second FakeBackend under a different vault id. */
  function otherBackend(id: string, kind: VaultKind = 'local'): FakeBackend {
    const backend = new FakeBackend()
    Object.defineProperty(backend, 'id',   { value: id })
    Object.defineProperty(backend, 'name', { value: id })
    Object.defineProperty(backend, 'kind', { value: kind })
    return backend
  }

  it('keeps dirty counts and errors independent per vault', async () => {
    const a = new FakeBackend()          // 'fake-vault'
    const b = otherBackend('vault-b')
    mountBackend(a)
    mountBackend(b)

    seedDirty('vault-b', 'only-b.md', 'b content', undefined)
    a.queueStatAllError(new AuthSyncError('token revoked'))

    await syncToBackend('fake-vault')
    await syncToBackend('vault-b')

    expect(syncOf('fake-vault').error).toBe('token revoked')
    expect(syncOf('fake-vault').needsAttention).toEqual({ kind: 'reauth', message: 'token revoked' })
    expect(syncOf('vault-b').error).toBeNull()
    expect(syncOf('vault-b').needsAttention).toBeNull()
    expect(b.get('only-b.md')?.content).toBe('b content')
    // A's failure did not touch B's row, and vice versa.
    expect(syncOf('vault-b').offline).toBe(false)
  })

  it('does not let one vault\'s backoff gate another vault\'s tick', async () => {
    const a = new FakeBackend()
    const b = otherBackend('vault-b')
    mountBackend(a)
    mountBackend(b)

    let now = 2_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      a.queueStatAllError(new TransientSyncError('offline'))
      await syncToBackend('fake-vault')  // A is now in a 60s backoff
      expect(a.statAllCallCount).toBe(1)
      expect(b.statAllCallCount).toBe(0)

      now += 31_000                      // past local's 30s minimum, inside A's backoff
      autoSyncTick()
      await flush()

      expect(a.statAllCallCount).toBe(1) // still gated
      expect(b.statAllCallCount).toBe(1) // unaffected
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('honours each vault kind\'s own minimum interval', async () => {
    const local  = new FakeBackend()                    // local: 30s
    const github = otherBackend('vault-gh', 'github')   // github: 60s
    mountBackend(local)
    mountBackend(github)

    let now = 3_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      autoSyncTick()
      await flush()
      expect(local.statAllCallCount).toBe(1)
      expect(github.statAllCallCount).toBe(1)

      // 35s on: past local's minimum, short of github's.
      now += 35_000
      autoSyncTick()
      await flush()
      expect(local.statAllCallCount).toBe(2)
      expect(github.statAllCallCount).toBe(1)

      now += 30_000
      autoSyncTick()
      await flush()
      expect(github.statAllCallCount).toBe(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('syncs oldest-attempted first, and never two cycles at once', async () => {
    const a = new FakeBackend()
    const b = otherBackend('vault-b')
    mountBackend(a)
    mountBackend(b)

    // A synced recently; B has never been attempted, so B must lead.
    const order: string[] = []
    const originalStatAllA = a.statAll.bind(a)
    const originalStatAllB = b.statAll.bind(b)
    vi.spyOn(a, 'statAll').mockImplementation(async () => { order.push('a'); return originalStatAllA() })
    vi.spyOn(b, 'statAll').mockImplementation(async () => { order.push('b'); return originalStatAllB() })

    await syncToBackend('fake-vault')
    order.length = 0

    let now = Date.now() + 10 * 60_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      autoSyncTick()
      await flush()
      // B has never been attempted, so it leads despite being registered second.
      expect(order).toEqual(['b', 'a'])

      // A tick that lands while a pass is still walking is dropped, not
      // interleaved — otherwise two cycles could run against one vault. Two
      // calls back to back therefore produce one pass, not two.
      now += 10 * 60_000
      order.length = 0
      autoSyncTick()
      autoSyncTick()
      await flush()
      // Both were attempted at the same mocked instant by the previous pass, so
      // the tie falls back to registration order.
      expect(order).toEqual(['a', 'b'])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('flushPendingPush rescues dirty writes in every vault, not just one', async () => {
    const a = new FakeBackend()
    const b = otherBackend('vault-b')
    mountBackend(a)
    mountBackend(b)

    seedDirty('fake-vault', 'a.md', 'a content', undefined)
    seedDirty('vault-b',    'b.md', 'b content', undefined)

    flushPendingPush()
    await flush()

    expect(a.get('a.md')?.content).toBe('a content')
    expect(b.get('b.md')?.content).toBe('b content')
  })

  it('writeEntityToCache refuses an unregistered vault', async () => {
    const a = new FakeBackend()
    mountBackend(a)
    seedLayer('ghost-vault', [{ entryKey: 'ghost-vault::note' }],
      new Map([['ghost-vault::note', rootFor('note', { title: 'Note', tags: [], items: [] })]]))

    await writeEntityToCache('ghost-vault::note' as EntryKey, 'content')

    expect(cacheStore.get(vp('ghost-vault', 'note.md'))).toBeUndefined()
  })

  it('writeEntityToCache refuses a read-only vault', async () => {
    const ro = otherBackend('vault-ro')
    Object.defineProperty(ro, 'readOnly', { value: true })
    mountBackend(ro)
    seedLayer('vault-ro', [{ entryKey: 'vault-ro::note' }],
      new Map([['vault-ro::note', rootFor('note', { title: 'Note', tags: [], items: [] })]]))

    await writeEntityToCache('vault-ro::note' as EntryKey, 'content')

    expect(cacheStore.get(vp('vault-ro', 'note.md'))).toBeUndefined()
  })

  // ── read-only vs. no-remote ───────────────────────────────────────────────
  // Two independent properties, and the iCal vault kind is why they had to be
  // separated: a subscription is read-only but IS polled, while the Tutorial
  // vault is read-only and is not polled at all.

  /** A read-only vault with a live remote — a calendar subscription. */
  function subscriptionBackend(id: string): FakeBackend {
    const backend = otherBackend(id, 'ical')
    Object.defineProperty(backend, 'readOnly', { value: true })
    return backend
  }

  it('auto-syncs a read-only vault that has a remote', async () => {
    const feed = subscriptionBackend('vault-ical')
    feed.seed('ical-abc.md', '---\ntitle: Event\n---\n', 'v1')
    mountBackend(feed)

    autoSyncTick()
    await flush()

    expect(feed.statAllCallCount).toBe(1)
    // The pull landed: the feed's entry is in the cache and in the store layer.
    expect(cacheStore.get(vp('vault-ical', 'ical-abc.md'))?.content).toContain('title: Event')
    expect(storeState.layers.get('vault-ical')?.items.length).toBeGreaterThan(0)
  })

  it('never pushes from a read-only vault, even when its cache holds dirty rows', async () => {
    const feed = subscriptionBackend('vault-ical')
    mountBackend(feed)
    seedDirty('vault-ical', 'ical-abc.md', 'local edit', undefined)

    autoSyncTick()
    await flush()

    expect(feed.writeCallCount).toBe(0)
    expect(feed.deleteCallCount).toBe(0)
  })

  it('never auto-syncs a vault with no remote', async () => {
    const sandbox = otherBackend('vault-sandbox', 'example')
    Object.defineProperty(sandbox, 'readOnly',  { value: true })
    Object.defineProperty(sandbox, 'hasRemote', { value: false })
    mountBackend(sandbox)

    autoSyncTick()
    await flush()

    expect(sandbox.statAllCallCount).toBe(0)
  })

  it('refreshes a subscription on an explicit "Sync now"', async () => {
    const feed = subscriptionBackend('vault-ical')
    feed.seed('ical-abc.md', '---\ntitle: Event\n---\n', 'v1')
    mountBackend(feed)

    await syncToBackend()

    expect(feed.statAllCallCount).toBe(1)
  })
})
