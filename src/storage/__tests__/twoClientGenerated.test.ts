// @vitest-environment jsdom
/**
 * The six sync invariants, asserted over generated interleavings (#1021).
 *
 * The companion to `twoClient.test.ts`: that file is eight hand-written
 * scenarios each asserting its own specific outcome, which is the shape #1003
 * was in before it got a generator. This one states the *properties* those
 * scenarios are instances of and generates the interleavings to try them
 * against — see `interleavings.ts` for the generator and `syncInvariants.ts`
 * for the six and where they were derived from.
 *
 * jsdom, and the same three stubs, for the same reasons as `twoClient.test.ts`.
 *
 * ## CI and the soak
 *
 * Same split as #1003. CI runs a **pinned seed and a modest run count**, so a
 * red build always reproduces from the sequence fast-check prints. Roaming for
 * new failures is a local/nightly exercise:
 *
 * ```
 * MERIDIAN_SOAK=1 pnpm exec vitest run src/storage/__tests__/twoClientGenerated.test.ts
 * ```
 *
 * which drops the seed (fast-check picks a fresh one and prints it on failure,
 * so any find stays reproducible) and raises the run count and the sequence
 * length. A counterexample found that way is copied into `CORPUS` below as a
 * permanent regression case — the same ratchet `fixtures/` gives the round-trip
 * corpus.
 *
 * **Run several soaks rather than one long one.** Cost per run climbs with how
 * many have already run in the same process — 400 runs take ~75s, 1200 take
 * ~20min, and 4000 do not finish in half an hour. That is a leak in the harness
 * rather than anything fast-check does: a *fixed* sequence repeated 1200 times
 * shows the same curve, with the timer count flat and the heap climbing
 * (#1023). Until that is fixed, `MERIDIAN_SOAK_RUNS=400` several times over
 * covers strictly more ground per minute than one long run, and fast-check
 * picks a fresh seed each time anyway.
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { useFixedClock, resetWorld } from './twoClientHarness'
import type { FakeGitHub } from './twoClientHarness'
import type { Op, Staging, ClientId, Slug } from './interleavings'
import type { Violation } from './syncInvariants'

const { notifyFns } = vi.hoisted(() => ({
  notifyFns: { notify: vi.fn(), warn: vi.fn(), notifyError: vi.fn(), warnWithDetails: vi.fn() },
}))
vi.mock('@/storage/notifications', () => notifyFns)
vi.mock('@/storage/githubOAuth', () => ({
  ensureFreshAccessToken: vi.fn(() => Promise.resolve({ status: 'ok', token: 'ghp_test' })),
}))

const { runInterleaving, interleavingArb, formatOps } = await import('./interleavings')

let remote: FakeGitHub

beforeAll(() => { useFixedClock() })
afterAll(() => { vi.useRealTimers() })
beforeEach(async () => { remote = await resetWorld() })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

// ── Op shorthand, so a corpus case reads as the story it is ──────────

const write  = (c: ClientId, slug: Slug, field: 'title' | 'body', staging: Staging = 'pushed'): Op => ({ t: 'write', c, slug, field, staging })
const del    = (c: ClientId, slug: Slug, staging: Staging = 'pushed'): Op => ({ t: 'delete', c, slug, staging })
const sync   = (c: ClientId): Op => ({ t: 'sync', c })
const reload = (c: ClientId): Op => ({ t: 'reload', c })

/**
 * The starting corpus: the interleavings the eight hand-written scenarios in
 * `twoClient.test.ts` are built on, restated as operation sequences so the six
 * invariants run over them too.
 *
 * They are not a replacement for those tests and do not duplicate them — each
 * of those asserts a *specific* outcome (this exact call trace, this file's
 * content), which is what makes it a regression test for its own defect. What
 * these add is the other half: that the invariants hold over the same
 * interleavings. The two scenarios that drive `backend.delete` directly rather
 * than through a sync cycle (finding #3's stale-listing pair) have no operation
 * sequence — they are deliberately below this seam — and stay where they are.
 */
