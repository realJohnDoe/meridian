/**
 * The retention sweep — plans/archived-entries.md 4d. `@/storeBridge`,
 * `@/storeCommit`, `./cache/files` and `sonner` are replaced with in-memory
 * fakes so this exercises `sweepRetention`'s own decisions (which vaults run,
 * which entries qualify) without a real store, Dexie, or toast. `@/model`
 * stays real: `setArchived`/`isEntryFinished` are pure and exactly what's
 * under test alongside the sweep's own age/vault gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { entryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { Entry, Entries, StoreOcc } from '@/types'
import type { VaultRef } from '@/vaultRef'

const { vaults, layers, cacheRecords, commitNextMock, toastMock } = vi.hoisted(() => ({
  vaults: [] as VaultRef[],
  layers: new Map<string, Entries>(),
  cacheRecords: new Map<string, Array<{ path: string; lastModified?: number }>>(),
  commitNextMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/storeBridge', () => ({
  getVaults: () => vaults,
  getVaultLayer: (vaultId: string) => layers.get(vaultId) ?? new Map(),
  getSnapshot: () => ({ entries: new Map([...layers.values()].flatMap(l => [...l])) }),
}))

vi.mock('@/storeCommit', () => ({
  commitNext: commitNextMock,
}))

vi.mock('../cache/files', () => ({
  cacheLoadAll: (vaultId: string) => Promise.resolve(cacheRecords.get(vaultId) ?? []),
}))

vi.mock('sonner', () => ({
  toast: toastMock,
}))

const { sweepRetention } = await import('../retentionSweep')

const VAULT = 'vault-1'
const K = (slug: string): EntryKey => entryKey(VAULT, slug)

const DAY_MS = 24 * 60 * 60 * 1000

/** A finished, tracked-and-done entry — a candidate for every test below
 *  except the ones deliberately checking it stays open. */
function finishedEntry(slug: string): Entry {
  const key = K(slug)
  const item: StoreOcc = {
    date: '', time: null, source: 'explicit', entryKey: key, id: `${slug}-1`,
    metadata: { participants: [], done: true },
  }
  return { key, root: { title: slug, tags: [], items: [], vaultId: VAULT, fileSlug: slug }, items: [item] }
}

function seedVault(ref: VaultRef, entries: Entry[], records: Array<{ path: string; lastModified?: number }>) {
  vaults.push(ref)
  layers.set(ref.id, new Map(entries.map(e => [e.key, e])))
  cacheRecords.set(ref.id, records)
}

beforeEach(() => {
  vaults.length = 0
  layers.clear()
  cacheRecords.clear()
  commitNextMock.mockClear()
  toastMock.mockClear()
})

describe('sweepRetention', () => {
  it('archives a finished, stale entry and toasts with an Undo action', async () => {
    const entry = finishedEntry('old-task')
    seedVault(
      { id: VAULT, name: 'Work', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' }, retentionDays: 7 },
      [entry],
      [{ path: 'old-task.md', lastModified: Date.now() - 30 * DAY_MS }],
    )

    await sweepRetention(VAULT)

    expect(commitNextMock).toHaveBeenCalledTimes(1)
    const [next, keys] = commitNextMock.mock.calls[0] as [{ entries: Entries }, EntryKey[]]
    expect(keys).toEqual([entry.key])
    expect(next.entries.get(entry.key)?.root.archived).toBe(true)
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [message, opts] = toastMock.mock.calls[0] as [string, { action: { label: string } }]
    expect(message).toContain('Archived 1 entry')
    expect(opts.action.label).toBe('Undo')
  })

  it('does not archive a finished entry that is not old enough', async () => {
    const entry = finishedEntry('recent-task')
    seedVault(
      { id: VAULT, name: 'Work', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' }, retentionDays: 30 },
      [entry],
      [{ path: 'recent-task.md', lastModified: Date.now() - 1 * DAY_MS }],
    )

    await sweepRetention(VAULT)
    expect(commitNextMock).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('does not archive an old but unfinished entry', async () => {
    const key = K('open-task')
    const item: StoreOcc = {
      date: '', time: null, source: 'explicit', entryKey: key, id: 'open-1',
      metadata: { participants: [], done: false },
    }
    const entry: Entry = { key, root: { title: 'open-task', tags: [], items: [], vaultId: VAULT, fileSlug: 'open-task' }, items: [item] }
    seedVault(
      { id: VAULT, name: 'Work', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' }, retentionDays: 7 },
      [entry],
      [{ path: 'open-task.md', lastModified: Date.now() - 30 * DAY_MS }],
    )

    await sweepRetention(VAULT)
    expect(commitNextMock).not.toHaveBeenCalled()
  })

  it('a cache row with no lastModified never archives', async () => {
    const entry = finishedEntry('unknown-age')
    seedVault(
      { id: VAULT, name: 'Work', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' }, retentionDays: 7 },
      [entry],
      [{ path: 'unknown-age.md' }], // no lastModified at all
    )

    await sweepRetention(VAULT)
    expect(commitNextMock).not.toHaveBeenCalled()
  })

  it('skips an entry already archived', async () => {
    const entry = finishedEntry('already-archived')
    entry.root.archived = true
    seedVault(
      { id: VAULT, name: 'Work', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' }, retentionDays: 7 },
      [entry],
      [{ path: 'already-archived.md', lastModified: Date.now() - 30 * DAY_MS }],
    )

    await sweepRetention(VAULT)
    expect(commitNextMock).not.toHaveBeenCalled()
  })

  it('skips a vault with no retentionDays set', async () => {
    const entry = finishedEntry('no-setting')
    seedVault(
      { id: VAULT, name: 'Work', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' } },
      [entry],
      [{ path: 'no-setting.md', lastModified: Date.now() - 30 * DAY_MS }],
    )

    await sweepRetention(VAULT)
    expect(commitNextMock).not.toHaveBeenCalled()
  })

  it('skips a non-writable vault even with retentionDays set', async () => {
    const entry = finishedEntry('subscription-entry')
    seedVault(
      { id: VAULT, name: 'Calendar', kind: 'ical', ical: { url: 'https://example.com/feed.ics' }, retentionDays: 7 },
      [entry],
      [{ path: 'subscription-entry.md', lastModified: Date.now() - 30 * DAY_MS }],
    )

    await sweepRetention(VAULT)
    expect(commitNextMock).not.toHaveBeenCalled()
  })

  it('is a no-op for an unregistered vault', async () => {
    await sweepRetention('nonexistent')
    expect(commitNextMock).not.toHaveBeenCalled()
  })
})
