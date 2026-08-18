/**
 * Unit tests for the vault lifecycle in vaultRegistry.ts: restoreVaults'
 * two-phase mount of *every* registered vault (cache-first paint for all of
 * them, then credentials/permission/first-sync one at a time), removeVault's
 * teardown, and the default-vault reconciliation that replaces the old single
 * "active vault" pointer.
 *
 * Registered is mounted: there is no vault to choose at startup and no
 * fallback-to-Tutorial path, because the Tutorial vault is always mounted
 * alongside whatever else is registered. What used to be "did we activate the
 * right one?" is now "is every one of them mounted, and did one vault's
 * failure leave the others alone?".
 *
 * All collaborators are replaced with in-memory fakes so the tests don't need
 * Dexie/IndexedDB, a real FileSystemDirectoryHandle, a DOM-backed zustand
 * store, or network access to GitHub — mirroring the approach in
 * sync.test.ts. LocalBackend/GitHubBackend are mocked wholesale (rather than
 * exercised through fs.ts/githubApi.ts) purely so `ensurePermission()` is
 * directly controllable per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VaultRef } from '@/vaultRef'
import type { PermissionOutcome } from '@/storage/backend'

/** A promise plus its resolver, for tests that need to hold an await open. */
interface Gate { promise: Promise<void>; release: () => void }

/** Builds a gate a test can hold closed, then release to let an await proceed. */
function makeGate(): Gate {
  let release!: () => void
  const promise = new Promise<void>(res => { release = res })
  return { promise, release }
}

const {
  metaStore, storeState, notifyFns, syncFns, backendConfig, cacheConfig, callOrder,
} = vi.hoisted(() => {
  const backendConfig: {
    localPermission: PermissionOutcome
    githubPermission: PermissionOutcome
    exampleReadAllError: Error | null
    /** When set, ensurePermission awaits this before answering. */
    permissionGate: Gate | null
    /** When set, ensurePermission throws this instead of answering. */
    permissionError: Error | null
  } = {
    localPermission: 'granted',
    githubPermission: 'granted',
    exampleReadAllError: null,
    permissionGate: null,
    permissionError: null,
  }
  return {
    backendConfig,
    metaStore: new Map<string, unknown>(),
    /** Records which collaborator ran when, for ordering assertions. */
    callOrder: [] as string[],
    cacheConfig: {
      /** Cached rows per vault id, as cacheLoadAll would return them. */
      rows: new Map<string, Array<{ path: string; content: string }>>(),
    },
    storeState: {
      /** Per-vault layers — the shape the real store holds. */
      layers: new Map<string, { items: unknown[]; roots: Map<string, unknown> }>(),
      /** The flattening of `layers`, maintained by the setVaultLayer mock as the store does. */
      items: [] as unknown[],
      roots: new Map<string, unknown>(),
      unreadableFiles: new Map<string, { path: string; message: string }>(),
      vaults: [] as VaultRef[],
      defaultVaultId: null as string | null,
      /** vaultId → the fields setVaultSync writes. */
      syncByVault: new Map<string, Record<string, unknown>>(),
      vaultLoading: false,
      vaultLoadProgress: null as { loaded: number; total: number } | null,
      /** Vault ids whose cross-vault prefs were last (re)loaded — see loadGlobalPrefs. */
      prefsLoadedFor: null as string[] | null,
      /** Vault whose lazy defaultParticipants were last loaded. */
      participantsLoadedFor: null as string | null,
    },
    notifyFns: { notify: vi.fn(), notifyError: vi.fn(), warn: vi.fn() },
    syncFns: {
      // Stands in for the real syncOnActivate, which never rejects (runSync
      // swallows its own errors) — so this never throws either.
      syncOnActivate: vi.fn(async () => {}),
      // Echo one item/root per file so "did the cache paint?" is observable
      // via storeState.items.length.
      parseFiles: vi.fn((files: Array<{ path: string; content: string }>) => ({
        items: files.map(f => ({ entryKey: f.path })),
        roots: new Map(files.map(f => [f.path, { body: f.content }])),
        failures: [] as Array<{ path: string; slug: string; message: string }>,
        // The round-trip guard is deferred out of parseFiles now (see
        // auditRoundTrip in sync.ts); callers invoke this thunk instead of
        // reporting a `lossy` array inline.
        auditRoundTrip: () => {},
      })),
      reportParseFailures: vi.fn(),
      updateSyncUI: vi.fn(),
      dropSyncState: vi.fn(),
    },
  }
})

vi.mock('@/storage/cache/db', () => ({
  cacheInit: vi.fn(async () => {}),
}))

vi.mock('@/storage/cache/files', () => ({
  cacheLoadAll: vi.fn(async (vaultId: string) => {
    callOrder.push('cacheLoadAll')
    return cacheConfig.rows.get(vaultId) ?? []
  }),
  applyRemoteBatch: vi.fn(async () => []),
  cacheDeleteAll: vi.fn(async (vaultId: string) => {
    for (const k of Array.from(metaStore.keys())) if (k.startsWith(`files:${vaultId}:`)) metaStore.delete(k)
  }),
}))

