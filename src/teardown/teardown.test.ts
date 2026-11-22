import { describe, it, expect, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DB_NAME, teardown, type TeardownEnv } from './teardown'
import { retireWorker } from './retireWorker'

const WORKER = 'https://legacy.example'
const SCOPE = 'https://old.example/meridian/'

/** A `meridian_v3` shaped like Dexie's: a `meta` store keyed by `key`. */
async function seed(idb: IDBFactory, rows: { key: string; value: unknown }[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = idb.open(DB_NAME, 10)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('meta', { keyPath: 'key' })
      req.result.createObjectStore('files', { keyPath: 'vaultPath' })
    }
    req.onerror = () => reject(req.error ?? new Error('open failed'))
    req.onsuccess = () => {
      const tx = req.result.transaction('meta', 'readwrite')
      for (const r of rows) tx.objectStore('meta').put(r)
      tx.oncomplete = () => { req.result.close(); resolve() }
    }
  })
}

const dbNames = async (idb: IDBFactory) => (await idb.databases()).map(d => d.name)

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** The legacy Worker as GitHub would answer it: refresh tokens are single-use. */
function fakeWorker() {
  const liveRefresh = new Set(['r1'])
  const revoked: string[] = []
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const body = new URLSearchParams(init?.body as string)
    if (url === `${WORKER}/oauth/revoke`) {
      revoked.push(body.get('access_token') ?? '')
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    const refresh = body.get('refresh_token') ?? ''
    if (!liveRefresh.delete(refresh)) return Promise.resolve(json({ error: 'bad_refresh_token' }))
    return Promise.resolve(json({ access_token: `fresh-from-${refresh}`, refresh_token: 'never-stored', expires_in: 28800 }))
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, revoked, liveRefresh }
}

function envWith(over: Partial<TeardownEnv>): TeardownEnv {
  return { indexedDB: new IDBFactory(), fetch: vi.fn(), workerOrigin: WORKER, scope: SCOPE, ...over }
}

describe('teardown', () => {
  it('revokes every token, spends the refresh token, then deletes the database', async () => {
    const idb = new IDBFactory()
    await seed(idb, [
      { key: 'token:a', value: 't1' },
      { key: 'token:b', value: 't1' },
      { key: 'refreshToken:a', value: 'r1' },
      { key: 'tokenExpiry:a', value: 123 },
      { key: 'vaults', value: [] },
    ])
    const worker = fakeWorker()

    expect(await teardown(envWith({ indexedDB: idb, fetch: worker.fetch }))).toBe('done')

    expect(worker.revoked.sort()).toEqual(['fresh-from-r1', 't1'])
    expect(worker.liveRefresh.size).toBe(0)
    expect(await dbNames(idb)).toEqual([])
  })

  it('keeps the database for a retry when a token could not be revoked', async () => {
    const idb = new IDBFactory()
    await seed(idb, [{ key: 'token:a', value: 't1' }])
    const fetch = vi.fn(() => Promise.reject(new TypeError('offline'))) as unknown as typeof globalThis.fetch

    expect(await teardown(envWith({ indexedDB: idb, fetch }))).toBe('retry')
    expect(await dbNames(idb)).toEqual([DB_NAME])
  })

  it.each([
    ['a 5xx', json({ error: 'server_error' }, 502)],
    ['an App misconfiguration', json({ error: 'incorrect_client_credentials' })],
    ['a non-JSON answer', new Response('<html>', { status: 200 })],
  ])('retries when the refresh leg gets %s', async (_, res) => {
    const idb = new IDBFactory()
    await seed(idb, [{ key: 'refreshToken:a', value: 'r1' }])
    const fetch = vi.fn(() => Promise.resolve(res)) as unknown as typeof globalThis.fetch

    expect(await teardown(envWith({ indexedDB: idb, fetch }))).toBe('retry')
  })

  it('treats a revoke the Worker refuses as not done', async () => {
    const idb = new IDBFactory()
    await seed(idb, [{ key: 'token:a', value: 't1' }])
    const fetch = vi.fn(() => Promise.resolve(json({ error: 'server_error' }, 502))) as unknown as typeof globalThis.fetch

    expect(await teardown(envWith({ indexedDB: idb, fetch }))).toBe('retry')
  })

  it('is a no-op on a repeat visit, and does not create the database', async () => {
    const idb = new IDBFactory()
    const fetch = vi.fn() as unknown as typeof globalThis.fetch

    expect(await teardown(envWith({ indexedDB: idb, fetch }))).toBe('done')
    expect(await teardown(envWith({ indexedDB: idb, fetch }))).toBe('done')

    expect(fetch).not.toHaveBeenCalled()
    expect(await dbNames(idb)).toEqual([])
  })

  it('deletes a database with no meta store', async () => {
    const idb = new IDBFactory()
    await new Promise<void>(resolve => {
      const req = idb.open(DB_NAME, 1)
      req.onsuccess = () => { req.result.close(); resolve() }
    })

    expect(await teardown(envWith({ indexedDB: idb }))).toBe('done')
    expect(await dbNames(idb)).toEqual([])
  })

  it('removes only Meridian’s service workers and localStorage keys', async () => {
    const ours = { scope: SCOPE, unregister: vi.fn(() => Promise.resolve(true)) }
    const sibling = { scope: 'https://old.example/other/', unregister: vi.fn(() => Promise.resolve(true)) }
    const store = new Map([['meridian_vaults', '[]'], ['meridian_color_by', 'x'], ['other_site', 'keep']])
    const localStorage = {
      get length() { return store.size },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => { store.delete(k) },
    } as Storage

    await teardown(envWith({
      serviceWorker: { getRegistrations: () => Promise.resolve([ours, sibling] as unknown as readonly ServiceWorkerRegistration[]) },
      localStorage,
    }))

    expect(ours.unregister).toHaveBeenCalled()
    expect(sibling.unregister).not.toHaveBeenCalled()
    expect([...store.keys()]).toEqual(['other_site'])
  })
})

describe('retireWorker', () => {
  it('deletes its own caches, unregisters and reloads its windows', async () => {
    const deleted: string[] = []
    const navigate = vi.fn(() => Promise.resolve(null))
    const unregister = vi.fn(() => Promise.resolve(true))

    await retireWorker({
      registration: { scope: SCOPE, unregister },
      caches: {
        keys: () => Promise.resolve([`workbox-precache-v2-${SCOPE}`, 'workbox-precache-v2-https://old.example/other/']),
        delete: (n: string) => { deleted.push(n); return Promise.resolve(true) },
      },
      clients: { matchAll: () => Promise.resolve([{ url: `${SCOPE}agenda`, navigate }]) },
    })

    expect(deleted).toEqual([`workbox-precache-v2-${SCOPE}`])
    expect(unregister).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(`${SCOPE}agenda`)
  })
})
