/**
 * Unit tests for the vault lifecycle in vaultRegistry.ts: restoreVaults'
 * per-kind restore branching (local/github/example, permission states, the
 * error-fallback path) and setActiveVault's activation branching. This is the
 * orchestration that keeps "which vault is active" consistent across the
 * backend singleton, the store, and IndexedDB (see setActiveVaultIdentity's
 * own docs in vaultRegistry.ts).
 *
 * All collaborators are replaced with in-memory fakes so the tests don't need
 * Dexie/IndexedDB, a real FileSystemDirectoryHandle, a DOM-backed zustand
 * store, or network access to GitHub — mirroring the approach in
 * sync.test.ts. LocalBackend/GitHubBackend are mocked wholesale (rather than
 * exercised through fs.ts/githubApi.ts) purely so `ensurePermission()` is
 * directly controllable per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VaultRef } from '@/types'

const { metaStore, storeState, notifyFns, syncFns, backendConfig } = vi.hoisted(() => {
  const backendConfig: {
    localPermission: PermissionState
    githubPermission: PermissionState
    exampleReadAllError: Error | null
  } = {
    localPermission: 'granted',
    githubPermission: 'granted',
    exampleReadAllError: null,
  }
  return {
    metaStore: new Map<string, unknown>(),
    storeState: {
      items: [] as unknown[],
      roots: new Map<string, unknown>(),
      vaults: [] as VaultRef[],
      activeVaultId: null as string | null,
      pendingDirReconnect: null as string | null,
      vaultLoading: false,
      vaultLoadProgress: null as { loaded: number; total: number } | null,
    },
    notifyFns: { notify: vi.fn(), notifyError: vi.fn() },
    syncFns: {
      reconcileWithBackend: vi.fn(async () => {}),
      parseFiles: vi.fn((_files: Array<{ path: string; content: string }>) => ({ items: [], roots: new Map() })),
      updateSyncUI: vi.fn(),
      flushPendingPush: vi.fn(),
    },
    backendConfig,
  }
})

vi.mock('@/storage/cache', () => ({
  cacheInit: vi.fn(async () => {}),
  cacheLoadAll: vi.fn(async () => []),
  cacheBulkWriteClean: vi.fn(async () => {}),
  cacheDeleteAll: vi.fn(async (vaultId: string) => {
    for (const k of Array.from(metaStore.keys())) if (k.startsWith(`files:${vaultId}:`)) metaStore.delete(k)
  }),
  handleSave: vi.fn(async (id: string, h: unknown) => { metaStore.set(`handle:${id}`, h) }),
  handleLoad: vi.fn(async (id: string) => metaStore.get(`handle:${id}`) ?? null),
  handleClear: vi.fn(async (id: string) => { metaStore.delete(`handle:${id}`) }),
  tokenSave: vi.fn(async (id: string, t: string) => { metaStore.set(`token:${id}`, t) }),
  tokenClear: vi.fn(async (id: string) => { metaStore.delete(`token:${id}`) }),
  refreshTokenSave: vi.fn(async (id: string, t: string) => { metaStore.set(`refreshToken:${id}`, t) }),
  refreshTokenClear: vi.fn(async (id: string) => { metaStore.delete(`refreshToken:${id}`) }),
  tokenExpirySave: vi.fn(async (id: string, e: number) => { metaStore.set(`tokenExpiry:${id}`, e) }),
  tokenExpiryClear: vi.fn(async (id: string) => { metaStore.delete(`tokenExpiry:${id}`) }),
  vaultRefsSave: vi.fn(async (refs: VaultRef[]) => { metaStore.set('vaults', refs) }),
  vaultRefsLoad: vi.fn(async () => (metaStore.get('vaults') as VaultRef[] | undefined) ?? []),
  activeVaultIdSave: vi.fn(async (id: string | null) => {
    if (id === null) metaStore.delete('activeVaultId')
    else metaStore.set('activeVaultId', id)
  }),
  activeVaultIdLoad: vi.fn(async () => (metaStore.get('activeVaultId') as string | undefined) ?? null),
}))

vi.mock('@/storage/fs', () => ({ diskPickDirectory: vi.fn() }))

vi.mock('@/storage/localBackend', () => ({
  LocalBackend: class {
    readonly kind = 'local'
    readonly readOnly = false
    constructor(public id: string, public name: string, public handle: unknown) {}
    async ensurePermission(_interactive: boolean): Promise<PermissionState> { return backendConfig.localPermission }
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
    constructor(public id: string, public name: string, public cfg: unknown) {}
    async ensurePermission(_interactive: boolean): Promise<PermissionState> { return backendConfig.githubPermission }
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
    async ensurePermission(): Promise<PermissionState> { return 'granted' }
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
  setData: vi.fn((d: { items: unknown[]; roots: Map<string, unknown> }) => {
    storeState.items = d.items
    storeState.roots = d.roots
  }),
  getVaults: vi.fn(() => storeState.vaults),
  setVaultList: vi.fn((refs: VaultRef[]) => { storeState.vaults = refs }),
  setActiveVaultId: vi.fn((id: string | null) => { storeState.activeVaultId = id }),
  setPendingReconnect: vi.fn((name: string | null) => { storeState.pendingDirReconnect = name }),
  setVaultLoading: vi.fn((loading: boolean) => { storeState.vaultLoading = loading }),
  setVaultLoadProgress: vi.fn((p: { loaded: number; total: number } | null) => { storeState.vaultLoadProgress = p }),
}))

vi.mock('@/storage/notifications', () => notifyFns)

vi.mock('@/storage/sync', () => syncFns)

// Imports of the module under test (and its non-mocked collaborators — the
// trivial in-memory activeBackend singleton) must come after the vi.mock calls.
import { restoreVaults, setActiveVault, removeVault } from '@/storage/vaultRegistry'
import { getActiveBackend, setActiveBackend } from '@/storage/activeBackend'
import { ensureFreshAccessToken } from '@/storage/githubOAuth'

const LOCAL_REF: VaultRef = { id: 'local-1', name: 'My Vault', kind: 'local' }
const GITHUB_REF: VaultRef = { id: 'gh-1', name: 'me/repo', kind: 'github', github: { owner: 'me', repo: 'repo', branch: 'main' } }

beforeEach(() => {
  metaStore.clear()
  storeState.items = []
  storeState.roots = new Map()
  storeState.vaults = []
  storeState.activeVaultId = null
  storeState.pendingDirReconnect = null
  storeState.vaultLoading = false
  storeState.vaultLoadProgress = null
  notifyFns.notify.mockClear()
  notifyFns.notifyError.mockClear()
  syncFns.reconcileWithBackend.mockClear()
  syncFns.parseFiles.mockClear()
  syncFns.updateSyncUI.mockClear()
  syncFns.flushPendingPush.mockClear()
  backendConfig.localPermission = 'granted'
  backendConfig.githubPermission = 'granted'
  backendConfig.exampleReadAllError = null
  vi.mocked(ensureFreshAccessToken).mockReset()
  setActiveBackend(null)
})

// ── restoreVaults — no saved vault ──────────────────────────────────────

describe('restoreVaults — nothing saved', () => {
  it('activates the example vault by default', async () => {
    await restoreVaults()

    expect(storeState.activeVaultId).toBe('example')
    expect(metaStore.get('activeVaultId')).toBe('example')
    expect(storeState.vaultLoading).toBe(false) // reset in the outer finally
  })
})

// ── restoreVaults — local vault ──────────────────────────────────────────

describe('restoreVaults — local vault', () => {
  beforeEach(async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set('activeVaultId', LOCAL_REF.id)
  })

  it('falls back to example when the directory handle was never saved', async () => {
    await restoreVaults()

    expect(storeState.activeVaultId).toBe('example')
    expect(syncFns.reconcileWithBackend).not.toHaveBeenCalled()
  })

  it('activates the vault as writable when permission is already granted', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'granted'

    await restoreVaults()

    expect(storeState.activeVaultId).toBe(LOCAL_REF.id)
    expect(metaStore.get('activeVaultId')).toBe(LOCAL_REF.id)
    expect(syncFns.reconcileWithBackend).toHaveBeenCalledTimes(1)
    expect(syncFns.flushPendingPush).toHaveBeenCalledTimes(1)
  })

  it('marks a pending reconnect (without reconciling) when permission needs a user gesture', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'prompt'

    await restoreVaults()

    expect(storeState.activeVaultId).toBe(LOCAL_REF.id)
    expect(storeState.pendingDirReconnect).toBe(LOCAL_REF.name)
    // Persisted even on the "prompt" path — persist:false is only for the
    // error-fallback path, not for this one.
    expect(metaStore.get('activeVaultId')).toBe(LOCAL_REF.id)
    expect(syncFns.reconcileWithBackend).not.toHaveBeenCalled()
    expect(syncFns.updateSyncUI).toHaveBeenCalledTimes(1)
  })

  it('falls back to example when permission is denied outright', async () => {
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    backendConfig.localPermission = 'denied'

    await restoreVaults()

    expect(storeState.activeVaultId).toBe('example')
  })
})

// ── restoreVaults — github vault ─────────────────────────────────────────

describe('restoreVaults — github vault', () => {
  beforeEach(() => {
    metaStore.set('vaults', [GITHUB_REF])
    metaStore.set('activeVaultId', GITHUB_REF.id)
  })

  it('falls back to example when no usable token can be produced', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue(null)

    await restoreVaults()

    expect(storeState.activeVaultId).toBe('example')
  })

  it('activates the vault as writable when the token is usable and permission is granted', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue('access-token')
    backendConfig.githubPermission = 'granted'

    await restoreVaults()

    expect(storeState.activeVaultId).toBe(GITHUB_REF.id)
    expect(syncFns.reconcileWithBackend).toHaveBeenCalledTimes(1)
  })

  it('notifies and falls back to example when permission is not granted', async () => {
    vi.mocked(ensureFreshAccessToken).mockResolvedValue('access-token')
    backendConfig.githubPermission = 'denied'

    await restoreVaults()

    expect(notifyFns.notify).toHaveBeenCalledTimes(1)
    expect(notifyFns.notify.mock.calls[0][0]).toContain(GITHUB_REF.name)
    expect(storeState.activeVaultId).toBe('example')
  })
})

// ── restoreVaults — error-fallback path ──────────────────────────────────

describe('restoreVaults — unexpected failure', () => {
  it('recovers via fallbackToExample without persisting the example id, so a retry is still possible next reload', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set('activeVaultId', LOCAL_REF.id)
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    // ensurePermission throwing simulates any unexpected failure mid-restore.
    backendConfig.localPermission = 'granted'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { LocalBackend } = await import('@/storage/localBackend')
    const permSpy = vi.spyOn(LocalBackend.prototype, 'ensurePermission').mockRejectedValue(new Error('disk error'))

    await restoreVaults()

    expect(storeState.activeVaultId).toBe('example')
    // persist:false — the saved activeVaultId (still LOCAL_REF.id) is left
    // alone so the next reload retries the real vault instead of being stuck
    // on the example vault forever.
    expect(metaStore.get('activeVaultId')).toBe(LOCAL_REF.id)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    permSpy.mockRestore()
  })

  it('still clears vaultLoading even when the fallback itself throws', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set('activeVaultId', LOCAL_REF.id)
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { LocalBackend } = await import('@/storage/localBackend')
    const permSpy = vi.spyOn(LocalBackend.prototype, 'ensurePermission').mockRejectedValue(new Error('disk error'))
    backendConfig.exampleReadAllError = new Error('example vault broken too')

    await expect(restoreVaults()).resolves.toBeUndefined()

    expect(storeState.vaultLoading).toBe(false)
    spy.mockRestore()
    permSpy.mockRestore()
  })
})

// ── setActiveVault ────────────────────────────────────────────────────────

describe('setActiveVault', () => {
  it('activates the example vault directly for id "example"', async () => {
    await setActiveVault('example')

    expect(storeState.activeVaultId).toBe('example')
  })

  it('is a no-op when the id is not in the known vault list', async () => {
    storeState.vaults = [LOCAL_REF]

    await setActiveVault('does-not-exist')

    expect(storeState.activeVaultId).toBeNull()
    expect(notifyFns.notify).not.toHaveBeenCalled()
  })

  describe('local vault', () => {
    beforeEach(() => { storeState.vaults = [LOCAL_REF] })

    it('notifies without activating when the handle is missing', async () => {
      await setActiveVault(LOCAL_REF.id)

      expect(notifyFns.notify).toHaveBeenCalledWith(expect.stringContaining('Vault handle not found'))
      expect(storeState.activeVaultId).toBeNull()
    })

    it('notifies without activating when permission is denied', async () => {
      metaStore.set(`handle:${LOCAL_REF.id}`, {})
      backendConfig.localPermission = 'denied'

      await setActiveVault(LOCAL_REF.id)

      expect(notifyFns.notify).toHaveBeenCalledWith(expect.stringContaining(LOCAL_REF.name))
      expect(storeState.activeVaultId).toBeNull()
    })

    it('activates as writable when permission is granted', async () => {
      metaStore.set(`handle:${LOCAL_REF.id}`, {})
      backendConfig.localPermission = 'granted'

      await setActiveVault(LOCAL_REF.id)

      expect(storeState.activeVaultId).toBe(LOCAL_REF.id)
      expect(syncFns.reconcileWithBackend).toHaveBeenCalledTimes(1)
    })
  })

  describe('github vault', () => {
    beforeEach(() => { storeState.vaults = [GITHUB_REF] })

    it('notifies without activating when no token can be produced', async () => {
      vi.mocked(ensureFreshAccessToken).mockResolvedValue(null)

      await setActiveVault(GITHUB_REF.id)

      expect(notifyFns.notify).toHaveBeenCalledWith(expect.stringContaining('GitHub token not found'))
      expect(storeState.activeVaultId).toBeNull()
    })

    it('notifies without activating when permission is denied', async () => {
      vi.mocked(ensureFreshAccessToken).mockResolvedValue('access-token')
      backendConfig.githubPermission = 'denied'

      await setActiveVault(GITHUB_REF.id)

      expect(notifyFns.notify).toHaveBeenCalledWith(expect.stringContaining(GITHUB_REF.name))
      expect(storeState.activeVaultId).toBeNull()
    })

    it('activates as writable when the token and permission both check out', async () => {
      vi.mocked(ensureFreshAccessToken).mockResolvedValue('access-token')
      backendConfig.githubPermission = 'granted'

      await setActiveVault(GITHUB_REF.id)

      expect(storeState.activeVaultId).toBe(GITHUB_REF.id)
      expect(syncFns.reconcileWithBackend).toHaveBeenCalledTimes(1)
    })
  })

  it('silently ignores an AbortError (e.g. a directory-picker style cancel)', async () => {
    storeState.vaults = [LOCAL_REF]
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    const { LocalBackend } = await import('@/storage/localBackend')
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const permSpy = vi.spyOn(LocalBackend.prototype, 'ensurePermission').mockRejectedValue(abortError)

    await expect(setActiveVault(LOCAL_REF.id)).resolves.toBeUndefined()

    expect(notifyFns.notify).not.toHaveBeenCalled()
    expect(notifyFns.notifyError).not.toHaveBeenCalled()
    permSpy.mockRestore()
  })

  it('surfaces any other unexpected error via notifyError', async () => {
    storeState.vaults = [LOCAL_REF]
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    const { LocalBackend } = await import('@/storage/localBackend')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const permSpy = vi.spyOn(LocalBackend.prototype, 'ensurePermission').mockRejectedValue(new Error('disk error'))

    await setActiveVault(LOCAL_REF.id)

    expect(notifyFns.notifyError).toHaveBeenCalledTimes(1)
    expect(notifyFns.notifyError.mock.calls[0][0]).toBe('Could not switch vault')
    spy.mockRestore()
    permSpy.mockRestore()
  })
})

// ── removeVault ───────────────────────────────────────────────────────────

describe('removeVault', () => {
  it('switches to the example vault before removing the currently-active vault from the registry', async () => {
    metaStore.set('vaults', [LOCAL_REF])
    metaStore.set(`handle:${LOCAL_REF.id}`, {})
    setActiveBackend({ id: LOCAL_REF.id, name: LOCAL_REF.name, kind: 'local', readOnly: false } as never)

    await removeVault(LOCAL_REF.id)

    expect(storeState.activeVaultId).toBe('example')
    expect(metaStore.get(`handle:${LOCAL_REF.id}`)).toBeUndefined()
    expect((metaStore.get('vaults') as VaultRef[]).find(r => r.id === LOCAL_REF.id)).toBeUndefined()
  })

  it('clears github credentials and leaves the active vault alone when removing an inactive vault', async () => {
    metaStore.set('vaults', [LOCAL_REF, GITHUB_REF])
    metaStore.set(`token:${GITHUB_REF.id}`, 't')
    metaStore.set(`refreshToken:${GITHUB_REF.id}`, 'r')
    metaStore.set(`tokenExpiry:${GITHUB_REF.id}`, 123)
    setActiveBackend({ id: LOCAL_REF.id, name: LOCAL_REF.name, kind: 'local', readOnly: false } as never)

    await removeVault(GITHUB_REF.id)

    expect(getActiveBackend()?.id).toBe(LOCAL_REF.id) // untouched
    expect(metaStore.get(`token:${GITHUB_REF.id}`)).toBeUndefined()
    expect(metaStore.get(`refreshToken:${GITHUB_REF.id}`)).toBeUndefined()
    expect(metaStore.get(`tokenExpiry:${GITHUB_REF.id}`)).toBeUndefined()
    expect((metaStore.get('vaults') as VaultRef[]).map(r => r.id)).toEqual([LOCAL_REF.id])
  })

  it('is a no-op for an id not present in the registry', async () => {
    metaStore.set('vaults', [LOCAL_REF])

    await removeVault('does-not-exist')

    expect((metaStore.get('vaults') as VaultRef[]).map(r => r.id)).toEqual([LOCAL_REF.id])
    expect(notifyFns.notifyError).not.toHaveBeenCalled()
  })
})