vi.mock('@/storage/cache/credentials', () => ({
  handleSave: vi.fn(async (id: string, h: unknown) => { metaStore.set(`handle:${id}`, h) }),
  handleLoad: vi.fn(async (id: string) => metaStore.get(`handle:${id}`) ?? null),
  handleClear: vi.fn(async (id: string) => { metaStore.delete(`handle:${id}`) }),
  tokenSave: vi.fn(async (id: string, t: string) => { metaStore.set(`token:${id}`, t) }),
  tokenClear: vi.fn(async (id: string) => { metaStore.delete(`token:${id}`) }),
  refreshTokenSave: vi.fn(async (id: string, t: string) => { metaStore.set(`refreshToken:${id}`, t) }),
  refreshTokenClear: vi.fn(async (id: string) => { metaStore.delete(`refreshToken:${id}`) }),
  tokenExpirySave: vi.fn(async (id: string, e: number) => { metaStore.set(`tokenExpiry:${id}`, e) }),
  tokenExpiryClear: vi.fn(async (id: string) => { metaStore.delete(`tokenExpiry:${id}`) }),
  credentialsSave: vi.fn(async (id: string, c: { accessToken: string; refreshToken: string; expiresAt: number }) => {
    metaStore.set(`token:${id}`, c.accessToken)
    metaStore.set(`refreshToken:${id}`, c.refreshToken)
    metaStore.set(`tokenExpiry:${id}`, c.expiresAt)
  }),
}))

vi.mock('@/storage/cache/registry', () => ({
  vaultRefsSave: vi.fn(async (refs: VaultRef[]) => { metaStore.set('vaults', refs) }),
  vaultRefsLoad: vi.fn(async () => (metaStore.get('vaults') as VaultRef[] | undefined) ?? []),
  activeVaultIdSave: vi.fn(async (id: string | null) => {
    if (id === null) metaStore.delete('activeVaultId')
    else metaStore.set('activeVaultId', id)
  }),
  activeVaultIdLoad: vi.fn(async () => (metaStore.get('activeVaultId') as string | undefined) ?? null),
  exampleVaultRemovedLoad: vi.fn(async () => (metaStore.get('exampleVaultRemoved') as boolean | undefined) ?? null),
  exampleVaultRemovedSave: vi.fn(async (removed: boolean) => { metaStore.set('exampleVaultRemoved', removed) }),
}))

vi.mock('@/storage/fs', () => ({ diskPickDirectory: vi.fn() }))

vi.mock('@/storage/localBackend', () => ({
  LocalBackend: class {
    readonly kind = 'local'
    readonly readOnly = false
    readonly hasRemote = true
    constructor(public id: string, public name: string, public handle: unknown) {}
    async ensurePermission(_interactive: boolean): Promise<PermissionOutcome> {
      callOrder.push('ensurePermission')
      if (backendConfig.permissionGate) await backendConfig.permissionGate.promise
      if (backendConfig.permissionError) throw backendConfig.permissionError
      return backendConfig.localPermission
    }
    async statAll() { return new Map<string, string>() }
    async readFiles() { return [] }
    async readAll() { return [] }
    async write() { return undefined }
    async delete() {}
  },
}))

vi.mock('@/storage/githubBackend', () => ({
  GitHubBackend: class {
    readonly kind = 'github'
    readonly readOnly = false
    readonly hasRemote = true
    constructor(public id: string, public name: string, public cfg: unknown) {}
    async ensurePermission(_interactive: boolean): Promise<PermissionOutcome> {
      callOrder.push('ensurePermission')
      if (backendConfig.permissionGate) await backendConfig.permissionGate.promise
      if (backendConfig.permissionError) throw backendConfig.permissionError
      return backendConfig.githubPermission
    }
    async statAll() { return new Map<string, string>() }
    async readFiles() { return [] }
    async readAll() { return [] }
    async write() { return undefined }
    async delete() {}
    async refreshAuth() { return true }
  },
}))

vi.mock('@/storage/exampleBackend', () => ({
  ExampleBackend: class {
    readonly id = 'example'
    readonly name = 'Tutorial'
    readonly kind = 'example'
    readonly readOnly = true
    readonly hasRemote = false
    async ensurePermission(): Promise<PermissionOutcome> { return 'granted' }
    async statAll() { return new Map<string, string>() }
    async readFiles() { return [] }
    async readAll() {
      if (backendConfig.exampleReadAllError) throw backendConfig.exampleReadAllError
      return []
    }
    async write() { return undefined }
    async delete() {}
  },
}))

vi.mock('@/storage/githubOAuth', () => ({
  ensureFreshAccessToken: vi.fn(),
}))

