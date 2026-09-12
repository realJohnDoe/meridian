// @vitest-environment jsdom
/**
 * The #1006 spike: two simulated clients over one vault, driven deterministically
 * against the real storage layer.
 *
 * jsdom rather than node because `store.ts` reads `localStorage` and
 * `navigator.language` at module load. Only three things are stubbed, and each
 * for a reason that is not the code under test: `notifications` (sonner wants a
 * toast host, and the warnings are worth asserting on anyway), `githubOAuth`
 * (a token refresh is a network call), and `fetch` (the simulated remote).
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  makeClient, reloadClient, closeApp, useFixedClock, settle,
  resetWorld, registerVaults, syncClient as sync,
} from './twoClientHarness'
import type { Client, FakeGitHub } from './twoClientHarness'

const { notifyFns } = vi.hoisted(() => ({
  notifyFns: { notify: vi.fn(), warn: vi.fn(), notifyError: vi.fn(), warnWithDetails: vi.fn() },
}))
vi.mock('@/storage/notifications', () => notifyFns)
vi.mock('@/storage/githubOAuth', () => ({
  ensureFreshAccessToken: vi.fn(() => Promise.resolve({ status: 'ok', token: 'ghp_test' })),
}))

const { writeEntityToCache, deleteFromBackend } = await import('@/storage/entityWrites')
const { cacheGetRecord, cacheLoadAll } = await import('@/storage/cache/files')
const { useStore } = await import('@/store')
const { entryKey } = await import('@/fileIO')

/** A minimal entry file — enough that the real parser produces a real entry. */
function note(title: string, body: string): string {
  return `---\ntitle: ${title}\n---\n\n${body}\n`
}

let remote: FakeGitHub

// Installed once and never rewound — see `useFixedClock`'s doc comment for
// the Octokit/Bottleneck constraint that makes a per-test clock unusable.
beforeAll(() => { useFixedClock() })
afterAll(() => { vi.useRealTimers() })

beforeEach(async () => { remote = await resetWorld() })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('two-client harness — the seam itself', () => {
  it('drives the real storage layer end to end: A writes, B pulls what A wrote', async () => {
    const A = makeClient('deviceA')
    const B = makeClient('deviceB')
    registerVaults(A, B)

    await settle(writeEntityToCache(entryKey(A.vaultId, 'groceries'), note('Groceries', 'milk')))
    await sync(A)

    expect(remote.get('groceries.md')?.content).toContain('milk')

    await sync(B)
    const onB = await cacheGetRecord(B.vaultId, 'groceries.md')
    expect(onB?.content).toContain('milk')
    expect(onB?.status).toBe('clean')
    // B's store layer holds the parsed entry, not just the cache row.
    expect(useStore.getState().entries.has(entryKey(B.vaultId, 'groceries'))).toBe(true)
  })

  it('separates the two clients: each has its own _shas, sync state and rows', async () => {
    const A = makeClient('deviceA')
    const B = makeClient('deviceB')
    registerVaults(A, B)

    await settle(writeEntityToCache(entryKey(A.vaultId, 'a-only'), note('A only', 'x')))
    await sync(A)
    await sync(B)

    expect(await cacheGetRecord(A.vaultId, 'a-only.md')).toBeDefined()
    expect(await cacheGetRecord(B.vaultId, 'a-only.md')).toBeDefined()
    // Two rows, one path — the vault id is what keeps them apart.
    const all = await cacheLoadAll(A.vaultId)
    expect(all.map(r => r.vaultId)).toEqual(['deviceA'])
  })

  it('is deterministic: the same seed produces the same remote call trace', async () => {
    const trace = async () => {
      const A = makeClient('deviceA')
      registerVaults(A)
      await settle(writeEntityToCache(entryKey(A.vaultId, 'n'), note('N', 'body')))
      await sync(A)
      return remote.calls.map(c => `${c.op} ${c.path} ${c.status}`)
    }
    const first = await trace()

    // Reset and replay from the same seed.
    remote = await resetWorld()

    // Deliberately no `setSystemTime` back to T0: virtual time stays monotonic
    // (see `useFixedClock`). The trace is a sequence of operations, and that is
    // what a seed fixes — not the absolute instant it runs at.
    expect(await trace()).toEqual(first)
  })
})

