/**
 * Unit tests for the effectful sync core in sync.ts: pushDirty's collision and
 * tombstone-conflict handling, runSync's auth-retry-after-401 logic, and the
 * exponential backoff that gates autoSyncTick.
 *
 * sync.ts is exercised only through its public surface (syncToBackend,
 * autoSyncTick, resetSyncBackoff) — pushDirty/resolveCollision/runSync are
 * module-private. `@/storage/cache`, `@/storeBridge`, and
 * `@/storage/notifications` are replaced with in-memory fakes so the test
 * doesn't need Dexie/IndexedDB or a DOM-backed zustand store/sonner toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StorageBackend, RawFile } from '@/storage/backend'
import type { VaultKind } from '@/types'
import { ConflictError, AuthSyncError, TransientSyncError } from '@/storage/conflictError'

// ── Hoisted shared fakes (referenced by the vi.mock factories below, which
// run before the rest of this file's top-level code) ──────────────────────

const { cacheStore, storeState, notifyFns } = vi.hoisted(() => ({
  cacheStore: new Map<string, {
    vaultPath: string; vaultId: string; path: string; content: string
    dirty: number; updatedAt: number; version?: string
  }>(),
  storeState: {
    items: [] as unknown[],
    roots: new Map<string, unknown>(),
    syncDirtyCount: 0,
    syncError: null as string | null,
    syncOffline: false,
    lastSyncedAt: null as number | null,
  },
  notifyFns: { notify: vi.fn(), warn: vi.fn(), notifyError: vi.fn() },
}))

function vp(vaultId: string, path: string): string {
  return `${vaultId}::${path}`
}

vi.mock('@/storage/cache', () => ({
  cacheWrite: vi.fn(async (vaultId: string, path: string, content: string) => {
    const key = vp(vaultId, path)
    const existing = cacheStore.get(key)
    if (existing && existing.content === content) return
    cacheStore.set(key, { vaultPath: key, vaultId, path, content, dirty: 1, updatedAt: Date.now(), version: existing?.version })
  }),
  cacheWriteClean: vi.fn(async (vaultId: string, path: string, content: string, version?: string) => {
    const key = vp(vaultId, path)
    cacheStore.set(key, { vaultPath: key, vaultId, path, content, dirty: 0, updatedAt: Date.now(), version })
  }),
  cacheBulkWriteClean: vi.fn(async (vaultId: string, records: Array<{ path: string; content: string; version?: string }>) => {
    for (const r of records) {
      const key = vp(vaultId, r.path)
      cacheStore.set(key, { vaultPath: key, vaultId, path: r.path, content: r.content, dirty: 0, updatedAt: Date.now(), version: r.version })
    }
  }),
  cacheLoadAll: vi.fn(async (vaultId: string) => {
    return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId)
  }),
  cacheDelete: vi.fn(async (vaultId: string, path: string) => {
    cacheStore.delete(vp(vaultId, path))
  }),
  cacheGetDirty: vi.fn(async (vaultId: string) => {
    return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId && r.dirty === 1)
  }),
  cacheWriteTombstone: vi.fn(async (vaultId: string, path: string) => {
    const key = vp(vaultId, path)
    const existing = cacheStore.get(key)
    cacheStore.set(key, { vaultPath: key, vaultId, path, content: '', dirty: 2, updatedAt: Date.now(), version: existing?.version })
  }),
  cacheGetTombstones: vi.fn(async (vaultId: string) => {
    return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId && r.dirty === 2)
  }),
  cacheDirtyCount: vi.fn(async (vaultId: string) => {
    return Array.from(cacheStore.values()).filter(r => r.vaultId === vaultId && (r.dirty === 1 || r.dirty === 2)).length
  }),
}))

vi.mock('@/storeBridge', () => ({
  getItems: vi.fn(() => storeState.items),
  getRoots: vi.fn(() => storeState.roots),
  setData: vi.fn((d: { items: unknown[]; roots: Map<string, unknown> }) => {
    storeState.items = d.items
    storeState.roots = d.roots
  }),
  setSyncDirtyCount: vi.fn((n: number) => { storeState.syncDirtyCount = n }),
  setSyncError: vi.fn((e: string | null) => { storeState.syncError = e }),
  setSyncOffline: vi.fn((o: boolean) => { storeState.syncOffline = o }),
  setLastSyncedAt: vi.fn((ts: number | null) => { storeState.lastSyncedAt = ts }),
}))

vi.mock('@/storage/notifications', () => notifyFns)

// Imports of the module under test (and its non-mocked collaborators) must
// come after the vi.mock calls above.
import { syncToBackend, autoSyncTick, resetSyncBackoff } from '@/storage/sync'
import { setActiveBackend } from '@/storage/activeBackend'

// ── FakeBackend ──────────────────────────────────────────────────────────

type FakeFile = { content: string; version: string }

class FakeBackend implements StorageBackend {
  readonly id       = 'fake-vault'
  readonly name     = 'Fake'
  readonly kind: VaultKind = 'local'
  readonly readOnly = false
  refreshAuth?: () => Promise<boolean>

  writeCallCount   = 0
  deleteCallCount  = 0
  statAllCallCount = 0

  private _files = new Map<string, FakeFile>()
  private _versionCounter = 0
  private _writeErrorQueue:   Error[] = []
  private _deleteErrorQueue:  Error[] = []
  private _statAllErrorQueue: Error[] = []

  seed(path: string, content: string, version: string): void {
    this._files.set(path, { content, version })
  }

  get(path: string): FakeFile | undefined { return this._files.get(path) }
  listPaths(): string[] { return Array.from(this._files.keys()) }

  queueWriteError(e: Error): void { this._writeErrorQueue.push(e) }
  queueDeleteError(e: Error): void { this._deleteErrorQueue.push(e) }
  queueStatAllError(e: Error): void { this._statAllErrorQueue.push(e) }

  async statAll(): Promise<Map<string, string>> {
    this.statAllCallCount++
    if (this._statAllErrorQueue.length) throw this._statAllErrorQueue.shift()!
    const m = new Map<string, string>()
    for (const [p, f] of this._files) m.set(p, f.version)
    return m
  }

  async readFiles(paths: string[]): Promise<RawFile[]> {
    return paths.flatMap(p => {
      const f = this._files.get(p)
      return f ? [{ path: p, content: f.content, version: f.version }] : []
    })
  }

  async readAll(): Promise<RawFile[]> {
    return Array.from(this._files.entries()).map(([p, f]) => ({ path: p, content: f.content, version: f.version }))
  }

  async write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> {
    this.writeCallCount++
    if (this._writeErrorQueue.length) throw this._writeErrorQueue.shift()!
    const existing = this._files.get(path)
    if (expectedVersion !== undefined) {
      if (existing === undefined || existing.version !== expectedVersion) throw new ConflictError(path)
    } else if (existing !== undefined) {
      throw new ConflictError(path)
    }
    const newVersion = `v${++this._versionCounter}`
    this._files.set(path, { content, version: newVersion })
    return newVersion
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
  cacheStore.set(vp(vaultId, path), { vaultPath: vp(vaultId, path), vaultId, path, content, dirty: 1, updatedAt: Date.now(), version })
}

function seedTombstone(vaultId: string, path: string, version: string | undefined): void {
  cacheStore.set(vp(vaultId, path), { vaultPath: vp(vaultId, path), vaultId, path, content: '', dirty: 2, updatedAt: Date.now(), version })
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
  storeState.syncDirtyCount = 0
  storeState.syncError = null
  storeState.syncOffline = false
  storeState.lastSyncedAt = null
  notifyFns.notify.mockClear()
  notifyFns.warn.mockClear()
  notifyFns.notifyError.mockClear()
  setActiveBackend(null)
  resetSyncBackoff()
})

// ── Write-conflict collision copy-out ───────────────────────────────────

describe('pushDirty — write-conflict collision', () => {
  it('pulls the fresh remote copy, writes local content to a timestamped conflict copy, and warns', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    setActiveBackend(backend)

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
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.dirty).toBe(0)
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.content).toBe('remote v2')
    expect(cacheStore.get(vp('fake-vault', copyPath!))?.dirty).toBe(0)

    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
    expect(notifyFns.warn.mock.calls[0][0]).toContain('task.md')

    // The collision doesn't surface as a sync failure — it's a handled outcome.
    expect(storeState.syncError).toBeNull()
  })
})

// ── Delete-conflict (tombstone) handling ────────────────────────────────

describe('pushDirty — delete-conflict tombstone handling', () => {
  it('drops the tombstone and keeps the remote edit instead of destroying it', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'original', 'sha1')
    setActiveBackend(backend)

    // A remote edit lands after the local delete was staged — the tombstone
    // still holds the stale base version 'sha1'.
    await backend.write('task.md', 'remote edit after delete staged', 'sha1')
    seedTombstone('fake-vault', 'task.md', 'sha1')

    await syncToBackend()

    // The remote file must survive, not be deleted.
    expect(backend.get('task.md')?.content).toBe('remote edit after delete staged')
    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
    expect(notifyFns.warn.mock.calls[0][0]).toContain('task.md')

    // hadCollision triggers a same-cycle reconcile that pulls the surviving
    // remote edit back into the cache as a clean record.
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    expect(cached?.dirty).toBe(0)
    expect(cached?.content).toBe('remote edit after delete staged')

    expect(storeState.syncError).toBeNull()
  })

  it('is idempotent when the remote file is already gone', async () => {
    const backend = new FakeBackend()
    setActiveBackend(backend)
    seedTombstone('fake-vault', 'gone.md', 'sha1')

    await syncToBackend()

    expect(backend.listPaths()).not.toContain('gone.md')
    expect(cacheStore.has(vp('fake-vault', 'gone.md'))).toBe(false)
    expect(notifyFns.warn).not.toHaveBeenCalled()
    expect(storeState.syncError).toBeNull()
  })
})

// ── Auth-retry-after-401 ─────────────────────────────────────────────────

describe('runSync — auth retry after 401', () => {
  it('retries once via backend.refreshAuth() and succeeds on the retry', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    setActiveBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    const refreshAuth = vi.fn().mockResolvedValue(true)
    backend.refreshAuth = refreshAuth
    backend.queueWriteError(new AuthSyncError('401 unauthorized'))

    await syncToBackend()

    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(backend.writeCallCount).toBe(2) // failed attempt + retry
    expect(backend.get('task.md')?.content).toBe('local edit')
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.dirty).toBe(0)
    expect(storeState.syncError).toBeNull()
    expect(storeState.lastSyncedAt).not.toBeNull()
  })

  it('surfaces an actionable error when refreshAuth fails to recover', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    setActiveBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    backend.refreshAuth = vi.fn().mockResolvedValue(false)
    backend.queueWriteError(new AuthSyncError('401 unauthorized'))

    await syncToBackend()

    expect(backend.refreshAuth).toHaveBeenCalledTimes(1)
    expect(backend.writeCallCount).toBe(1) // no retry attempted
    expect(storeState.syncError).toBe('401 unauthorized')
    expect(notifyFns.notifyError).toHaveBeenCalledTimes(1)
    // The dirty edit is preserved locally rather than lost.
    expect(cacheStore.get(vp('fake-vault', 'task.md'))?.dirty).toBe(1)
  })

  it('does not attempt a retry when the backend has no refreshAuth recovery path', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote', 'sha1')
    setActiveBackend(backend)
    seedDirty('fake-vault', 'task.md', 'local edit', 'sha1')

    backend.queueWriteError(new AuthSyncError('token revoked'))

    await syncToBackend()

    expect(backend.writeCallCount).toBe(1)
    expect(storeState.syncError).toBe('token revoked')
  })
})

// ── Backoff transitions ───────────────────────────────────────────────────

describe('runSync — exponential backoff on transient failures', () => {
  it('backs off after consecutive transient failures and gates autoSyncTick until it elapses, while manual sync always bypasses the gate', async () => {
    const backend = new FakeBackend()
    setActiveBackend(backend)

    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    try {
      backend.queueStatAllError(new TransientSyncError('offline'))
      await syncToBackend() // failure #1 → backoff = 60_000ms
      expect(storeState.syncOffline).toBe(true)
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
      expect(storeState.syncOffline).toBe(true)

      // Manual sync bypasses the backoff gate immediately, even mid-window.
      now += 500
      await syncToBackend() // succeeds — no error queued this time
      expect(backend.statAllCallCount).toBe(3)
      expect(storeState.syncOffline).toBe(false)

      // A successful sync resets the backoff: an immediate autoSyncTick can
      // fire right away rather than staying gated.
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
    setActiveBackend(backend)

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
      expect(storeState.syncOffline).toBe(true)

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