vi.mock('@/storeBridge', () => ({
  setVaultLayer: vi.fn((vaultId: string, data: { items: unknown[]; roots: Map<string, unknown> }) => {
    callOrder.push(`setVaultLayer:${vaultId}`)
    storeState.layers.set(vaultId, data)
    storeState.items = [...storeState.layers.values()].flatMap(l => l.items)
    storeState.roots = new Map([...storeState.layers.values()].flatMap(l => [...l.roots]))
  }),
  removeVaultLayer: vi.fn((vaultId: string) => {
    storeState.layers.delete(vaultId)
    storeState.items = [...storeState.layers.values()].flatMap(l => l.items)
    storeState.roots = new Map([...storeState.layers.values()].flatMap(l => [...l.roots]))
  }),
  setVaultSync: vi.fn((vaultId: string, patch: Record<string, unknown>) => {
    storeState.syncByVault.set(vaultId, { ...storeState.syncByVault.get(vaultId), ...patch })
  }),
  removeVaultSync: vi.fn((vaultId: string) => { storeState.syncByVault.delete(vaultId) }),
  getUnreadableFiles: vi.fn(() => storeState.unreadableFiles),
  setUnreadableFiles: vi.fn((files: Map<string, { path: string; message: string }>) => { storeState.unreadableFiles = files }),
  getVaults: vi.fn(() => storeState.vaults),
  setStoreState: vi.fn((partial: Partial<typeof storeState>) => {
    // The cache-first paint gate — the moment AgendaPage stops showing the
    // skeleton and mounts the agenda against whatever is in the store.
    if (partial.vaultLoading === false) callOrder.push('paintGate')
    Object.assign(storeState, partial)
  }),
  loadGlobalPrefs: vi.fn((ids: string[]) => { callOrder.push('loadGlobalPrefs'); storeState.prefsLoadedFor = ids }),
  loadDefaultParticipants: vi.fn((id: string) => { storeState.participantsLoadedFor = id }),
  getDefaultVaultId: vi.fn(() => storeState.defaultVaultId),
  setDefaultVaultId: vi.fn((id: string | null) => { storeState.defaultVaultId = id }),
}))

vi.mock('@/storage/notifications', () => notifyFns)

vi.mock('@/storage/sync', () => syncFns)

// Imports of the module under test (and its non-mocked collaborators — the
// trivial in-memory backend registry) must come after the vi.mock calls.
import {
  restoreVaults, reconnectVault, setDefaultVault, removeVault, renameVault, addExampleVault,
  addLocalVault, addGitHubVaultOAuth, onVaultChanged, newVaultId,
} from '@/storage/vaultRegistry'
import { getBackend, getMountedVaultIds, unmountAllBackends } from '@/storage/backends'
import { ensureFreshAccessToken } from '@/storage/githubOAuth'
import { vaultRefsLoad, vaultRefsSave } from '@/storage/cache/registry'
import { diskPickDirectory } from '@/storage/fs'

const LOCAL_REF: VaultRef = { id: 'local-1', name: 'My Vault', kind: 'local' }
const GITHUB_REF: VaultRef = { id: 'gh-1', name: 'me/repo', kind: 'github', github: { owner: 'me', repo: 'repo', branch: 'main' } }

beforeEach(() => {
  metaStore.clear()
  storeState.layers.clear()
  storeState.syncByVault.clear()
  storeState.items = []
  storeState.roots = new Map()
  storeState.unreadableFiles = new Map()
  storeState.vaults = []
  storeState.defaultVaultId = null
  storeState.vaultLoading = false
  storeState.vaultLoadProgress = null
  storeState.prefsLoadedFor = null
  storeState.participantsLoadedFor = null
  cacheConfig.rows.clear()
  callOrder.length = 0
  notifyFns.notify.mockClear()
  notifyFns.notifyError.mockClear()
  notifyFns.warn.mockClear()
  syncFns.syncOnActivate.mockClear()
  syncFns.parseFiles.mockClear()
  syncFns.reportParseFailures.mockClear()
  syncFns.updateSyncUI.mockClear()
  backendConfig.localPermission = 'granted'
  backendConfig.githubPermission = 'granted'
  backendConfig.exampleReadAllError = null
  backendConfig.permissionGate = null
  backendConfig.permissionError = null
  vi.mocked(ensureFreshAccessToken).mockReset()
  vi.mocked(diskPickDirectory).mockReset()
  unmountAllBackends()
})

// ── restoreVaults — no saved vault ──────────────────────────────────────

describe('restoreVaults — nothing registered', () => {
  it('mounts the Tutorial vault, and leaves no default vault to point at', async () => {
    await restoreVaults()

    expect(getMountedVaultIds()).toEqual(['example'])
    expect(storeState.vaults.map(v => v.id)).toEqual(['example'])
    // Nothing writable exists, so there is nowhere for a new entry to go yet.
    expect(storeState.defaultVaultId).toBeNull()
    expect(storeState.vaultLoading).toBe(false) // reset in the outer finally
  })
})

// ── restoreVaults — mounting every registered vault ──────────────────────