// ── The #827 reproduction ─────────────────────────────────────────────
//
// #827 removed one line from `GitHubBackend.delete`:
//
//     const sha = expectedVersion ?? this._shas.get(path)
//     if (!sha) return
//
// and replaced the fallback with a fresh re-read. The scenario below is the
// one the finding named — "a file created and deleted locally before it ever
// synced" — driven from a seed rather than described. It runs twice over the
// identical interleaving: once against the reconstructed pre-#827 delete, once
// against the shipped one, so the assertion is a *difference in outcome*
// rather than a claim about code that is no longer there.

/**
 * The seed. Two devices, one vault, one slug.
 *
 *  1. Device A creates `note.md` and, before its debounced push can fire, the
 *     app closes (`closeApp` cancels the 1s timer, which is what a page
 *     teardown does to it). A's row: dirty, and — never having synced — with
 *     **no base version**, which is the precondition the `_shas` fallback
 *     needs.
 *  2. Device B independently creates a note on the same slug and pushes it.
 *     The remote now holds B's file at a sha A has never seen.
 *  3. A reopens (a new backend instance, so `_shas` is cold) and the user
 *     deletes the draft. `recordLocalDelete` carries the row's `version`
 *     forward, so the tombstone has none either.
 *  4. A syncs.
 */
async function seed827(opts: { legacyDelete: boolean }): Promise<{ A: Client; B: Client }> {
  const A0 = makeClient('deviceA')
  const B  = makeClient('deviceB')
  registerVaults(A0, B)

  // 1. A's unsynced draft. Nothing is pushed: the assertion below pins that,
  //    so the scenario cannot quietly stop being about an unsynced file.
  await settle(writeEntityToCache(entryKey(A0.vaultId, 'note'), note('A draft', 'A body')))
  closeApp(A0)
  expect(remote.has('note.md')).toBe(false)
  expect((await cacheGetRecord(A0.vaultId, 'note.md'))?.version).toBeUndefined()

  // 2. B's note, on the same slug, pushed.
  await settle(writeEntityToCache(entryKey(B.vaultId, 'note'), note('B note', 'B body')))
  await sync(B)
  expect(remote.get('note.md')?.content).toContain('B body')

  // 3. A reopens — cold `_shas` — and the user deletes the draft.
  const A = reloadClient(A0, { legacyDelete: opts.legacyDelete })
  registerVaults(A, B)
  await settle(deleteFromBackend(entryKey(A.vaultId, 'note')))
  const tombstone = await cacheGetRecord(A.vaultId, 'note.md')
  expect(tombstone?.status).toBe('deleted')
  expect(tombstone?.version).toBeUndefined()

  // 4. A syncs.
  await sync(A)
  return { A, B }
}

describe('#827 — a delete with no base version', () => {
  it('pre-#827: the delete is silently forgotten and B\'s file survives', async () => {
    await seed827({ legacyDelete: true })

    // The DELETE never went out: with no `expectedVersion` and a cold `_shas`,
    // the old code returned early...
    expect(remote.calls.filter(c => c.op === 'delete')).toHaveLength(0)
    // ...and `pushDirty` read that early return as success, so the tombstone
    // was dropped. B's file is untouched.
    expect(remote.get('note.md')?.content).toContain('B body')
  })

  it('current main: the tombstone is not ours, so B\'s file is kept', async () => {
    await seed827({ legacyDelete: false })

    // Between #827 and #1017 this was the failing case: the re-read supplied a
    // sha for a file this client had never held, the CAS passed, and B's file
    // was destroyed. `pushDirty` now compares what is at the path against what
    // the tombstone last knew was there — nothing, for a draft that never
    // synced — so no DELETE goes out at all.
    expect(remote.calls.filter(c => c.op === 'delete')).toHaveLength(0)
    expect(remote.get('note.md')?.content).toContain('B body')
    // The tombstone is dropped rather than retried, and reconcile pulls B's
    // file into A in the same cycle, so A ends the cycle holding B's note
    // rather than a tombstone that would try again next time.
    const onA = await cacheGetRecord('deviceA', 'note.md')
    expect(onA?.status).toBe('clean')
    expect(onA?.content).toContain('B body')
    expect(notifyFns.warn).toHaveBeenCalledWith(expect.stringContaining('never synced'))
  })

  // #1017's own acceptance criterion: "Afterwards the two scenarios must agree:
  // B's file survives under both the reconstructed pre-#827 delete and the
  // shipped one." They agree for different reasons — the reconstruction returns
  // early with no sha anywhere, the shipped path establishes the file is not
  // ours — and the point of asserting it is that the *outcome* no longer
  // depends on which of the two is running.
  it('the two agree: B\'s file survives either way', async () => {
    await seed827({ legacyDelete: true })
    const legacy = { deletes: remote.calls.filter(c => c.op === 'delete').length, note: remote.get('note.md')?.content }

    remote = await resetWorld()
    await seed827({ legacyDelete: false })
    const shipped = { deletes: remote.calls.filter(c => c.op === 'delete').length, note: remote.get('note.md')?.content }

    expect(shipped).toEqual(legacy)
    expect(shipped.note).toContain('B body')
  })
})

