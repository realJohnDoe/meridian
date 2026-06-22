/**
 * Integration-style tests for the pushDirty CAS flow.
 *
 * These tests use a FakeBackend — a simple in-memory StorageBackend with a
 * controllable "stale token" capability — to exercise the collision detection
 * logic without Dexie or module-level state.
 */
import { describe, it, expect } from 'vitest'
import type { StorageBackend, FileEntry, VaultKind } from '@/storage/backend'
import { ConflictError } from '@/storage/conflictError'

// ── FakeBackend ────────────────────────────────────────────────

type FakeFile = { content: string; version: string }

class FakeBackend implements StorageBackend {
  readonly id       = 'fake'
  readonly name     = 'Fake'
  readonly kind: VaultKind = 'local'
  readonly readOnly = false

  private _files = new Map<string, FakeFile>()
  private _staleTokens = new Map<string, string>()

  seed(path: string, content: string, version: string): void {
    this._files.set(path, { content, version })
  }

  /** Force statAll to report an old token for this path (simulates GitHub stale listing). */
  makeStale(path: string, staleVersion: string): void {
    this._staleTokens.set(path, staleVersion)
  }

  async statAll(): Promise<Map<string, string>> {
    const m = new Map<string, string>()
    for (const [p, f] of this._files) {
      m.set(p, this._staleTokens.get(p) ?? f.version)
    }
    return m
  }

  async readFiles(paths: string[]): Promise<FileEntry[]> {
    return paths.flatMap(p => {
      const f = this._files.get(p)
      return f ? [{ path: p, content: f.content, version: f.version }] : []
    })
  }

  async readAll(): Promise<FileEntry[]> {
    return Array.from(this._files.entries()).map(([p, f]) => ({ path: p, content: f.content, version: f.version }))
  }

  async write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> {
    const existing = this._files.get(path)
    if (expectedVersion !== undefined) {
      // CAS: precondition must match current version.
      if (existing === undefined || existing.version !== expectedVersion) {
        throw new ConflictError(path)
      }
    } else {
      // No precondition means "create new". If it already exists → conflict
      // (mirrors GitHub returning 422 when PUT without sha hits an existing file).
      if (existing !== undefined) {
        throw new ConflictError(path)
      }
    }
    const newVersion = `v${Date.now()}-${Math.random()}`
    this._files.set(path, { content, version: newVersion })
    this._staleTokens.delete(path)
    return newVersion
  }

  async delete(path: string): Promise<void> {
    this._files.delete(path)
  }

  async ensurePermission(): Promise<PermissionState> { return 'granted' }
}

// ── Lightweight CAS harness (mirrors pushDirty logic) ─────────

type DirtyRecord = { path: string; content: string; version: string | undefined }

type PushResult =
  | { type: 'ok'; newVersion: string | undefined }
  | { type: 'conflict' }

async function pushOne(backend: StorageBackend, record: DirtyRecord): Promise<PushResult> {
  try {
    const v = await backend.write(record.path, record.content, record.version)
    return { type: 'ok', newVersion: v }
  } catch (e) {
    if (e instanceof ConflictError) return { type: 'conflict' }
    throw e
  }
}

// ── Tests ──────────────────────────────────────────────────────

describe('CAS write — no false conflicts', () => {
  it('push succeeds when base version matches', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'done: false', 'sha1')

    const result = await pushOne(backend, { path: 'task.md', content: 'done: true', version: 'sha1' })

    expect(result.type).toBe('ok')
    expect((result as { type: 'ok'; newVersion: string | undefined }).newVersion).toBeDefined()
  })

  it('toggle→untoggle: two consecutive pushes with updated base version — no conflict', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'done: false', 'sha1')

    // First toggle (false → true)
    const r1 = await pushOne(backend, { path: 'task.md', content: 'done: true', version: 'sha1' })
    expect(r1.type).toBe('ok')
    const v2 = (r1 as { type: 'ok'; newVersion: string | undefined }).newVersion!

    // Simulate a stale listing token still reporting 'sha1' — but CAS is not affected
    backend.makeStale('task.md', 'sha1')

    // Second toggle (true → false) using the updated base version from the first push
    const r2 = await pushOne(backend, { path: 'task.md', content: 'done: false', version: v2 })
    expect(r2.type).toBe('ok')
  })

  it('stale listing token alone does NOT trigger a conflict', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'done: false', 'sha1')

    // Push once to get the real new version
    const r1 = await pushOne(backend, { path: 'task.md', content: 'done: true', version: 'sha1' })
    const v2 = (r1 as { type: 'ok'; newVersion: string | undefined }).newVersion!

    // statAll now returns a stale 'sha1' — irrelevant because pushDirty uses CAS
    backend.makeStale('task.md', 'sha1')
    const listing = await backend.statAll()
    expect(listing.get('task.md')).toBe('sha1')  // confirms the stale token is present

    // But a push with the correct base version still succeeds
    const r2 = await pushOne(backend, { path: 'task.md', content: 'done: false', version: v2 })
    expect(r2.type).toBe('ok')
  })
})

describe('CAS write — genuine conflict detection', () => {
  it('reports ConflictError when backend version genuinely diverged', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'original content', 'sha1')

    // External write advances the backend version
    await backend.write('task.md', 'external edit', 'sha1')

    // Local edit derived from the old base 'sha1' should now conflict
    const result = await pushOne(backend, { path: 'task.md', content: 'local edit', version: 'sha1' })
    expect(result.type).toBe('conflict')
  })

  it('reports ConflictError for a new file whose path already exists on the backend', async () => {
    const backend = new FakeBackend()
    // Backend already has the file; local record has no base version (undefined = create)
    backend.seed('task.md', 'remote content', 'sha1')

    const result = await pushOne(backend, { path: 'task.md', content: 'local content', version: undefined })
    expect(result.type).toBe('conflict')
  })
})