describe('restoreVaults — local vault', () => {
  beforeEach(() => {
    metaStore.set('vaults', [LOCAL_REF])
  })

  it('mounts and syncs the vault when permission is already granted', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'granted'

    await restoreVaults()

    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)
    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)
    // No separate flushPendingPush assertion: syncOnActivate subsumes it —
    // it routes through runSync, whose pushDirty leg rescues a previous
    // session's dirty records in the same cycle as the reconcile.
    expect(syncFns.syncOnActivate).toHaveBeenCalledTimes(1)
  })

  it('does not mount the Tutorial vault when a real vault already exists and its removal was never decided', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})

    await restoreVaults()

    // An install that predates the removable-Tutorial-vault feature already
    // has a real vault and was never offered this choice — treat that the
    // same as if it had already been dismissed, rather than resurrecting it.
    expect(getMountedVaultIds()).toEqual([LOCAL_REF.id])
    expect(metaStore.get('exampleVaultRemoved')).toBe(true)
  })

  it('mounts the Tutorial vault alongside a real vault once it has been explicitly kept', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    metaStore.set('exampleVaultRemoved', false)

    await restoreVaults()

    // Registering a real vault does not unregister anything once the
    // Tutorial vault's presence is an explicit choice rather than a default.
    expect(getMountedVaultIds().sort()).toEqual(['example', LOCAL_REF.id].sort())
  })

  it('flags a needed reconnect without syncing when permission wants a user gesture', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'prompt'

    await restoreVaults()

    // Mounted, so its cached entries are readable and it appears in the sync
    // popover — but parked: no cycle is started for a vault still waiting on a
    // gesture only the user can make.
    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)
    expect(storeState.syncByVault.get(LOCAL_REF.id)?.needsReconnect).toBe(true)
    expect(syncFns.syncOnActivate).not.toHaveBeenCalled()
  })

  it('warns but keeps going when the directory handle was never saved', async () => {
    await restoreVaults()

    expect(getBackend(LOCAL_REF.id)).toBeUndefined()
    expect(syncFns.syncOnActivate).not.toHaveBeenCalled()
    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
    // A real vault is already registered (even though it failed to mount),
    // so the Tutorial vault has been migrated away by default.
    expect(getMountedVaultIds()).toEqual([])
  })

  it('does not mount a vault whose permission was denied outright', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'denied'

    await restoreVaults()

    expect(getBackend(LOCAL_REF.id)).toBeUndefined()
  })
})

describe('restoreVaults — github vault', () => {
  beforeEach(() => {
    metaStore.set('vaults', [GITHUB_REF])
  })

  it('mounts and syncs when the token is usable and permission is granted', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })

    await restoreVaults()

    expect(getMountedVaultIds()).toContain(GITHUB_REF.id)
    expect(storeState.defaultVaultId).toBe(GITHUB_REF.id)
    expect(syncFns.syncOnActivate).toHaveBeenCalledTimes(1)
  })

  it('mounts as writable when the network is unreachable, and does not blame the token', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    backendConfig.githubPermission = 'unreachable'

    await restoreVaults()

    // 'unreachable' is not 'denied': the credential is fine, the network
    // isn't. Offline edits must still be recordable and pushed on reconnect.
    expect(getMountedVaultIds()).toContain(GITHUB_REF.id)
    expect(syncFns.syncOnActivate).toHaveBeenCalledTimes(1)
    expect(notifyFns.notify).not.toHaveBeenCalled()
  })

  it('notifies but keeps going when permission is not granted', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    backendConfig.githubPermission = 'denied'

    await restoreVaults()

    expect(getBackend(GITHUB_REF.id)).toBeUndefined()
    expect(notifyFns.notify).toHaveBeenCalledTimes(1)
  })
})

// ── restoreVaults — one vault's failure must not take the others down ────

describe('restoreVaults — several vaults', () => {
  beforeEach(() => {
    metaStore.set('vaults', [LOCAL_REF, GITHUB_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
  })

  it('mounts both, each with its own layer, merged into one view', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    cacheConfig.rows.set(LOCAL_REF.id,  [{ path: 'local.md',  content: '# Local' }])
    cacheConfig.rows.set(GITHUB_REF.id, [{ path: 'remote.md', content: '# Remote' }])

    await restoreVaults()

    expect(storeState.layers.get(LOCAL_REF.id)?.items).toHaveLength(1)
    expect(storeState.layers.get(GITHUB_REF.id)?.items).toHaveLength(1)
    // Two real vaults already exist, so the Tutorial vault was migrated away
    // and never mounted a layer at all — the merge is what every view reads.
    expect(storeState.items).toHaveLength(2)
    expect(syncFns.syncOnActivate).toHaveBeenCalledTimes(2)
  })

  // The point of the per-vault try/catch: a dead GitHub token used to be a
  // whole-app fallback to the Tutorial vault. Now it costs exactly one vault.
  it('keeps a healthy vault mounted when another one throws while mounting', async () => {
    vi.mocked(ensureFreshAccessToken).mockRejectedValue(new Error('token endpoint down'))
    cacheConfig.rows.set(LOCAL_REF.id, [{ path: 'local.md', content: '# Local' }])

    await restoreVaults()

    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)
    expect(getBackend(GITHUB_REF.id)).toBeUndefined()
    expect(storeState.items).toHaveLength(1)
    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)
  })

  it('adopts the legacy active-vault id as the default when no default was ever chosen', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    metaStore.set('activeVaultId', GITHUB_REF.id)

    await restoreVaults()

    // Not simply the first registered vault: the pointer the pre-multi-vault
    // build persisted is still the best evidence of which vault the user
    // thinks of as theirs.
    expect(storeState.defaultVaultId).toBe(GITHUB_REF.id)
  })

  it('never points the default at the read-only Tutorial vault', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    metaStore.set('activeVaultId', 'example')

    await restoreVaults()

    // A default that cannot accept writes would refuse every new entry, and
    // silently — writeEntityToCache bails on a read-only backend.
    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)
  })
})

