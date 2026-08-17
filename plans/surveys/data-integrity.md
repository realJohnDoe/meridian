# Data Integrity & Durability Survey

Survey this codebase for ways it can **lose, corrupt, or silently mangle the user's content**. Meridian owns a directory of plain Markdown files that the user may also edit by hand, on more than one device, through three different backends. The goal: find the **top 8 integrity risks**, each with a **reproduction** so the fix can be verified by re-running it.

Shared process, scoring, and reporting rules — model-tier ratings, the
ranking formula, category-verdict conventions, and how to report results —
live in [the shared survey conventions](./README.md). Read that first; this
file states only what's specific to this survey.

This survey is about correctness under adversity, not about code aesthetics. A finding that makes the code nicer but cannot lose a byte belongs in the general health survey, not here.

## Target invariants (the things that must never break)

Findings must be anchored to one or more of these. An issue that cannot violate any of them scores near zero no matter how ugly the code looks.

1. **Round-trip fidelity** — parsing a vault file and serializing it back without an edit preserves everything the user wrote. Editing one field changes only that field.
2. **Edit locality** — an edit to one occurrence never rewrites, reorders, or drops an unrelated occurrence, file, or frontmatter key.
3. **Expansion ↔ collapse agreement** — `collapseToYaml(expand(x)) ≡ x` in store terms; the compaction/hoisting round-trip is lossless, including across the four `applyEdit` scopes (`all`, `single`, `future`, `add`).
4. **No lost update** — a compare-and-swap write never silently overwrites a change it did not see. Concurrent or interleaved writes either merge, conflict visibly, or fail loudly.
5. **Cache coherence** — the IndexedDB cache, the in-memory store, and the backend never disagree in a way that survives a reload. A stale cache must never win over fresher remote content.
6. **Durability of accepted writes** — once the UI says "saved," the content survives a reload, a crashed tab, an offline period, and a later sync.
7. **Recoverability of destruction** — deletes, series splits, and conflict resolutions are undoable or leave a recoverable artifact. Nothing user-authored disappears with no trace.
8. **Temporal correctness** — dates, times, durations, and repeat rules mean the same thing across timezones, DST boundaries, and locales. An occurrence never silently moves days.

## Process

- **Probe first, reproduce, then write.** Three phases, in order:
  1. **Threat plan.** For each invariant above, name the code that is supposed to uphold it (function, file) and the inputs or interleavings that could break it. State this plan before you start.
  2. **Reproduction pass.** Attempt to break each invariant against the real code — adversarial inputs, hand-authored files, interleaved sync operations, simulated failures. Capture concrete reproductions _before_ forming conclusions.
  3. **Report.** Only after both passes, write the findings. Do not draft the verdict early and select repros to confirm it.
- **Every finding needs a reproduction.** A suspicion without one is at most an "unverified" note in the coverage statement — not a finding. For each finding record:
  - **Repro:** the starting vault state (file content, verbatim), the exact operation sequence, and the **observed** wrong result versus the expected one. "Observed" means you ran it.
  - The cheapest repro is usually a failing test against the existing Vitest setup. Where that works, **quote the test verbatim in the report** so it can be committed alongside the fix — a finding here should arrive with its own regression test.
  - Scratch tests and instrumentation are temporary: run them, capture the output, and leave the working tree clean.
- **Weight silence over noise.** A malformed file that throws a visible parse error is a far better outcome than one that quietly drops a frontmatter key. When scoring impact, a failure the user can see and recover from is worth several points less than one that corrupts on save and is only discovered weeks later in a git diff. Say explicitly, for each finding, whether it fails loudly or silently.
- **Separate normalization from corruption, and say which the project intends.** Reformatting (key reordering, quote style, indentation) is not automatically a bug — but this project's README promises hand-created files are picked up, so files the user wrote by hand are in scope for fidelity, not just files Meridian generated. Where you find lossy normalization, state whether it is a deliberate product choice or an accident, and put the question to the user rather than assuming.
- **Existing tests are the raw material, not the verdict.** `src/model/` and `src/storage/` both sit near a 1:1 test-to-source line ratio, so "there are tests" is not an answer. The question is what the tests *don't* assert: which inputs never appear in the fixtures, which interleavings are never exercised, which assertions are loose enough to pass over a real defect. Read `src/model/__tests__/` (including `yaml-roundtrip.test.ts`) and `src/storage/__tests__/` (including `sync-collision.test.ts` and `reconcile.test.ts`) and report the **gap**, not the count. Pay particular attention to `src/model/__tests__/__snapshots__/`: a snapshot asserts only that output hasn't *changed*, not that it is *correct*, so a snapshot accepted with `-u` can bake corruption into the baseline and defend it forever. Check whether the round-trip fixtures assert real equivalence or just stability.
- Evaluate the code on its merits. Treat claims in `CLAUDE.md`, `src/model/AGENTS.md`, README, and code comments (e.g. "round-trips back to the same store state", "this is atomic") as hypotheses to verify — an invariant asserted in a doc but not enforced or tested is itself a finding.