// ── Finding #3's stated mechanism, tested rather than assumed ──────────
//
// The finding #827 closed says the pre-fix `delete` "goes out with whatever
// SHA the last tree listing happened to hold, which may predate another
// device's edit, **and GitHub accepts it**". That last clause is the whole
// claim, and it is the one thing the harness can settle: `DELETE
// /repos/{o}/{r}/contents/{path}` is itself a compare-and-swap, so a sha that
// predates another device's edit is refused, not accepted.
//
// This is driven at the backend directly rather than through a sync cycle:
// the question is about one method's precondition, and a scenario that had to
// arrange a version-less tombstone as well would confound the two.
//
// Since #1017 the answer is that the backend has no business having a
// precondition of its own — see the second test.

describe('finding #3 — a stale _shas cache behind a version-less delete', () => {
  /** B's edit lands after A's last listing, so A's `_shas` predates it. */
  async function staleSeed(legacyDelete: boolean) {
    const stale = remote.seed('note.md', note('Note', 'v1 body'))
    const A = makeClient('deviceA', { legacyDelete })
    registerVaults(A)
    // A lists the tree, filling `_shas` with `stale`.
    await settle(A.backend.statAll())
    // B edits the file; the Contents API moves on, the tree listing does not.
    const B = makeClient('deviceB')
    await settle(B.backend.write('note.md', note('Note', 'v2 body'), stale))
    remote.staleTreeFor('note.md', stale)
    return A
  }

  it('pre-#827: the stale sha is refused by the DELETE\'s own CAS, not accepted', async () => {
    const A = await staleSeed(true)

    await expect(settle(A.backend.delete('note.md'))).rejects.toThrow()
    // The DELETE was sent, carrying the stale sha, and GitHub said 409.
    const del = remote.calls.filter(c => c.op === 'delete')
    expect(del).toHaveLength(1)
    expect(del[0]?.status).toBe(409)
    // B's edit survives — which is the outcome the finding said was lost.
    expect(remote.get('note.md')?.content).toContain('v2 body')
  })

  it('current main: the backend will not guess a precondition at all', async () => {
    const A = await staleSeed(false)

    // #827 replaced the stale-cache fallback with a fresh re-read, which made
    // this delete land and destroyed B's edit (#1017). Neither source was ever
    // an answer to the question that matters — *is this the file the caller
    // meant to delete?* — so the backend no longer answers it: with no
    // `expectedVersion` it does nothing, and `pushDirty` supplies one.
    await settle(A.backend.delete('note.md'))
    expect(remote.calls.filter(c => c.op === 'delete')).toHaveLength(0)
    // B's edit survives — the same outcome as the reconstruction above, which
    // is the whole of the fix.
    expect(remote.get('note.md')?.content).toContain('v2 body')
  })
})

// ── The harness carries more than one bug ─────────────────────────────

describe('two-client concurrent edits', () => {
  it('keeps both sides: the remote wins the path, the local edit lands in a conflict copy', async () => {
    const A = makeClient('deviceA')
    const B = makeClient('deviceB')
    registerVaults(A, B)

    // Both start from the same synced file.
    await settle(writeEntityToCache(entryKey(A.vaultId, 'plan'), note('Plan', 'shared start')))
    await sync(A)
    await sync(B)

    // Each edits the same ground while the other is offline.
    await settle(writeEntityToCache(entryKey(B.vaultId, 'plan'), note('Plan', "B's rewrite")))
    await sync(B)
    await settle(writeEntityToCache(entryKey(A.vaultId, 'plan'), note('Plan', "A's rewrite")))
    await sync(A)

    // The remote keeps B's content at the path...
    expect(remote.get('plan.md')?.content).toContain("B's rewrite")
    // ...and A's edit is preserved beside it rather than dropped.
    const [copy, ...rest] = remote.paths().filter(p => p !== 'plan.md')
    expect(rest).toHaveLength(0)
    expect(copy).toBeDefined()
    expect(remote.get(copy ?? '')?.content).toContain("A's rewrite")
  })
})