// ── restoreVaults — cache-first paint ────────────────────────────────────

describe('restoreVaults — cache-first paint', () => {
  beforeEach(() => {
    metaStore.set('vaults', [GITHUB_REF])
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    storeState.vaultLoading = true
  })

  it('paints cached content and clears the skeleton without waiting on ensurePermission', async () => {
    cacheConfig.rows.set(GITHUB_REF.id, [
      { path: 'a.md', content: '# A' },
      { path: 'b.md', content: '# B' },
    ])
    const gate = makeGate()
    backendConfig.permissionGate = gate

    const restoring = restoreVaults()

    // While the permission probe is still blocked, the agenda must already
    // have real content and no skeleton. This is the load-bearing assertion:
    // it fails if the cache phase ever moves back below the network work.
    await vi.waitFor(() => { expect(storeState.items).toHaveLength(2) })
    expect(storeState.vaultLoading).toBe(false)

    gate.release()
    await restoring
    expect(getMountedVaultIds()).toContain(GITHUB_REF.id)
  })

  // The reported "up to a second before it scrolls to today": the calendar
  // listens on this signal, and it only arrives after the OAuth refresh and the
  // two ensurePermission round trips. It must not carry `contentReplaced` on
  // this path, or the listener throws away the expansion and grouping the first
  // paint just built — and re-does them, visibly, that far into the load.
  it('reports contentReplaced: false when the cache pre-painted', async () => {
    cacheConfig.rows.set(GITHUB_REF.id, [{ path: 'a.md', content: '# A' }])
    const changes: boolean[] = []
    const off = onVaultChanged(({ contentReplaced }) => changes.push(contentReplaced))

    await restoreVaults()
    off()

    expect(changes).toEqual([false])
  })

  it('reports contentReplaced: true when every cache was empty', async () => {
    // Nothing cached — the mount itself paints, over whatever was there.
    const changes: boolean[] = []
    const off = onVaultChanged(({ contentReplaced }) => changes.push(contentReplaced))

    await restoreVaults()
    off()

    expect(changes).toEqual([true])
  })

  // The agenda seeds its scroll position from the row list it first mounts
  // with, so every vault layer has to be in the store before the paint gate
  // opens. A layer landing afterwards inserts rows above the viewport and
  // shifts the visible day — reported as "GitHub alone is fine, GitHub +
  // Tutorial lands half a screen off, GitHub + iCal lands a month early".
  //
  // The vault kinds are a red herring: every mountable vault hydrates through
  // the same phase-1 loop. What differed was only whether a second layer
  // landed after the gate — and the Tutorial vault always did, because it was
  // mounted after it.
  it('opens the paint gate only once every cached vault is in the store', async () => {
    metaStore.set('vaults', [LOCAL_REF, GITHUB_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    metaStore.set('exampleVaultRemoved', false)
    cacheConfig.rows.set(LOCAL_REF.id,  [{ path: 'local.md',  content: '# Local' }])
    cacheConfig.rows.set(GITHUB_REF.id, [{ path: 'remote.md', content: '# Remote' }])

    await restoreVaults()

    const gate = callOrder.indexOf('paintGate')
    expect(gate).toBeGreaterThan(-1)
    for (const id of [LOCAL_REF.id, GITHUB_REF.id, 'example']) {
      expect(callOrder.indexOf(`setVaultLayer:${id}`)).toBeGreaterThan(-1)
      expect(callOrder.indexOf(`setVaultLayer:${id}`)).toBeLessThan(gate)
    }
  })

  // A layer landing after the paint gate opens inserts rows above the
  // viewport and shifts the visible day (see the test above) — so a Tutorial
  // vault migrated away by this restore must never paint a layer at all, not
  // merely a hidden one that could still land late.
  it('migrates the Tutorial vault away without ever mounting it, when a real vault already exists', async () => {
    cacheConfig.rows.set(GITHUB_REF.id, [{ path: 'a.md', content: '# A' }])

    await restoreVaults()

    expect(metaStore.get('exampleVaultRemoved')).toBe(true)
    expect(getMountedVaultIds()).not.toContain('example')
    expect(callOrder).not.toContain('setVaultLayer:example')
  })

  // The agenda's first frame is built through useCalendarFilter, which reads
  // hiddenVaultIds/hiddenParticipants/showTasks. Those are a localStorage read,
  // but they used to arrive behind the token refresh and the permission probe.
  // The cache then painted unfiltered, and when the real prefs landed the
  // filtered-out rows (the whole overdue section, with tasks hidden) vanished
  // from *above* the scroll position and slid the agenda days forward.
  it('loads the cross-vault preferences before painting, not after the permission probe', async () => {
    cacheConfig.rows.set(GITHUB_REF.id, [{ path: 'a.md', content: '# A' }])
    const gate = makeGate()
    backendConfig.permissionGate = gate

    const restoring = restoreVaults()

    await vi.waitFor(() => { expect(storeState.items).toHaveLength(1) })
    // Loaded for every registered vault at once, not for one "active" one —
    // the Favorites list and the filter popover both span all of them. The
    // Tutorial vault is absent here: a real vault already existed, so it was
    // migrated away by default.
    expect(storeState.prefsLoadedFor).toEqual([GITHUB_REF.id])

    gate.release()
    await restoring

    // Ordering, not just presence — the whole point is that it precedes both.
    expect(callOrder.indexOf('loadGlobalPrefs')).toBeLessThan(callOrder.indexOf('cacheLoadAll'))
    expect(callOrder.indexOf('loadGlobalPrefs')).toBeLessThan(callOrder.indexOf('ensurePermission'))
  })

  it('reads the cache before probing permission, and only once', async () => {
    cacheConfig.rows.set(GITHUB_REF.id, [{ path: 'a.md', content: '# A' }])

    await restoreVaults()

    // Ordering, not just presence: a future refactor that hydrates after the
    // permission check would still pass a "was it called?" assertion.
    expect(callOrder.indexOf('cacheLoadAll')).toBeLessThan(callOrder.indexOf('ensurePermission'))
    // prePainted threads through mountVaultRef, so the same rows are not
    // re-read on the way into loadVaultContent.
    expect(callOrder.filter(c => c === 'cacheLoadAll')).toHaveLength(1)
  })

  it('keeps the skeleton up until the first sync settles when the cache is empty', async () => {
    // No cached rows — the skeleton is the only thing on screen, so clearing
    // it before the sync fills the store would flash an empty agenda.
    const gate = makeGate()
    syncFns.syncOnActivate.mockImplementationOnce(async () => { await gate.promise })

    const restoring = restoreVaults()

    await vi.waitFor(() => { expect(syncFns.syncOnActivate).toHaveBeenCalled() })
    expect(storeState.vaultLoading).toBe(true)

    gate.release()
    await restoring
    expect(storeState.vaultLoading).toBe(false)
  })
})

// ── restoreVaults — unexpected failure ───────────────────────────────────

describe('restoreVaults — unexpected failure', () => {
  it('still leaves the Tutorial vault mounted so the app is never contentless', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    // Fails inside the try, before phase 1 — the whole restore unwinds.
    vi.mocked(vaultRefsLoad).mockRejectedValueOnce(new Error('dexie exploded'))

    await restoreVaults()

    expect(getMountedVaultIds()).toEqual(['example'])
    expect(storeState.vaultLoading).toBe(false)
  })

  it('still clears vaultLoading even when the fallback itself throws', async () => {
    storeState.vaultLoading = true
    vi.mocked(vaultRefsLoad).mockRejectedValueOnce(new Error('dexie exploded'))
    backendConfig.exampleReadAllError = new Error('example vault broken too')

    await restoreVaults()

    expect(storeState.vaultLoading).toBe(false)
  })
})

// ── reconnectVault ───────────────────────────────────────────────────────
//
// The user gesture the restore path structurally cannot make: re-requesting
// filesystem permission has to originate from a click, which is why this is a
// separate entry point rather than something the scheduler retries.

describe('reconnectVault', () => {
  beforeEach(() => {
    storeState.vaults = [LOCAL_REF]
    metaStore.set('vaults', [LOCAL_REF])
  })

  it('mounts and syncs the vault when permission is granted interactively', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'granted'

    await reconnectVault(LOCAL_REF.id)

    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)
    expect(storeState.syncByVault.get(LOCAL_REF.id)?.needsReconnect).toBe(false)
    expect(syncFns.syncOnActivate).toHaveBeenCalledTimes(1)
  })

  it('notifies without mounting when the handle is missing', async () => {
    await reconnectVault(LOCAL_REF.id)

    expect(getBackend(LOCAL_REF.id)).toBeUndefined()
    expect(notifyFns.notify).toHaveBeenCalledTimes(1)
  })

  it('notifies without mounting when permission is denied', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'denied'

    await reconnectVault(LOCAL_REF.id)

    expect(getBackend(LOCAL_REF.id)).toBeUndefined()
    expect(notifyFns.notify).toHaveBeenCalledTimes(1)
  })

  it('warns rather than blaming the credential when the vault is offline', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'unreachable'

    await reconnectVault(LOCAL_REF.id)

    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)
    expect(notifyFns.warn).toHaveBeenCalledTimes(1)
    expect(notifyFns.notify).not.toHaveBeenCalled()
  })

  it('is a no-op for an id not in the known vault list', async () => {
    await reconnectVault('nope')

    expect(getMountedVaultIds()).toHaveLength(0)
    expect(notifyFns.notify).not.toHaveBeenCalled()
  })

  it('silently ignores an AbortError (e.g. a directory-picker style cancel)', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    const abort = new Error('cancelled')
    abort.name = 'AbortError'
    backendConfig.permissionError = abort

    await reconnectVault(LOCAL_REF.id)

    expect(notifyFns.notifyError).not.toHaveBeenCalled()
    expect(notifyFns.notify).not.toHaveBeenCalled()
  })

  it('surfaces any other unexpected error via notifyError', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.permissionError = new Error('disk on fire')

    await reconnectVault(LOCAL_REF.id)

    expect(notifyFns.notifyError).toHaveBeenCalledTimes(1)
  })
})

