/**
 * The durability half of a cross-vault move.
 *
 * The one invariant worth a real-Dexie test: the target vault's content is
 * durable *before* the source vault's tombstone is staged. Get that backwards
 * and a crash — or simply a tab closing — between the two writes loses the
 * entry from both vaults. Get it right and the worst case is the entry
 * existing in both, which is visible and recoverable.
 *
 * `@/storage/cache/files` is the real module here, running against
 * `fake-indexeddb`, wrapped only to record when each call *starts* and when it
 * *resolves* — which is what makes "durable before" assertable rather than
 * merely "called before". `./sync` is mocked: the push scheduling it owns is a
 * different concern, and mocking it keeps the sync module's timers out of a
 * test about IndexedDB ordering.
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type * as FilesModule from '@/storage/cache/files'
import type { StorageBackend, RawFile } from '@/storage/backend'
import type { VaultKind } from '@/vaultRef'
import { entryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { Roots, StoreItem } from '@/types'
import { parseToStoreItems, serializeEntry } from '@/model'

const { order, editError, syncFns, notifyFns, storeLayers } = vi.hoisted(() => ({
  order: [] as string[],
  editError: { next: null as Error | null },
  syncFns: { updateSyncUI: vi.fn(), scheduleAutoPush: vi.fn() },
  notifyFns: { notify: vi.fn(), notifyError: vi.fn() },
  storeLayers: new Map<string, { items: unknown[]; roots: Map<string, unknown> }>(),
}))

vi.mock('@/storage/cache/files', async (importActual) => {
  const actual = await importActual<typeof FilesModule>()
  return {
    ...actual,
    recordLocalEdit: vi.fn(async (vaultId: string, path: string, content: string) => {
      order.push(`edit:start:${vaultId}`)
      if (editError.next) { const e = editError.next; editError.next = null; throw e }
      await actual.recordLocalEdit(vaultId, path, content)
      order.push(`edit:done:${vaultId}`)
    }),
    recordLocalDelete: vi.fn(async (vaultId: string, path: string) => {
      order.push(`delete:start:${vaultId}`)
      await actual.recordLocalDelete(vaultId, path)
      order.push(`delete:done:${vaultId}`)
    }),
  }
})

vi.mock('@/storeBridge', () => ({
  getVaultLayer: vi.fn((vaultId: string) =>
    storeLayers.get(vaultId) ?? { items: [], roots: new Map() }),
}))

vi.mock('@/storage/sync', () => syncFns)

vi.mock('@/storage/notifications', () => notifyFns)

// Imports of the module under test must follow the vi.mock calls above.
import { moveEntityInCache } from '@/storage/moveEntry'
import { mountBackend, unmountAllBackends } from '@/storage/backends'
import { cacheLoadAll, recordLocalEdit } from '@/storage/cache/files'

// ── Fixtures ────────────────────────────────────────────────────────────────

const WORK = 'work'
const HOME = 'home'

class FakeBackend implements StorageBackend {
  readonly hasRemote = true
  readonly name: string

  constructor(
    readonly id: string,
    readonly readOnly = false,
    readonly kind: VaultKind = 'local',
  ) {
    this.name = id
  }

  statAll(): Promise<Map<string, string>> { return Promise.resolve(new Map<string, string>()) }
  readFiles(): Promise<RawFile[]> { return Promise.resolve([]) }
  readAll(): Promise<RawFile[]> { return Promise.resolve([]) }
  write(): Promise<string | undefined> { return Promise.resolve(undefined) }
  delete(): Promise<void> { return Promise.resolve() }
  ensurePermission(): Promise<PermissionState> { return Promise.resolve('granted') }
}

const MEETING = `---
title: Meeting notes
date: "2026-05-01"
---

Ship it.
`

const k = (vaultId: string, slug: string): EntryKey => entryKey(vaultId, slug)

/** Put `slug` in `vaultId`'s store layer, as the commit that precedes a move does. */
function seedLayer(vaultId: string, slug: string, content = MEETING): void {
  const parsed = parseToStoreItems(`${slug}.md`, content, vaultId)
  const layer = (storeLayers.get(vaultId) ?? { items: [], roots: new Map() }) as
    { items: StoreItem[]; roots: Roots }
  layer.items.push(...parsed.items)
  layer.roots.set(k(vaultId, slug), parsed.root)
  storeLayers.set(vaultId, layer)
}

/**
 * The bytes `commitMove` hands to the port for the moved entry — this module no
 * longer derives them itself, so the tests supply them the same way production
 * does.
 */
function movedContent(content = MEETING): string {
  const parsed = parseToStoreItems('meeting-notes.md', content, HOME)
  return serializeEntry(parsed.items, parsed.root)
}

