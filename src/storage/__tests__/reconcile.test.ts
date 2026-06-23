/**
 * Unit tests for planReconcile — the pure decision logic that decides which
 * paths to pull from the backend and which to drop from the cache.
 *
 * No Dexie, no backend, no store: planReconcile is side-effect-free, so these
 * tests pin the branching directly (mirrors how sync-collision.test.ts isolates
 * the CAS logic from module-level state).
 */
import { describe, it, expect } from 'vitest'
import { planReconcile } from '@/storage/sync'
import type { CacheRecord } from '@/storage/cache'

// ── Helpers ────────────────────────────────────────────────────

function rec(path: string, version: string | undefined, dirty: number): CacheRecord {
  return { vaultPath: `v::${path}`, vaultId: 'v', path, content: '', dirty, updatedAt: 0, version }
}

// ── Tests ──────────────────────────────────────────────────────

describe('planReconcile — pulling backend files', () => {
  it('pulls a file present on the backend but absent from the cache (regression)', () => {
    // The bug: when `entry` was undefined, the old guard `entry?.dirty === 0`
    // evaluated to false, so brand-new remote files were never pulled and stayed
    // invisible in the app — even across restarts.
    const diskTokens = new Map([['remote-only.md', 'sha1']])
    const { changed, deleted } = planReconcile(diskTokens, [])

    expect(changed).toEqual(['remote-only.md'])
    expect(deleted).toEqual([])
  })

  it('pulls a clean cached file whose backend version drifted', () => {
    const diskTokens = new Map([['task.md', 'sha2']])
    const cache = [rec('task.md', 'sha1', 0)]

    const { changed } = planReconcile(diskTokens, cache)
    expect(changed).toEqual(['task.md'])
  })

  it('leaves an unchanged clean file alone', () => {
    const diskTokens = new Map([['task.md', 'sha1']])
    const cache = [rec('task.md', 'sha1', 0)]

    const { changed, deleted } = planReconcile(diskTokens, cache)
    expect(changed).toEqual([])
    expect(deleted).toEqual([])
  })
})

describe('planReconcile — protecting pending local changes', () => {
  it('does not clobber a dirty file even when the backend version differs', () => {
    const diskTokens = new Map([['task.md', 'sha2']])
    const cache = [rec('task.md', 'sha1', 1)] // dirty = pending push

    const { changed } = planReconcile(diskTokens, cache)
    expect(changed).toEqual([])
  })

  it('does not pull a tombstoned file the backend still lists', () => {
    const diskTokens = new Map([['task.md', 'sha2']])
    const cache = [rec('task.md', 'sha1', 2)] // tombstone = pending delete

    const { changed } = planReconcile(diskTokens, cache)
    expect(changed).toEqual([])
  })
})

describe('planReconcile — skipping paths pushed this cycle', () => {
  // GitHub's listing API is eventually consistent: right after we push, statAll
  // may still report the pre-push SHA or omit a just-created file. Paths we wrote
  // this cycle must be skipped so the stale listing can't clobber our fresh write.

  it('does not re-pull a just-pushed file whose listing still shows the old SHA', () => {
    // Cache holds the authoritative post-push SHA; the listing lags at the old one.
    const diskTokens = new Map([['task.md', 'oldsha']])
    const cache = [rec('task.md', 'newsha', 0)]

    const { changed } = planReconcile(diskTokens, cache, new Set(['task.md']))
    expect(changed).toEqual([])
  })

  it('does not drop a just-created file the listing has not caught up to yet', () => {
    // We pushed new.md (now clean in cache) but statAll does not list it yet.
    const diskTokens = new Map<string, string>()
    const cache = [rec('new.md', 'sha', 0)]

    const { deleted } = planReconcile(diskTokens, cache, new Set(['new.md']))
    expect(deleted).toEqual([])
  })

  it('does not resurrect a just-deleted file the listing still reports', () => {
    // Tombstone was applied (cache entry already gone) but statAll still lists it.
    const diskTokens = new Map([['gone.md', 'sha']])
    const { changed } = planReconcile(diskTokens, [], new Set(['gone.md']))
    expect(changed).toEqual([])
  })

  it('still reconciles other paths in the same cycle', () => {
    const diskTokens = new Map([['task.md', 'oldsha'], ['other.md', 'sha2']])
    const cache = [rec('task.md', 'newsha', 0)]

    const { changed } = planReconcile(diskTokens, cache, new Set(['task.md']))
    expect(changed).toEqual(['other.md'])
  })
})

describe('planReconcile — dropping vanished files', () => {
  it('drops a clean cached file that no longer exists on the backend', () => {
    const diskTokens = new Map<string, string>()
    const cache = [rec('gone.md', 'sha1', 0)]

    const { changed, deleted } = planReconcile(diskTokens, cache)
    expect(changed).toEqual([])
    expect(deleted).toEqual(['gone.md'])
  })

  it('keeps a dirty file that is missing from the backend (unpushed local create)', () => {
    const diskTokens = new Map<string, string>()
    const cache = [rec('new-local.md', undefined, 1)]

    const { deleted } = planReconcile(diskTokens, cache)
    expect(deleted).toEqual([])
  })

  it('keeps a tombstone that is missing from the backend (delete already applied)', () => {
    const diskTokens = new Map<string, string>()
    const cache = [rec('removed.md', 'sha1', 2)]

    const { deleted } = planReconcile(diskTokens, cache)
    expect(deleted).toEqual([])
  })
})