// ── setDefaultVault ──────────────────────────────────────────────────────

describe('setDefaultVault', () => {
  it('changes only where new entries go — nothing loads, unloads or re-syncs', () => {
    storeState.vaults = [LOCAL_REF, GITHUB_REF]
    storeState.defaultVaultId = LOCAL_REF.id

    setDefaultVault(GITHUB_REF.id)

    expect(storeState.defaultVaultId).toBe(GITHUB_REF.id)
    // The lazily-loaded per-vault pref follows the target, since it seeds new entries.
    expect(storeState.participantsLoadedFor).toBe(GITHUB_REF.id)
    expect(syncFns.syncOnActivate).not.toHaveBeenCalled()
    expect(storeState.layers.size).toBe(0)
  })

  it('refuses a read-only vault, which could never accept a new entry', () => {
    storeState.vaults = [{ id: 'example', name: 'Tutorial', kind: 'example' }, LOCAL_REF]
    storeState.defaultVaultId = LOCAL_REF.id

    setDefaultVault('example')

    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)
  })

  it('is a no-op for an unknown id', () => {
    storeState.vaults = [LOCAL_REF]
    storeState.defaultVaultId = LOCAL_REF.id

    setDefaultVault('nope')

    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)
  })
})

// ── removeVault ──────────────────────────────────────────────────────────

