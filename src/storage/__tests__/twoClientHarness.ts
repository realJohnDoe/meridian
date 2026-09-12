/**
 * A deterministic two-client harness over the **real** storage layer — the
 * spike for #1006.
 *
 * Every existing sync suite tests one client, and the two that come closest to
 * an interleaving reimplement the code they are testing: `sync-collision.test.ts`
 * says so in its own comment ("Lightweight CAS harness (mirrors pushDirty
 * logic)"), and `sync.test.ts` replaces `cache/files`, `storeBridge` and
 * `notifications` with in-memory fakes. Neither can express "two devices, one
 * vault, in this order", which is the shape of all 16 lost-write defects.
 *
 * What is real here: `GitHubBackend` (including its private `_shas` cache, the
 * thing #827 was about), `sync.ts`'s `pushDirty`/`reconcileWithBackend`,
 * `syncScheduler.ts`'s debounce, `cache/files.ts` over real Dexie on
 * `fake-indexeddb`, and the Zustand store. What is simulated: the GitHub REST
 * API (`FakeGitHub` below) and the clock.
 *
 * **How two clients share one process.** The storage layer's module state —
 * the backend registry, the per-vault sync state, the Dexie rows, the store
 * layers — is keyed by *vault id*, not global. So two clients are two vault
 * ids pointed at one `FakeGitHub` repo, and every piece of per-client state
 * separates on its own with nothing stubbed out. That is the finding the spike
 * was after: no module had to be re-entrant for this to work.
 *
 * The alternative — one vault id and two module graphs via `vi.resetModules()`
 * — does not work, and `cache.test.ts`'s header says why: `resetModules()`
 * doesn't re-evaluate externalised node_modules, so both graphs keep the one
 * `dexie` that was loaded first.
 */
import { vi } from 'vitest'
import { GitHubBackend } from '@/storage/githubBackend'
import type { StorageBackend, RawFile, PermissionOutcome } from '@/storage/backend'
import { encodeBase64 } from '@/storage/githubApi'
import { mountBackend } from '@/storage/backends'
import { syncStateFor, dropSyncState, dropAllSyncState } from '@/storage/syncState'
import { unmountAllBackends } from '@/storage/backends'
import { cacheInit } from '@/storage/cache/db'
import { syncToBackend } from '@/storage/syncScheduler'
import { useStore } from '@/store'
import type { VaultRef } from '@/vaultRef'

/** Fixed epoch every seeded run starts from, so `updatedAt` and the journal are reproducible. */
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0)

const OWNER = 'alice'
const REPO  = 'notes'
const BRANCH = 'main'

// ── The simulated remote ──────────────────────────────────────────────

interface RemoteFile { content: string; sha: string }

/** One request the harness answered — the trace a failing seed is read from. */
export interface RemoteCall {
  method: string
  /** `trees`, `read`, `write` or `delete` — the operation, not the raw URL. */
  op:     'trees' | 'read' | 'write' | 'delete'
  path:   string
  status: number
  /** The CAS precondition the client sent, when it sent one. */
  sha?:   string
}

/**
 * One GitHub repo, shared by every client, with GitHub's own consistency
 * model where it matters:
 *
 *  - **The Contents API is read-your-writes.** `GET`, `PUT` and `DELETE`
 *    always see the current state.
 *  - **The git-trees listing is eventually consistent.** `statAll` reads it,
 *    and `staleTreeFor` makes it serve a named older snapshot — this is what
 *    a client's `_shas` cache is populated from, and the reason `write()`
 *    documents that it must not be trusted.
 *  - **`PUT`/`DELETE` are compare-and-swap.** A mismatched `sha` is a 409, an
 *    absent `sha` on an existing path is a 422, and a `DELETE` of a path that
 *    is already gone is a 404. This is not a convenience: whether GitHub
 *    enforces the precondition on `DELETE` is exactly what finding #3 turns
 *    on, so it is modelled rather than assumed away.
 *
 * SHAs are minted from a counter, never a clock or a random — a seed replays
 * byte-for-byte.
 */