const CORPUS: Array<{ name: string; ops: Op[] }> = [
  {
    name: 'the seam itself: A writes, A syncs, B pulls what A wrote',
    ops: [write('deviceA', 'note', 'body'), sync('deviceA'), sync('deviceB')],
  },
  {
    name: 'two clients, two paths, no contact',
    ops: [write('deviceA', 'note', 'body'), write('deviceB', 'plan', 'body'), sync('deviceA'), sync('deviceB')],
  },
  {
    name: 'concurrent edits of the same ground: the remote wins the path, the local edit copies out',
    ops: [
      write('deviceA', 'plan', 'body'), sync('deviceA'), sync('deviceB'),
      write('deviceB', 'plan', 'body'), sync('deviceB'),
      write('deviceA', 'plan', 'body'), sync('deviceA'),
    ],
  },
  {
    name: 'concurrent edits of disjoint fields: both survive in one merged file',
    ops: [
      write('deviceA', 'plan', 'body'), sync('deviceA'), sync('deviceB'),
      write('deviceB', 'plan', 'title'), sync('deviceB'),
      write('deviceA', 'plan', 'body'), sync('deviceA'),
    ],
  },
  {
    name: 'a delete of a file both devices have seen',
    ops: [
      write('deviceA', 'note', 'body'), sync('deviceA'), sync('deviceB'),
      del('deviceB', 'note'), sync('deviceB'), sync('deviceA'),
    ],
  },
  {
    name: 'an edit landing after a delete was staged: the edit beats the delete',
    ops: [
      write('deviceA', 'note', 'body'), sync('deviceA'), sync('deviceB'),
      del('deviceA', 'note'),
      write('deviceB', 'note', 'body'), sync('deviceB'),
      sync('deviceA'),
    ],
  },
  {
    name: 'a draft that never synced, then a reload',
    ops: [
      write('deviceA', 'note', 'body', 'draft'), reload('deviceA'), sync('deviceA'),
    ],
  },
  {
    // #1017, found by this generator and shrunk to four operations — it was a
    // live defect when this file was written, allowlisted and pinned as "still
    // reachable" until the fix landed. Promoted to the corpus rather than
    // deleted with the pin: the interleaving that caught it is exactly the one
    // a future change to the tombstone path must keep passing.
    //
    // It is also a wider statement of the defect than #1017's own reproduction,
    // which reaches the version-less tombstone through a page *reload* (a cold
    // `_shas`). No reload is needed — a page that closes inside the 1s autosave
    // debounce leaves the same row.
    name: '#1017: a version-less tombstone must not delete a file this device has never seen',
    ops: [
      // B creates the note and pushes it. A has never seen this file.
      write('deviceB', 'note', 'title'),
      // A creates its own note on the same slug; the page closes inside the
      // debounce, so nothing goes out and A's row has no base version.
      write('deviceA', 'note', 'title', 'draft'),
      // A deletes its own draft. `recordLocalDelete` carries the row's version
      // forward, so the tombstone has none either.
      del('deviceA', 'note'),
      // Before the fix: the re-read supplied B's SHA, the CAS passed, and B's
      // file was destroyed. Now the tombstone's last-known content says the
      // path is not ours, so B's file is kept.
      sync('deviceA'),
    ],
  },
]

describe('sync invariants — the starting corpus (#1021)', () => {
  for (const { name, ops } of CORPUS) {
    it(name, async () => {
      const { violation } = await runInterleaving(remote, ops)
      expect(violation).toBeNull()
    })
  }
})

// ── Defects that are open, not surprises ─────────────────────────────

/**
 * Violations with an issue already filed against them.
 *
 * **Empty, and that is the point of keeping it.** A generator that finds a
 * real but already-known defect must not turn the build red on every run — but
 * suppressing one silently would be worse than not generating at all. So the
 * mechanism stays: each entry names its issue, and each is paired with a test
 * asserting the defect is *still reachable*, so the day it is fixed that test
 * goes red and points at the entry to delete. An allowlist that can outlive its
 * defect is just a disabled test.
 *
 * #1017 was the first and so far only entry. Its pin did exactly this job — it
 * failed the moment the fix landed — and the interleaving that caught it is now
 * a permanent regression case in `CORPUS` above rather than an exemption here.
 */
const KNOWN_VIOLATIONS: Array<{ issue: string; matches: (v: Violation) => boolean }> = []

const knownFor = (v: Violation): string | undefined =>
  KNOWN_VIOLATIONS.find(k => k.matches(v))?.issue

// ── The generated sweep ──────────────────────────────────────────────

const SOAK = process.env.MERIDIAN_SOAK === '1'
/** `MERIDIAN_SOAK_RUNS=5000` for a longer roam than the default soak. */
const SOAK_RUNS = Number(process.env.MERIDIAN_SOAK_RUNS ?? '400')

describe('sync invariants — generated interleavings (#1021)', () => {
  it('holds the six over generated interleavings', async () => {
    await fc.assert(
      fc.asyncProperty(interleavingArb(SOAK ? 14 : 8), async (ops) => {
        remote = await resetWorld()
        const { violation, steps } = await runInterleaving(remote, ops)
        if (violation) {
          // A defect that is already filed is not this sweep's news. It is
          // pinned above, so it cannot quietly stay allowed once it is fixed.
          if (knownFor(violation)) return
          throw new Error(
            `${violation.invariant}: ${violation.detail}\n\nThe interleaving, ` +
            `through step ${String(steps)}:\n${formatOps(ops.slice(0, steps))}`,
          )
        }
      }),
      SOAK ? { numRuns: SOAK_RUNS, endOnFailure: false } : { seed: 20260910, numRuns: 40 },
    )
    // Vitest's 5s default is per *test*, and this one is a whole sweep.
    //
    // The soak's ceiling is *derived* rather than a round number, because a
    // fixed one is a trap: a soak that runs into it fails with a timeout, which
    // reads exactly like a counterexample until you look, and reports nothing
    // about the runs that did pass. Two seconds a run is well clear of the
    // measured cost at every length this generates.
  }, SOAK ? Math.max(60_000, SOAK_RUNS * 2_000) : 60_000)
})
