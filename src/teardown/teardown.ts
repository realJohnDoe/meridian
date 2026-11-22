/**
 * Retires the old GitHub Pages origin (`realjohndoe.github.io/meridian/`,
 * #1343). The last Pages deploy replaces the app with `index.html` beside this
 * file, which runs `teardown` on every visit until nothing is left to remove.
 *
 * That origin is shared with every other `realjohndoe.github.io` site, so
 * everything here is scoped to Meridian's own names: its database, its
 * `meridian_`-prefixed localStorage keys, and service workers registered under
 * its path. It never runs on the new origin, which is a different origin and so
 * holds different storage anyway.
 */

export const DB_NAME = 'meridian_v3'
const LOCAL_STORAGE_PREFIX = 'meridian_'

export interface TeardownEnv {
  indexedDB: IDBFactory
  fetch: typeof fetch
  /** The `legacy` Worker, the only one whose CORS admits the old origin. */
  workerOrigin: string
  /** `${origin}/meridian/`: service workers registered under it are ours. */
  scope: string
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>
  localStorage?: Storage
}

/**
 * `done` once the tokens are dead and the data is gone. `retry` when a token
 * could not be revoked (offline, Worker or GitHub unwell): the database is
 * then kept, so the next visit can try again rather than losing the only copy
 * of a live credential.
 */
export type TeardownResult = 'done' | 'retry'

export async function teardown(env: TeardownEnv): Promise<TeardownResult> {
  await unregisterWorkers(env)
  const creds = await readCredentials(env.indexedDB)
  if (creds) {
    const results = await Promise.all([
      ...creds.accessTokens.map(t => revoke(env, t)),
      ...creds.refreshTokens.map(t => spendRefreshToken(env, t)),
    ])
    if (results.includes(false)) return 'retry'
  }
  await deleteDatabase(env.indexedDB)
  clearLocalStorage(env.localStorage)
  return 'done'
}

async function unregisterWorkers(env: TeardownEnv): Promise<void> {
  const regs = (await env.serviceWorker?.getRegistrations()) ?? []
  await Promise.all(regs.filter(r => r.scope.startsWith(env.scope)).map(r => r.unregister()))
}

interface Credentials { accessTokens: string[]; refreshTokens: string[] }

/**
 * The `token:*` and `refreshToken:*` rows, or null when the database does not
 * exist. Opening a missing database would create it, so the upgrade that
 * creation triggers is aborted instead: a repeat visit leaves nothing behind.
 */
function readCredentials(idb: IDBFactory): Promise<Credentials | null> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME)
    req.onupgradeneeded = () => req.transaction?.abort()
    req.onerror = () => {
      if (req.error?.name === 'AbortError') resolve(null)
      else reject(req.error ?? new Error('IndexedDB open failed'))
    }
    req.onsuccess = () => {
      const db = req.result
      const done = (c: Credentials | null) => { db.close(); resolve(c) }
      if (!db.objectStoreNames.contains('meta')) { done({ accessTokens: [], refreshTokens: [] }); return }
      const all = db.transaction('meta').objectStore('meta').getAll()
      all.onerror = () => { db.close(); reject(all.error ?? new Error('IndexedDB read failed')) }
      all.onsuccess = () => {
        const rows = all.result as { key: unknown; value: unknown }[]
        const pick = (prefix: string) => [...new Set(rows
          .filter(r => typeof r.key === 'string' && r.key.startsWith(prefix) && typeof r.value === 'string' && r.value)
          .map(r => r.value as string))]
        done({ accessTokens: pick('token:'), refreshTokens: pick('refreshToken:') })
      }
    }
  })
}

const post = (env: TeardownEnv, path: string, body: Record<string, string>) =>
  env.fetch(`${env.workerOrigin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })

/** True once the access token is dead (the Worker answers 204 for revoked and already-invalid alike). */
async function revoke(env: TeardownEnv, accessToken: string): Promise<boolean> {
  try {
    return (await post(env, '/oauth/revoke', { access_token: accessToken })).status === 204
  } catch {
    return false
  }
}

/**
 * True once the refresh token can no longer be used. GitHub has no endpoint
 * that revokes a refresh token by itself, and revoking the whole authorization
 * would sign the user out on the new origin too (same GitHub App). GitHub's
 * refresh tokens are single-use, though: redeeming it kills it, and the access
 * token that comes back is revoked at once. Its successor refresh token only
 * ever exists in this function's memory.
 */
async function spendRefreshToken(env: TeardownEnv, refreshToken: string): Promise<boolean> {
  let res: Response
  let data: Record<string, unknown>
  try {
    res = await post(env, '/oauth/token', { grant_type: 'refresh_token', refresh_token: refreshToken })
    data = (await res.json()) as Record<string, unknown>
  } catch {
    return false
  }
  if (typeof data.access_token === 'string') return revoke(env, data.access_token)
  // GitHub refused it because it is already dead. Any other answer (a 5xx, a
  // rate limit, an App misconfiguration) says nothing about the token, so the
  // next visit tries again.
  return typeof data.error === 'string' && DEAD_GRANT_ERRORS.has(data.error)
}

/** As `DEAD_GRANT_ERRORS` in `storage/githubOAuth.ts`, for the refresh leg. */
const DEAD_GRANT_ERRORS = new Set(['invalid_grant', 'bad_refresh_token', 'expired_token', 'access_denied'])

function deleteDatabase(idb: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
  })
}

function clearLocalStorage(storage: Storage | undefined): void {
  if (!storage) return
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
  for (const key of keys) if (key?.startsWith(LOCAL_STORAGE_PREFIX)) storage.removeItem(key)
}
