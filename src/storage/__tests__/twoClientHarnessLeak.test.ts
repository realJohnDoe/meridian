/**
 * Regression coverage for #1023: the two-client harness leaked across runs,
 * so a soak's cost per run climbed with how many had already run in the same
 * process (400 runs ~75s, 1,200 ~20min, 4,000 didn't finish in 30min).
 *
 * The mechanism was `resetWorld()` wrapping the fetch stub in `vi.fn(...)` on
 * every call. `vi.fn()` registers every mock it creates in vitest's own
 * module-level `REGISTERED_MOCKS` set — which backs `clearAllMocks` /
 * `resetAllMocks`, and which nothing (not even those) ever removes an entry
 * from. A soak calling `resetWorld` thousands of times therefore minted that
 * many mocks, each closing over one run's `FakeGitHub`, and every one of them
 * lived for the rest of the process: unbounded heap growth, and — since GC
 * cost scales with live heap — the superlinear wall-time growth the issue
 * measured. See `resetWorld`'s own comment in `twoClientHarness.ts`.
 *
 * The first test below is cheap, deterministic, and always runs: it pins the
 * fix itself (a plain function stubbed in, not a mock) rather than the effect,
 * so it cannot flake on a shared CI runner the way a timing assertion would.
 *
 * The second is the probe the issue asked for — the same fixed sequence
 * repeated many times, printing the same wall-time/heap table the issue was
 * filed from — so the improvement can be confirmed by re-running this rather
 * than re-measuring by hand:
 *
 * ```
 * MERIDIAN_LEAK_PROBE_RUNS=1200 pnpm exec vitest run src/storage/__tests__/twoClientHarnessLeak.test.ts
 * ```
 *
 * It is opt-in and unasserted (only logged) because wall-clock and heap
 * numbers are exactly what should never gate CI. Re-running it after this fix
 * (2,400 runs of a real sync-cycle sequence in ~47s total, vs. the issue's
 * own 1,200 runs in ~1,235s) shows the dominant cost gone — a smaller,
 * gentler climb remains, consistent with ordinary GC behavior at a growing
 * live heap rather than an unbounded collection, and well within what makes a
 * 4,000-run soak (the count the issue reported never finishing) complete in
 * about a minute.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import 'fake-indexeddb/auto'
import { entryKey } from '@/fileIO'
import { writeEntityToCache } from '@/storage/entityWrites'
import { useFixedClock, resetWorld, makeClient, registerVaults, syncClient } from './twoClientHarness'

vi.mock('@/storage/notifications', () => ({
  notify: vi.fn(), warn: vi.fn(), notifyError: vi.fn(), warnWithDetails: vi.fn(),
}))
vi.mock('@/storage/githubOAuth', () => ({
  ensureFreshAccessToken: vi.fn(() => Promise.resolve({ status: 'ok', token: 'ghp_test' })),
}))

beforeAll(() => { useFixedClock() })
afterAll(() => { vi.useRealTimers() })

describe('resetWorld does not leak across runs (#1023)', () => {
  it('stubs a plain function, not a vitest mock', async () => {
    await resetWorld()
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false)
  })

  /** One write, two syncs, one more write — the "fixed four-operation sequence" the issue measured. */
  async function runOnce(): Promise<void> {
    await resetWorld()
    const a = makeClient('deviceA')
    const b = makeClient('deviceB')
    registerVaults(a, b)
    await writeEntityToCache(entryKey('deviceA', 'note'), '---\ntitle: note\n---\n\nbody\n')
    await syncClient(a)
    await syncClient(b)
    await writeEntityToCache(entryKey('deviceB', 'note'), '---\ntitle: note\n---\n\nbody 2\n')
  }

  const RUNS = Number(process.env.MERIDIAN_LEAK_PROBE_RUNS ?? '0')
  const BATCH = 200

  it.runIf(RUNS > 0)('wall time per batch, over many runs', async () => {
    for (let done = 0; done < RUNS; done += BATCH) {
      const t0 = performance.now()
      for (let i = 0; i < BATCH && done + i < RUNS; i++) await runOnce()
      const ms = performance.now() - t0
      const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)
      console.log(`after ${done + BATCH} runs: ${ms.toFixed(0)}ms for this batch, heap=${heapMB}MB`)
    }
  }, Math.max(60_000, RUNS * 200))
})