async function rowsOf(vaultId: string) {
  return await cacheLoadAll(vaultId)
}

/** The state a move starts from: the source file durable in WORK, the store already re-keyed into HOME. */
async function seedMoved(): Promise<void> {
  await recordLocalEdit(WORK, 'meeting-notes.md', MEETING)
  seedLayer(HOME, 'meeting-notes')
  order.length = 0
}

describe('moveEntityInCache', () => {
  beforeEach(async () => {
    order.length = 0
    editError.next = null
    storeLayers.clear()
    syncFns.updateSyncUI.mockClear()
    syncFns.scheduleAutoPush.mockClear()
    notifyFns.notify.mockClear()
    notifyFns.notifyError.mockClear()
    unmountAllBackends()
    mountBackend(new FakeBackend(WORK))
    mountBackend(new FakeBackend(HOME))
    const { cacheDeleteAll } = await import('@/storage/cache/files')
    await cacheDeleteAll(WORK)
    await cacheDeleteAll(HOME)
  })

  afterEach(() => { unmountAllBackends() })

  it('makes the target durable before it even starts the source tombstone', async () => {
    await seedMoved()
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    expect(order).toEqual([
      `edit:start:${HOME}`,
      `edit:done:${HOME}`,
      `delete:start:${WORK}`,
      `delete:done:${WORK}`,
    ])
  })

  it('leaves the entry dirty in the target and tombstoned in the source', async () => {
    await seedMoved()
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    const target = (await rowsOf(HOME)).find(r => r.path === 'meeting-notes.md')
    expect(target?.status).toBe('dirty')
    expect(target?.content).toContain('title: Meeting notes')
    expect(target?.content).toContain('Ship it.')

    const source = (await rowsOf(WORK)).find(r => r.path === 'meeting-notes.md')
    expect(source?.status).toBe('deleted')
  })

  it('writes the entry under the slug it was allocated, not the one it had', async () => {
    await recordLocalEdit(WORK, 'meeting-notes.md', MEETING)
    seedLayer(HOME, 'meeting-notes-2')
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes-2'), movedContent())

    expect((await rowsOf(HOME)).map(r => r.path)).toEqual(['meeting-notes-2.md'])
  })

  it('pushes both vaults, so neither half waits for the next tick', async () => {
    await seedMoved()
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    expect(syncFns.scheduleAutoPush.mock.calls.map(([b]) => (b as StorageBackend).id).sort())
      .toEqual([HOME, WORK])
    expect(syncFns.updateSyncUI.mock.calls.map(([b]) => (b as StorageBackend).id).sort())
      .toEqual([HOME, WORK])
  })

  it('keeps the source when the target write fails — never a tombstone without a target', async () => {
    await seedMoved()
    editError.next = new Error('quota exceeded')
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    expect(order).toEqual([`edit:start:${HOME}`])
    expect((await rowsOf(WORK)).find(r => r.path === 'meeting-notes.md')?.status).toBe('dirty')
    expect(await rowsOf(HOME)).toEqual([])
    expect(notifyFns.notifyError).toHaveBeenCalled()
  })

  it('refuses a target vault that is not registered, before writing anything', async () => {
    await seedMoved()
    unmountAllBackends()
    mountBackend(new FakeBackend(WORK))
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    expect(order).toEqual([])
    expect((await rowsOf(WORK)).find(r => r.path === 'meeting-notes.md')?.status).toBe('dirty')
    expect(notifyFns.notify).toHaveBeenCalled()
  })

  it('refuses a read-only target — a subscription has nothing to write to', async () => {
    await seedMoved()
    unmountAllBackends()
    mountBackend(new FakeBackend(WORK))
    mountBackend(new FakeBackend(HOME, true, 'ical'))
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    expect(order).toEqual([])
    expect(await rowsOf(HOME)).toEqual([])
  })

  it('refuses a read-only source — an entry cannot move out of a subscription', async () => {
    await seedMoved()
    unmountAllBackends()
    mountBackend(new FakeBackend(WORK, true, 'ical'))
    mountBackend(new FakeBackend(HOME))
    await moveEntityInCache(k(WORK, 'meeting-notes'), k(HOME, 'meeting-notes'), movedContent())

    expect(order).toEqual([])
    expect(await rowsOf(HOME)).toEqual([])
  })

  // "the store has no content under the target key" is no longer reachable
  // here: the content is handed in, so that check belongs to — and now lives
  // in — `commitMove`, which makes it *before* committing the re-key rather
  // than after. See `src/storeCommit.test.ts`.
})