describe('removeVault', () => {
  it('unmounts, drops the layer and sync row, and clears the credential', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    await restoreVaults()
    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)

    await removeVault(LOCAL_REF.id)

    expect(getBackend(LOCAL_REF.id)).toBeUndefined()
    expect(storeState.layers.has(LOCAL_REF.id)).toBe(false)
    expect(storeState.syncByVault.has(LOCAL_REF.id)).toBe(false)
    expect(metaStore.get(`handle:${LOCAL_REF.id}`)).toBeUndefined()
    expect((metaStore.get('vaults') as VaultRef[]).find(r => r.id === LOCAL_REF.id)).toBeUndefined()
  })

  // Unmounting first is what stops a reconcile still in flight from merging
  // its results back into a layer this call is about to drop — see
  // reconcileWithBackend's own registry re-check.
  it('unmounts before the registry write, so a late reconcile cannot resurrect the layer', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    await restoreVaults()

    let mountedAtRegistryWrite: string[] = []
    vi.mocked(vaultRefsSave).mockImplementationOnce(async (refs: VaultRef[]) => {
      mountedAtRegistryWrite = getMountedVaultIds()
      metaStore.set('vaults', refs)
    })

    await removeVault(LOCAL_REF.id)

    expect(mountedAtRegistryWrite).not.toContain(LOCAL_REF.id)
  })

  it('clears github credentials and leaves another registered vault alone', async () => {
    metaStore.set('vaults', [LOCAL_REF, GITHUB_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    metaStore.set(`token:${GITHUB_REF.id}`, 't')
    metaStore.set(`refreshToken:${GITHUB_REF.id}`, 'r')
    metaStore.set(`tokenExpiry:${GITHUB_REF.id}`, 1)
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    await restoreVaults()

    await removeVault(GITHUB_REF.id)

    expect(getMountedVaultIds()).toContain(LOCAL_REF.id) // untouched
    expect(metaStore.get(`token:${GITHUB_REF.id}`)).toBeUndefined()
    expect(metaStore.get(`refreshToken:${GITHUB_REF.id}`)).toBeUndefined()
    expect(metaStore.get(`tokenExpiry:${GITHUB_REF.id}`)).toBeUndefined()
  })

  it('re-points the default vault when the removed one was it', async () => {
    metaStore.set('vaults', [LOCAL_REF, GITHUB_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })
    await restoreVaults()
    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)

    await removeVault(LOCAL_REF.id)

    // A dangling default would silently refuse every new entry.
    expect(storeState.defaultVaultId).toBe(GITHUB_REF.id)
  })

  it('is a no-op for an id not present in the registry', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    await restoreVaults()

    await removeVault('nope')

    expect(getMountedVaultIds()).toContain(LOCAL_REF.id)
    expect((metaStore.get('vaults') as VaultRef[])).toHaveLength(1)
  })

  // The Tutorial vault is addable and removable like any other vault, even
  // though — unlike a local/github/ical ref — it is never in the persisted
  // `vaults` list; `removeVault` dispatches on the id instead.
  it('unmounts and unregisters the Tutorial vault, same as any other vault', async () => {
    await restoreVaults()
    expect(getMountedVaultIds()).toEqual(['example'])

    await removeVault('example')

    expect(getMountedVaultIds()).toEqual([])
    expect(storeState.layers.has('example')).toBe(false)
    expect(storeState.syncByVault.has('example')).toBe(false)
    expect(storeState.vaults.some(v => v.id === 'example')).toBe(false)
    expect(metaStore.get('exampleVaultRemoved')).toBe(true)
  })

  it('leaves another registered vault mounted and untouched', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    metaStore.set('exampleVaultRemoved', false)
    await restoreVaults()

    await removeVault('example')

    expect(getMountedVaultIds()).toEqual([LOCAL_REF.id])
    expect(storeState.defaultVaultId).toBe(LOCAL_REF.id)
  })
})

// ── addExampleVault ────────────────────────────────────────────────────────