## Known suspects

> **Surveyed 2026-07-31 — verdicts below.** Full report with reproductions:
> [data-integrity-results.md](results/data-integrity-results.md).
> Each suspect's original hypothesis is kept verbatim, with the verdict appended.

- **The `collapseToYaml` contract is the central claim of the whole model layer.** `src/model/AGENTS.md` describes its output as "the most compact `Record<string, unknown>` that round-trips back to the same store state." Verify that claim adversarially — especially the three hoisting branches (simple, single-series-with-instances, multi-series/container) and the `hoistSharedMetadata` diffing — rather than trusting it.
  - **CONFIRMED false** — three reproduced round-trip losses: a field cleared against an inherited `defaults:` value silently reverts on reload (finding #2), an excluded instance loses all its metadata (finding #3), and a key on a node with no `StoreItem` home is deleted (finding #5). The **hoisting itself is sound**: `hoistSharedMetadata` / `computeSharedFields` / `diffMetadata` hoist and diff correctly across all three branches, including `deepEqual` on nested unknown values. The contract fails on *what reaches* the hoisting, not on the hoisting.

- **Unknown / hand-authored frontmatter.** A user's own keys, comments, anchors, aliases, multi-line block scalars, and key order all pass through `fileIO.ts` and `inheritance.ts`'s `serializeRawNode`. Determine what survives an edit-and-save cycle and what does not.
  - **MOSTLY REFUTED, one real hole.** Unknown keys, explicit `null`, empty lists, nested mappings and known-fields-with-wrong-types all survive an edit-and-save cycle — the `extra`-bag design works and `unknown-keys.test.ts` / `extras-preservation.test.ts` are thorough. The hole is finding #5: `title` / `tags` / `items` on a **non-root** node, and *all* keys on an intermediate **container** node, are filtered out by `RESERVED_KEYS` and land nowhere. Comments, anchors/aliases, key order and quoting are lost — deliberately, per `AGENTS.md`. Body whitespace and CRLF are rewritten on every save (finding #8).

- **`src/model/AGENTS.md`'s layering table is stale** — it points persistence at `src/meridian.ts` and React state at `src/App.tsx`, neither of which exists (persistence now lives in `src/storage/cache.ts`, state in `src/store.ts`). Treat that as a warning that the documented invariants in that file may also have drifted from the code, and check rather than cite them.
  - **CONFIRMED, worse than stated.** Beyond the layering table: `nodeSchema.ts` is documented as holding a **Zod schema** — it is 11 lines of `type RawNode`, and Zod is not in `package.json` at all, so there is **no validation layer**; `storeItems.ts` is documented as exporting `parseYamlToStoreItems`, which it does not. Against that, the *invariants* in the "Unknown-key preservation" section held up under adversarial probing, and its "still-open losses" paragraph honestly pre-declares findings #3, #5 and #8. **Stale on structure, honest on semantics** — the file needs a pass, but its rules are worth keeping.

### Two suspects the survey adds

- **`src/storage/cache.ts` is at 3.73% statement / 0% branch coverage.** Every real Dexie transaction (`recordLocalEdit`, `markPushed`, `applyRemoteBatch`, `recordLocalDelete`, `confirmDeleted`) is exercised only through **hand-written re-implementations** in `sync.test.ts`'s `vi.mock('@/storage/cache')`. Mock and real code agree today only because someone kept them in sync by hand. This is the least-defended integrity-critical file in the repo.
- **Two tabs of one vault have no coherence mechanism at all.** No `BroadcastChannel`, `storage` event or Dexie `liveQuery` anywhere in `src/`. Tab B's in-memory store never learns of Tab A's edits, so B's next `writeEntityToCache` collapses from a stale store and overwrites A. **Unverified** — settling it needs a two-store harness the current test-utils don't support.

## Budget

- **Read closely, end to end:**
  - The parse/serialize pipeline: `src/fileIO.ts`, `src/model/nodeSchema.ts`, `src/model/inheritance.ts`, `src/model/storeItems.ts`, `src/model/collapse.ts`.
  - The edit and commit path: `src/model/storeOps.ts` (`applyEdit` and all four scopes), `src/storeCommit.ts`, `src/persistencePort.ts`, `src/occurrenceActions.ts` (including the delete-undo toast).
  - The sync and cache path: `src/storage/sync.ts` (`planReconcile`, `reconcileWithBackend`, `applyRemoteBatch`, `syncToBackend`, `autoSyncTick`, `flushPendingPush`, the in-flight path tracking), `src/storage/cache.ts` (`recordLocalEdit`, `recordLocalDelete`, `cacheGetDirty`, `markPushed`, `confirmDeleted`, tombstones), `src/storage/conflictError.ts`, `src/storage/conflictName.ts`.
  - The backend contract in `src/storage/backend.ts` — in particular whether every implementation actually honours the documented CAS semantics of `write(path, content, expectedVersion)` and the `ConflictError` it promises.
  - The temporal engine: `src/model/expansion.ts` (`expandNode`, `mergeNode`, `expandRange`, multiday), `src/model/repeat.ts`, `src/model/dateUtils.ts`, `src/model/duration.ts`, and `src/model/expansionCache.ts` (a cache over derived temporal data is a coherence risk in its own right — check its invalidation keys).
- **Compare the three backends against the same contract.** `localBackend.ts`, `githubBackend.ts` (+ `githubApi.ts`), and `exampleBackend.ts` each implement `StorageBackend`. Differences in version-token semantics, CAS enforcement, and delete behaviour are prime lost-update territory. Note honestly which you could exercise: the automated browser cannot grant File System Access permissions or complete the GitHub OAuth flow, so **local-FS and GitHub backends can generally only be probed statically or through their unit tests** — record that up front rather than discovering it mid-pass.
- **Exercise realistic scale where it matters.** A deterministic large-vault generator exists at `src/storage/devFixtures/testVaultGen.ts` (set `localStorage.setItem('meridian_bigvault', '300')`, then reload the Tutorial vault). Use it for anything where volume changes behaviour — batch writes, partial failure, reconcile over many files. It is dev-only and absent from production builds.
- **Run the quality gates once** — `pnpm run build`, `pnpm run lint`, `pnpm test` — and report each gate's status in the coverage statement. On a fresh worktree, generate the gitignored types before trusting lint (`pnpm run build` for `src/routeTree.gen.ts`, `pnpm --filter meridian-oauth-worker run cf-typegen` for the worker types); without them the type-aware rules flood with spurious errors that are **not** a finding.
- **Check coverage where it is cheap:** `pnpm run test:coverage` is already configured. Use it to find integrity-critical branches with no coverage at all — but treat the number as a pointer to look, never as a finding by itself.
- Skim the rest of the tree so nothing is invisible. UI presentation, styling, and render performance are **out of scope** — they have their own surveys ([health-ui.md](health-ui.md), [performance.md](performance.md)) — except where a UI affordance causes an integrity failure (e.g. a save path that reports success before the write is durable, or a destructive gesture with no undo).

## Output structure

**Reporting:** this survey's results live in-place in the "Known suspects"
section above (verdicts appended per suspect) plus
`results/data-integrity-results.md` for the full report — see that
section for the existing pattern. Also append suggested improvements to this
survey file itself, per the [shared reporting conventions](./README.md#reporting).

### 1. Integrity verdict (~5 sentences)

Plain-language summary: can this app lose the user's writing, and if so, how? Name the **worst one or two invariants** (with the headline repro) and the **single biggest structural theme** (e.g. "the cache is treated as authoritative in three places where the backend version token is the only real source of truth"). This is the headline; the findings are the evidence.

### 2. Coverage statement

- Which invariants you probed with real reproductions, which you only reasoned about statically, and which you skipped — with the reason.
- Which backends you exercised versus traced only, and the vault(s) used (size, how generated).
- The pass/fail status of each quality gate from the single run required in the Budget section.
- Roughly what fraction of the integrity-critical surface this report is based on.
- Anything you suspect but could not reproduce — flag it as "unverified." Say what would be needed to settle it.

### 3. Category verdicts

One line per category (1–7). Verdicts follow the
[shared convention](./README.md#category-verdicts): **clean** /
**findings: #N, #M** / **partially assessed** (here, "the plan" means the
threat plan, and "scanning" means probing).

### 4. Findings — top 8

For each finding:

- **Title** — short label
- **Invariant violated** — which of the numbered invariants above, and under what conditions (every save / only on hand-authored files / only with two devices / only offline)
- **Category** — one or more of: `round-trip` `edit-locality` `lost-update` `cache-coherence` `durability` `recoverability` `temporal` `validation` `atomicity` `testing-gap`
- **Failure mode** — **silent** or **loud**, stated explicitly; if silent, say how a user would ever notice
- **Impact** — 1–10, where 10 = silent, unrecoverable loss or corruption of user-authored content on a common path; 5 = recoverable or visible corruption, or silent loss on a rare path; 1 = cosmetic normalization the user would not miss
- **Repro** — the starting file content (verbatim), the operation sequence, the observed result, and the expected result. Include the failing test verbatim where you wrote one
- **Breadth** — number of files affected, or the fraction of vault files that could hit it; counts from an actual search — name the search you ran; write "est." if estimated
- **Recommended model** — tier per the [shared rubric](./README.md#recommended-model-tiers). Here, **how the fix fails** is especially nasty, because the obvious "fix" often just moves the corruption (a round-trip assertion loosened until it passes, a conflict resolved by always preferring local, a cache invalidation that works on one device and rots on the second, a repeat-rule fix correct in the author's timezone only). Reserve plan mode + multi-PR for findings that need a structural change **or** a product decision the user should make (e.g. "preserve comments" vs "declare the file format normalized on save"). Example hazard note: "Sonnet 5 if the CAS precondition to preserve is spelled out in the task; else Opus 5."
- **Evidence** — at least one file path plus a short **verbatim code quote** (copy-pasted, not paraphrased — I will spot-check by grepping) identifying the code responsible
- **Problem** — one sentence: what breaks, and what the user loses as a result
- **Fix** — one sentence: the concrete change, plus **how the repro should behave afterwards**

Rank and report findings per the [shared convention](./README.md#ranking-findings) — here the summary table adds `invariant` and `failure mode` columns (finding → invariant → failure mode → recommended model). "Confirming" a fix means re-running a repro or the test suite.

**Strongly prefer systemic findings over isolated ones.** "Every save path drops unknown frontmatter keys" beats "this one date helper is off by one." Cite real code and real repros — no generic data-safety boilerplate.

Do not pad to 8 — if fewer clear issues exist, stop there. A short report backed by real reproductions is worth more than a long one built on suspicion.

---

## Categories to probe — ranked by priority

The ranking is a tiebreaker, not a filter — a severe finding in any category outranks a minor one in a higher category. Bullets are illustrative examples, not the category's boundary.

### 1. Round-trip fidelity & edit locality _(highest weight)_

**Scope:** what a parse → edit → serialize cycle does to bytes the user wrote.

- Frontmatter keys Meridian doesn't know about, dropped or reordered on save
- Comments, anchors/aliases, block scalars, explicit quoting, or intentional formatting destroyed by re-serialization
- The Markdown body below the frontmatter altered, re-wrapped, or losing trailing whitespace/newline conventions
- Unicode, emoji, RTL text, or CRLF line endings normalized destructively
- An edit to one occurrence rewriting sibling occurrences, hoisting fields that were deliberately per-instance, or collapsing a structure the user hand-authored
- `hoistSharedMetadata` promoting a field to `defaults:` such that a later per-instance edit changes the wrong set of occurrences

### 2. Lost updates & conflict handling

**Scope:** two writers, one file — across devices, tabs, or a hand edit outside the app.

- CAS preconditions omitted, weakened, or passed a stale `expectedVersion`, so a write clobbers unseen remote content
- `ConflictError` caught and swallowed, retried blindly, or resolved by a silent "local wins"
- Backends that differ in whether they actually enforce `expectedVersion` — a contract honoured by one implementation and ignored by another
- Conflict artifacts (`conflictName.ts`) that collide, overwrite each other, or are themselves picked up as vault files and re-synced
- Delete-versus-edit races, and tombstones resurrecting or suppressing a legitimately recreated file
- Two tabs of the same vault, or a sync tick overlapping an in-flight write

### 3. Cache coherence & durability

**Scope:** disagreement between IndexedDB, the in-memory store, and the backend.

- A stale cached version winning over fresher remote content after reload, or dirty-flag bookkeeping (`recordLocalEdit` → `markPushed`) that can drop an edit if interrupted between the two
- Writes acknowledged in the UI before they are durable anywhere — the "saved" indicator as a lie
- Content that exists only in memory across a reload, tab crash, or backgrounded PWA
- Offline edits queued but lost on eviction, quota exhaustion, or a failed replay; IndexedDB quota/`QuotaExceededError` unhandled
- `expansionCache.ts` invalidation keyed on something that can miss a real change, serving derived data that no longer matches the store
- Vault registry / active-vault state disagreeing with what is actually cached, so a sync targets the wrong vault

### 4. Atomicity & partial failure

**Scope:** what the vault looks like when an operation stops halfway.

- Multi-file operations (series split via `applyEdit` scope `future`, rename/retitle, batch sync) that are not atomic and leave a half-applied vault
- Failures mid-`applyRemoteBatch` leaving some files updated and others not, with no record of where it stopped
- Error paths that abandon in-flight bookkeeping (`markInFlight` without a guaranteed `clearInFlight`), stranding files as permanently "in flight"
- Retry/backoff logic that re-sends a write whose first attempt actually succeeded

### 5. Destruction & recoverability

**Scope:** whether anything user-authored can vanish with no way back.

- Deletes, swipe-deletes, series truncation (`deleteFollowing`), and exclusion paths without undo, confirmation, or a recoverable artifact
- Undo windows that can be outlived by a sync, so the undo restores nothing or restores a stale copy
- Destructive resolution of a conflict without preserving the losing side
- Bulk operations whose blast radius is larger than the UI implies

### 6. Temporal correctness

**Scope:** the meaning of a date surviving the environment it's read in.

- Timezone/DST handling in `expansion.ts` and `repeat.ts` — occurrences shifting by a day near a DST boundary, or for a user east/west of the author
- Date parsing/serialization asymmetries (`fmtISO`, `parseDateString`) that round-trip a date to a different day
- Duration and multiday arithmetic across month/year ends and leap days
- Repeat rules whose expansion depends on the window queried — the same rule yielding different occurrences depending on the range asked for
- `stableOccId` collisions or instability, causing an override to attach to the wrong occurrence

### 7. Input validation & untrusted files

**Scope:** what happens when a vault file isn't what the app expects.

- Zod schema (`nodeSchema.ts`) rejections that surface as a crash or a blank vault rather than a per-file error the user can act on
- Malformed YAML, wrong types, deeply nested or cyclic structures, enormous files — and whether a single bad file can prevent the rest of the vault from loading
- Path handling in `pathToSlug` / `slugToPath` / `titleToSlug`: collisions between distinct titles, traversal-ish paths, case-insensitive filesystems, or characters a backend rejects — any of which can make two entries fight over one file
- Files added out of band (hand-created, synced by a desktop client) that the app then normalizes destructively on first save

---

**Scoring guidance:** Silent beats loud, common beats rare, unrecoverable beats recoverable — in that order. A defect that corrupts one file per thousand saves with no error message outranks one that throws a visible exception on every malformed file. A structural fix that upholds an invariant across all three backends or all four edit scopes scores like the class of failures it prevents, not like one callsite. Skip findings that are merely untidy: if you cannot describe the byte the user loses, it belongs in the general health survey.