export class FakeGitHub {
  private _files = new Map<string, RemoteFile>()
  private _shaCounter = 0
  /**
   * Every `(sha -> path, content)` this repo has ever minted.
   *
   * GitHub's blob SHAs are content-addressed and immortal, so this is a
   * faithful model rather than a testing convenience — and it is what lets an
   * assertion ask the one question a live remote cannot answer after the fact:
   * *did the remote ever hold this content at this version?* A cache record
   * stamped clean against a version the remote never had at that content is
   * the shape of #520 and #738, and only a history can catch it.
   */
  private _history = new Map<string, { path: string; content: string }>()
  /** Paths whose tree listing is pinned to an older sha — see `staleTreeFor`. */
  private _staleTree = new Map<string, string>()
  readonly calls: RemoteCall[] = []

  /** Put a file there with no client involved — the state a scenario starts from. */
  seed(path: string, content: string): string {
    const sha = this._mintSha()
    this._files.set(path, { content, sha })
    this._history.set(sha, { path, content })
    return sha
  }

  /** What this repo held at `sha`, or `undefined` if it never minted one. */
  contentAtVersion(sha: string): { path: string; content: string } | undefined {
    return this._history.get(sha)
  }

  get(path: string): RemoteFile | undefined { return this._files.get(path) }
  has(path: string): boolean { return this._files.has(path) }
  paths(): string[] { return [...this._files.keys()].sort() }

  /**
   * Make the **tree listing** report `sha` for `path`, while the Contents API
   * keeps answering the truth. This is GitHub's eventual consistency, and it
   * is the only way a client's `_shas` cache can hold something the remote has
   * moved past.
   */
  staleTreeFor(path: string, sha: string): void { this._staleTree.set(path, sha) }
  clearStaleTree(): void { this._staleTree.clear() }

  private _mintSha(): string { return `sha${++this._shaCounter}` }

  /** The `fetch` implementation to stub in. */
  handler = (url: string, init?: RequestInit): Promise<unknown> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const u = new URL(url)
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}

    if (u.pathname.includes('/git/trees/')) return this._trees()
    const m = /\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(u.pathname)
    const path = m?.[1] ? decodeURIComponent(m[1]) : ''
    if (method === 'GET')    return this._read(path)
    if (method === 'PUT')    return this._write(path, body)
    if (method === 'DELETE') return this._delete(path, body)
    return Promise.resolve(resp({ message: 'Not Found' }, 404))
  }

  private _record(op: RemoteCall['op'], method: string, path: string, status: number, sha?: string): void {
    this.calls.push({ op, method, path, status, ...(sha !== undefined ? { sha } : {}) })
  }

  private _trees(): Promise<unknown> {
    const tree = [...this._files.entries()].map(([path, f]) => ({
      type: 'blob', path, sha: this._staleTree.get(path) ?? f.sha,
    }))
    this._record('trees', 'GET', '', 200)
    return Promise.resolve(resp({ tree, truncated: false }, 200))
  }

  private _read(path: string): Promise<unknown> {
    const f = this._files.get(path)
    if (!f) {
      this._record('read', 'GET', path, 404)
      return Promise.resolve(resp({ message: 'Not Found' }, 404))
    }
    this._record('read', 'GET', path, 200)
    return Promise.resolve(resp(
      { type: 'file', name: path, sha: f.sha, path, content: encodeBase64(f.content) }, 200,
    ))
  }

  private _write(path: string, body: Record<string, unknown>): Promise<unknown> {
    const sent = body.sha as string | undefined
    const existing = this._files.get(path)
    // No sha means "create": GitHub answers 422 when the path already exists.
    if (sent === undefined && existing) {
      this._record('write', 'PUT', path, 422, sent)
      return Promise.resolve(resp({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }, 422))
    }
    if (sent !== undefined && existing?.sha !== sent) {
      this._record('write', 'PUT', path, 409, sent)
      return Promise.resolve(resp({ message: 'is at ' + (existing?.sha ?? 'nothing') + ' but expected ' + sent }, 409))
    }
    const sha = this._mintSha()
    const content = decodeBody(body)
    this._files.set(path, { content, sha })
    this._history.set(sha, { path, content })
    this._staleTree.delete(path)
    this._record('write', 'PUT', path, 200, sent)
    return Promise.resolve(resp({ content: { sha } }, 200))
  }

  private _delete(path: string, body: Record<string, unknown>): Promise<unknown> {
    const sent = body.sha as string | undefined
    const existing = this._files.get(path)
    if (!existing) {
      this._record('delete', 'DELETE', path, 404, sent)
      return Promise.resolve(resp({ message: 'Not Found' }, 404))
    }
    if (existing.sha !== sent) {
      this._record('delete', 'DELETE', path, 409, sent)
      return Promise.resolve(resp({ message: 'is at ' + existing.sha + ' but expected ' + String(sent) }, 409))
    }
    this._files.delete(path)
    this._staleTree.delete(path)
    this._record('delete', 'DELETE', path, 200, sent)
    return Promise.resolve(resp({}, 200))
  }
}