describe('addExampleVault', () => {
  it('re-registers and mounts the Tutorial vault after it was removed', async () => {
    await restoreVaults()
    await removeVault('example')
    expect(getMountedVaultIds()).toEqual([])

    await addExampleVault()

    expect(getMountedVaultIds()).toEqual(['example'])
    expect(storeState.vaults.some(v => v.id === 'example')).toBe(true)
    expect(metaStore.get('exampleVaultRemoved')).toBe(false)
  })

  it('is a no-op when the Tutorial vault is already registered', async () => {
    await restoreVaults()
    expect(getMountedVaultIds()).toEqual(['example'])

    await addExampleVault()

    expect(getMountedVaultIds()).toEqual(['example'])
  })
})

// ── registerAndMount — auto-removing the Tutorial vault ──────────────────

describe('adding the first real vault', () => {
  it('actually removes the Tutorial vault, not merely hides it', async () => {
    await restoreVaults()
    expect(getMountedVaultIds()).toEqual(['example'])
    vi.mocked(diskPickDirectory).mockResolvedValue(
      { name: 'My Vault' } as unknown as FileSystemDirectoryHandle,
    )

    await addLocalVault()

    expect(getMountedVaultIds()).toEqual(['my-vault'])
    expect(storeState.vaults.some(v => v.id === 'example')).toBe(false)
    expect(metaStore.get('exampleVaultRemoved')).toBe(true)
  })

  it('leaves a second real vault add alone — the Tutorial vault is already gone', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    metaStore.set('exampleVaultRemoved', false)
    await restoreVaults()
    expect(getMountedVaultIds()).toContain('example')
    vi.mocked(ensureFreshAccessToken).mockResolvedValue({ status: 'ok', token: 'access-token' })

    await addGitHubVaultOAuth({
      owner: 'me', repo: 'repo', branch: 'main',
      accessToken: 'a', refreshToken: 'r', expiresAt: 1,
    })

    // Not the first real vault, so the explicit choice to keep the Tutorial
    // vault around is left alone.
    expect(getMountedVaultIds()).toContain('example')
  })
})

// ── renameVault ──────────────────────────────────────────────────────────

describe('renameVault', () => {
  it('changes the name but leaves the id, so URLs and cache keys survive', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    await restoreVaults()

    await renameVault(LOCAL_REF.id, 'Renamed Vault')

    const persisted = (metaStore.get('vaults') as VaultRef[]).find(r => r.id === LOCAL_REF.id)
    expect(persisted?.name).toBe('Renamed Vault')
    expect(persisted?.id).toBe(LOCAL_REF.id)
    expect(storeState.vaults.find(v => v.id === LOCAL_REF.id)?.name).toBe('Renamed Vault')
  })

  it('trims surrounding whitespace', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    await restoreVaults()

    await renameVault(LOCAL_REF.id, '  Renamed  ')

    expect((metaStore.get('vaults') as VaultRef[]).find(r => r.id === LOCAL_REF.id)?.name).toBe('Renamed')
  })

  it('is a no-op for a blank name', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    await restoreVaults()

    await renameVault(LOCAL_REF.id, '   ')

    expect((metaStore.get('vaults') as VaultRef[]).find(r => r.id === LOCAL_REF.id)?.name).toBe(LOCAL_REF.name)
  })

  it('is a no-op for the synthesized Tutorial vault, which is never in the persisted list', async () => {
    await restoreVaults()

    await renameVault('example', 'My Notes')

    expect(storeState.vaults.find(v => v.id === 'example')?.name).toBe('Tutorial')
  })

  it('is a no-op for an id not present in the registry', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    await restoreVaults()

    await renameVault('nope', 'Whatever')

    expect((metaStore.get('vaults') as VaultRef[])).toHaveLength(1)
  })
})

describe('newVaultId', () => {
  it('derives a readable id from the vault name', () => {
    expect(newVaultId('Notes', new Set())).toBe('notes')
    expect(newVaultId('realjohndoe/meridian', new Set())).toBe('realjohndoe-meridian')
  })

  it('uniquifies against ids already taken', () => {
    const taken = new Set(['notes'])
    expect(newVaultId('Notes', taken)).toBe('notes-2')
    expect(newVaultId('Notes', new Set([...taken, 'notes-2']))).toBe('notes-3')
  })

  it('never collides with the synthesized Tutorial vault', () => {
    // `example` is always present in the taken set (see takenVaultIds), so a
    // folder actually called "Example" cannot take the Tutorial vault's id and
    // shadow it in the vault list.
    expect(newVaultId('Example', new Set(['example']))).toBe('example-2')
  })

  it('produces a URL-safe segment for a name that is mostly punctuation', () => {
    const id = newVaultId('~/Documents/My Vault!', new Set())
    expect(id).toBe(encodeURIComponent(id))
    expect(id).not.toContain('/')
  })

  it('falls back to a usable id when the name slugifies to nothing', () => {
    // titleToSlug yields 'untitled' rather than '' — an empty id would break
    // every path that composes it (`vp(vaultId, path)`, the URL segment).
    expect(newVaultId('///', new Set())).toBe('untitled')
    expect(newVaultId('///', new Set(['untitled']))).toBe('untitled-2')
  })
})
