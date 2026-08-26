# Sync-Engine Review — Results

Run date: 2026-08-25 · Branch: `claude/sync-conflict-frontmatter-body-3hsrl3` · Survey: **none**

> This is an **ad-hoc review**, not a run of a survey in [`surveys/`](./surveys/)
> — there is no `surveys/sync-engine.md` to point at. It follows the shared
> reporting conventions in [`surveys/README.md`](./surveys/README.md) (impact,
> breadth, recommended model with a named hazard, summary table) so it can be
> worked as a checklist like any results file, and it is subject to
> [`plans/CLAUDE.md`](./CLAUDE.md): **remove a finding's section in the same PR
> that fixes it, and delete this file entirely once the last one closes out.**

---

## 1. Why this review happened

Two users editing the same note at the same time — one changing only
frontmatter (`repeat:`), the other only the markdown body — produced a conflict
copy, then five more as editing continued. Neither side had lost anything.

That incident was fixed in **PR #816** (`f1e06ba`), which added two three-way
merges:

- `model/merge.ts` · `mergeFileContent` — merges a divergent local and remote
  file against the ancestor the local edit was made from. Cache records now
  carry `baseContent` beside `version` (`storage/cache/db.ts` · `DexieFileRow`)
  so the ancestor is available at all. Called from `resolveCollision`
  (`storage/sync.ts`) before the conflict-copy fallback.
- `model/merge.ts` · `mergeEditFields` — narrows an editor save to the fields
  the user actually touched, so a stale editor stops reverting everything that
  moved underneath it. Called from `saveNode` (`editor/save.ts`).

**The findings below are what that investigation surfaced along the way and did
not fix.** They are independent of each other and of #816, except where a
sequencing note says otherwise.

Read [`GLOSSARY.md`](../GLOSSARY.md) entries *base version / base content*,
*merge / conflict copy*, and *touched fields* before starting on any of them.

## 2. Coverage statement

**Read in full:** `storage/sync.ts` (1129 lines), `storage/cache/files.ts`,
`storage/cache/db.ts`, `storage/conflictError.ts`, `storage/conflictName.ts`,
`storage/inFlight.ts`, `storage/syncJournal.ts`, `storage/moveEntry.ts`,
`storage/fs.ts` (CAS paths), `storage/githubBackend.ts` (statAll/read/write/
delete), `routes/__root.tsx` (sync wiring), `storeCommit.ts`,
`editor/save.ts`, `editor/useEntryEditor.ts`.

**Sampled:** `storage/vaultRegistry.ts`, `storage/backends.ts`,
`storage/localBackend.ts`, `storage/icalBackend.ts` (as the one backend that
*does* do conditional requests), `store.ts` (`deriveViews` only).

**Not examined:** `storage/ical/**` (the ICS parse pipeline — its own
subsystem, no bearing on write/conflict paths), `storage/githubOAuth.ts`,
`storage/exampleBackend.ts`, `worker/`.

**Method:** static reading plus the sync journal from the real incident. **No
finding below was reproduced at runtime** — per `CLAUDE.md` no dev server was
started. Each finding states its own confidence separately.

**Gates at time of writing** (on `f1e06ba`): `pnpm run build` PASS ·
`pnpm run lint` PASS (0 warnings) · `pnpm exec vitest run` PASS (119 files /
2490 tests, coverage thresholds met).

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Conflict detection & resolution | no open findings |
| 2 | Sync scheduling & cadence | **findings: #7** |
| 3 | Write-path durability | no open findings |
| 4 | Observability | no open findings |
| 5 | Cache transitions (`cache/files.ts`) | no open findings — six transitions, each with its precondition inside one Dexie transaction; covered at 95%+ by `storage/__tests__/cache.test.ts` against real Dexie |
| 6 | Reconcile planning (`planReconcile`) | no open findings — pure, unit-tested, and its eventual-consistency guards (`skipPaths`, `RECONCILE_DELETE_GRACE_MS`, in-flight union) are each justified in-place |
| 7 | Store-layer merge (`mergeChangedIntoStore`) | no open findings — writes one vault layer, evict-then-re-add whole entries |

---

## 4. Findings

### Summary table

| # | Title | Category | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 7 | `flushPendingPush` bursts every vault at once | `cadence` | 3 | 1 file | **Sonnet 5** |

Ranked by `(impact × breadth) ÷ effort` per the shared convention, with impact
and breadth reported separately so the list can be re-sorted.

---

### Finding #7 — `flushPendingPush` bursts every vault at once

- **Category:** `cadence`
- **Impact:** 3. Minor with two vaults; it contradicts a policy the scheduler
  elsewhere goes to real trouble to maintain.
- **Breadth:** 1 file.
- **Recommended model:** **Sonnet 5** — and the task should say **the obvious
  fix may be wrong**, which is why this is not Haiku. `flushPendingPush` is the
  `pagehide` handler (`routes/__root.tsx:197`), i.e. the last moment anything
  runs before teardown. Serializing the vaults with `await` makes it *more*
  likely that later vaults never flush at all, which is the failure the
  function exists to prevent — its own doc comment says a vault skipped here
  "keeps its edit stranded in Dexie until the next launch". The right answer is
  probably to keep the parallel burst on the `pagehide` path and serialize only
  the non-teardown callers, or to leave it alone and document why it differs.
  Deciding that is the work.

**Evidence.** `autoSyncTick` is deliberately serial — `storage/sync.ts:1005+`,
whose doc comment reads *"**Oldest-synced first, one at a time.** Serial rather
than parallel on purpose: each `GitHubBackend` owns its own throttled Octokit
client, so nothing coordinates bursts across vaults"*. It `await`s each
`runSync` inside the loop.

`flushPendingPush` does not — `storage/sync.ts:908-912`:

```ts
export function flushPendingPush(): void {
  for (const backend of getMountedBackends()) {
    if (!backend.readOnly) attemptPush(backend)
  }
}
```

`attemptPush` (`sync.ts:883-887`) fires `void runSync(...)` without awaiting, so
every vault starts a cycle simultaneously.

**Problem.** Two callers reach this: `pagehide`/`visibilitychange`
(`routes/__root.tsx:197`, `:174`) and vault registration. On the teardown path
the burst is arguably correct — there is no time to be polite. On the
registration path it is the same uncoordinated multi-vault burst
`autoSyncTick`'s comment argues against.

**Fix.** Whichever policy is chosen, make the difference explicit in the code
rather than incidental: either split the function into a `flushNow` (parallel,
teardown) and a `flushSoon` (serial, everything else), or add a doc comment
stating that the parallel burst is intentional here and why.

---

## 5. Not findings — checked and deliberately left alone

- **`resolveCollision`'s one-attempt merge policy.** It does not retry after a
  refused merge write; it copies out. That is correct — a path moving under us
  is exactly when the lossless outcome matters most.
- **Body-vs-body conflicts still producing a conflict copy.** Deliberate. Two
  people typing in the same prose genuinely overlap and inventing an
  interleaving is worse than handing both versions back. No diff3 wanted.
- **No conflict-copy rate limiting.** Considered and dropped during #816: with
  the `saveNode` narrowing in place there is nothing left feeding a *run* of
  copies. The signal that would reopen it: a `collision-copied` run in a journal
  where the losing content is body-only on both sides.
- **The open editor not live-updating from the store.** Deliberate — a live
  re-read moves the cursor and reshuffles the form under the user. #816 removed
  the data loss this caused; the staleness itself is a UX question, not a
  correctness one.
- **`RECONCILE_DELETE_GRACE_MS` applying only to the delete branch.** Correct
  and justified in-place: the changed branch confirms itself via a fresh read.