function decodeBody(body: Record<string, unknown>): string {
  const b64 = typeof body.content === 'string' ? body.content : ''
  return Buffer.from(b64, 'base64').toString('utf8')
}

/** Octokit iterates the response headers, so these must be a real `Headers`. */
function resp(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

// ── The pre-#827 delete, reconstructed ────────────────────────────────

/**
 * `GitHubBackend` with the one line #827 removed put back:
 *
 * ```ts
 * const sha = expectedVersion ?? this._shas.get(path)
 * if (!sha) return // File doesn't exist on GitHub; nothing to do
 * ```
 *
 * The shadow `_shas` is populated exactly where the real one is — from
 * `statAll`'s tree listing, from `readFiles`, and from the sha a `write`
 * returns — so the reconstruction differs from the shipped code only in the
 * fallback. Delegating to `inner.delete(path, sha)` with a defined sha reaches
 * the same CAS `DELETE` the real one would, skipping only the re-read the fix
 * added.
 *
 * A spike that "reproduces" a fixed bug against the fixed code proves nothing,
 * so the same seeded scenario runs against both this and the real backend and
 * the two outcomes are compared. That comparison is the test.
 */
function withLegacyDelete(inner: GitHubBackend): StorageBackend {
  const shas = new Map<string, string>()
  return {
    get id()        { return inner.id },
    get name()      { return inner.name },
    kind:      'github',
    readOnly:  false,
    hasRemote: true,
    async statAll(): Promise<Map<string, string>> {
      const tokens = await inner.statAll()
      for (const [p, sha] of tokens) shas.set(p, sha)
      return tokens
    },
    async readFiles(paths: string[]): Promise<RawFile[]> {
      const files = await inner.readFiles(paths)
      for (const f of files) shas.set(f.path, f.version)
      return files
    },
    async readAll(onProgress?: (loaded: number, total: number) => void): Promise<RawFile[]> {
      const files = await inner.readAll(onProgress)
      for (const f of files) shas.set(f.path, f.version)
      return files
    },
    async write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> {
      const sha = await inner.write(path, content, expectedVersion)
      if (sha) shas.set(path, sha)
      return sha
    },
    async delete(path: string, expectedVersion?: string): Promise<void> {
      const sha = expectedVersion ?? shas.get(path)
      if (!sha) return // pre-#827: no sha anywhere, so assume the file isn't there
      await inner.delete(path, sha)
      shas.delete(path)
    },
    ensurePermission(interactive: boolean): Promise<PermissionOutcome> {
      return inner.ensurePermission(interactive)
    },
  }
}

// ── Clients ───────────────────────────────────────────────────────────

export interface Client {
  vaultId: string
  backend: StorageBackend
  ref:     VaultRef
}

/**
 * One simulated device: its own `GitHubBackend` instance (and so its own
 * `_shas`, `_treeEtag` and Octokit), its own Dexie rows, its own sync state
 * and its own store layer — all separated by the vault id alone.
 *
 * `legacyDelete` swaps in the pre-#827 `delete`; everything else stays real.
 */
export function makeClient(vaultId: string, opts: { legacyDelete?: boolean } = {}): Client {
  const real = new GitHubBackend(vaultId, `${OWNER}/${REPO}`, {
    owner: OWNER, repo: REPO, branch: BRANCH, token: 'ghp_test',
  })
  const backend = opts.legacyDelete ? withLegacyDelete(real) : real
  mountBackend(backend)
  const ref: VaultRef = {
    id: vaultId, name: vaultId, kind: 'github',
    github: { owner: OWNER, repo: REPO, branch: BRANCH },
  }
  return { vaultId, backend, ref }
}

/**
 * The app closes: cancel this vault's armed debounce and forget its cycle
 * state, leaving the Dexie rows exactly where they are.
 *
 * The step a scenario needs whenever an edit is meant *not* to reach the
 * remote. `scheduleAutoPush` arms a 1s timer on every write, and the harness's
 * pump crosses a second on its way through any later step, so "A edited and
 * did not sync" is only true if something cancels that timer — which is what
 * closing the page does, and why the outcome is a draft still sitting dirty in
 * the cache on next launch.
 */
export function closeApp(client: Client): void {
  dropSyncState(client.vaultId)
}

/**
 * Simulate the device being closed and reopened: a brand-new `GitHubBackend`
 * for the same vault id, so `_shas` and the tree ETag start cold while the
 * Dexie rows survive — which is what they do across a page load, and the
 * precondition #827's `delete` fallback needs to be reachable at all.
 *
 * `dropSyncState` is what makes it a *reload* rather than a second backend
 * beside the first: the debounced push armed by the last edit lives in that
 * record, and a page that closed before its 1s timer fired did not push. Left
 * armed, it fires the moment the pump advances past a second — into some later
 * step of the scenario, which is precisely the nondeterminism the harness is
 * for removing.
 */
export function reloadClient(client: Client, opts: { legacyDelete?: boolean } = {}): Client {
  dropSyncState(client.vaultId)
  return makeClient(client.vaultId, opts)
}

/**
 * Install the fake clock — **once per file, in `beforeAll`, and never rewound.**
 *
 * `Date` and the timer family only: `fake-indexeddb` drives its transactions
 * off the microtask queue, which must stay real.
 *
 * The "never rewound" half is not a style preference, and it cost most of the
 * spike's debugging budget. `@octokit/plugin-throttling` keeps its Bottleneck
 * groups in a **module-level** `var groups = {}` and builds them exactly once
 * per process (`if (groups.global == null)`), so every `GitHubBackend` in the
 * process — every simulated client, in every test in the file — shares one
 * write limiter. That limiter remembers `_nextRequest = Date.now() + minTime`
 * against whatever clock was installed when it last ran. Reinstalling a fake
 * clock back at `T0` in the next test therefore leaves it holding a deadline
 * far in the future: the next request waits, and at ~2 minutes Bottleneck's
 * own job timeout drops it. `readFiles` swallows that as "the file isn't
 * there", so the failure surfaces as a *silently skipped delete* — a wrong
 * answer, not an error.
 *
 * Keeping virtual time monotonic across the file keeps that deadline in the
 * past, where it belongs. Determinism is unaffected: a seed is a fixed
 * sequence of operations and a fixed step size, not a fixed absolute instant.
 */
export function useFixedClock(): void {
  vi.useFakeTimers({
    now: T0,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
}

/** How far virtual time moves per pump step. Small enough that a 1s Bottleneck
 *  gap takes several observable steps, large enough that a sync cycle settles
 *  in tens of iterations rather than thousands. */
const PUMP_STEP_MS = 25
const PUMP_LIMIT = 4000

/**
 * Await `p` while driving the virtual clock forward — the "owned scheduler"
 * half of the harness.
 *
 * Needed because the storage layer is not the only thing on the timer queue.
 * Octokit's throttling plugin puts every request through a Bottleneck limiter
 * whose write group is spaced `minTime: 1000` apart, and Bottleneck schedules
 * even its first job through `setTimeout`. Under a frozen clock those timers
 * never fire and the request never leaves, so a fake clock cannot simply be
 * installed and left alone: something has to advance it, and advancing it a
 * fixed step at a time is what keeps a seed reproducible.
 *
 * Stepping rather than `runAllTimersAsync` on purpose: the debounced push
 * re-arms a timer from inside its own callback, which `runAllTimers` chases
 * until it gives up.
 */
export async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false
  // Read through a function: assigning `done` only inside the callbacks below
  // leaves narrowing convinced it is still `false` at the loop condition.
  const settled = () => done
  const tracked = p.then(
    v => { done = true; return v },
    (e: unknown) => { done = true; throw e },
  )
  // Swallow here so a rejection doesn't go unhandled while the pump runs; the
  // caller still sees it when it awaits the returned promise.
  tracked.catch(() => {})
  for (let i = 0; i < PUMP_LIMIT && !settled(); i++) {
    await vi.advanceTimersByTimeAsync(PUMP_STEP_MS)
  }
  return tracked
}

/**
 * Advance the clock until no vault has a cycle running, a debounced push
 * armed, or a push queued behind an in-flight cycle — the other half of owning
 * the scheduler.
 *
 * `settle` alone is not enough. A sync cycle can outlast the call that started
 * it: `writeEntityToCache` arms `scheduleAutoPush`'s 1s debounce, and the pump
 * has to cross a full second anyway for Octokit's write limiter, so the
 * debounce fires *during* some later `settle` and starts a second cycle that
 * nothing awaits. The next explicit sync then bounces off `runSync`'s
 * `if (syncing) return` and silently does nothing — which reads, at the
 * assertion, as a push that was never attempted.
 *
 * Draining to idle after every step makes each step's effects complete before
 * the next one is set up, which is what "deterministic" has to mean here.
 */
export async function quiesce(vaultIds: readonly string[]): Promise<void> {
  const busy = () => vaultIds.some(id => {
    const s = syncStateFor(id)
    return s.syncing || s.pushTimer !== null || s.pushQueued
  })
  for (let i = 0; i < PUMP_LIMIT && busy(); i++) {
    await vi.advanceTimersByTimeAsync(PUMP_STEP_MS)
  }
  if (busy()) throw new Error('quiesce: a vault never returned to idle')
}

/**
 * Jump virtual time forward by `ms` in one go, firing everything scheduled in
 * between, then drain to idle.
 *
 * Two of the sync layer's own rules are stated in minutes, and no pump built
 * out of `PUMP_STEP_MS` will ever reach them: `RECONCILE_DELETE_GRACE_MS` (5
 * minutes) makes reconcile ignore a listing's silence about a recently-written
 * file, so a file deleted on the other device *legitimately* lingers in this
 * one's cache until the window passes. An assertion that two settled clients
 * agree is therefore only meaningful on the far side of it.
 *
 * Jumping forward is safe where rewinding is not — see `useFixedClock`. The
 * Bottleneck deadline this is guarding against sits in the *past* and only
 * gets further into the past from here.
 */
export async function skipAhead(ms: number, vaultIds: readonly string[]): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await quiesce(vaultIds)
}

// ── Per-seed setup ────────────────────────────────────────────────────

/**
 * Put the world back to "no vaults, no rows, an empty repo" — everything a
 * seed needs done before it runs, and nothing that would rewind the clock.
 *
 * Every piece of this is module state that outlives a test the way it outlives
 * a page's vaults, so none of it goes away on its own: the backend registry,
 * the per-vault sync records (a debounce left armed by the previous seed fires
 * into this one the moment the pump advances), the store, and the shared Dexie
 * — whose rows are keyed by vault id, so isolation between *clients* is real
 * while isolation between *seeds* is not.
 *
 * Deliberately no `setSystemTime`: virtual time stays monotonic across the
 * file (see `useFixedClock`). A seed is a fixed sequence of operations, not a
 * fixed instant.
 */
export async function resetWorld(): Promise<FakeGitHub> {
  const remote = new FakeGitHub()
  vi.stubGlobal('fetch', vi.fn(remote.handler))
  unmountAllBackends()
  dropAllSyncState()
  useStore.setState({ vaults: [], entries: new Map() })
  const db = await cacheInit()
  await db.files.clear()
  await db.meta.clear()
  return remote
}

/**
 * Register these clients' vaults in the store. `writeTarget` refuses a write
 * to a vault the registry has never heard of, which is never what a seed is
 * testing.
 */
export function registerVaults(...clients: Client[]): void {
  useStore.setState({ vaults: clients.map(c => c.ref) })
}

/**
 * Run one full sync cycle for `client`, then drain **every** registered vault
 * back to idle — see `quiesce`, without which a debounced push fired by the
 * pump runs concurrently with the next step.
 */
export async function syncClient(client: Client): Promise<void> {
  await settle(syncToBackend(client.vaultId))
  await quiesce(useStore.getState().vaults.map(v => v.id))
}
