# Data Integrity & Durability Survey

Survey this codebase for ways it can **lose, corrupt, or silently mangle the user's content**. Meridian owns a directory of plain Markdown files that the user may also edit by hand, on more than one device, through three different backends. Find the **top 8 integrity risks**, each with a **reproduction** so the fix can be verified by re-running it.

Shared process, scoring, and reporting rules — model-tier ratings, the ranking
formula, category-verdict conventions, and how to report results — live in [the
shared survey conventions](./README.md). Read that first; this file states only
what's specific to this survey.

This survey is about correctness under adversity, not code aesthetics. A finding that makes the code nicer but cannot lose a byte belongs in the general health survey.

## Target invariants (the things that must never break)

Findings must be anchored to one or more of these. An issue that cannot violate any of them scores near zero no matter how ugly the code looks.

1. **Round-trip fidelity** — parsing a vault file and serializing it back without an edit preserves everything the user wrote. Editing one field changes only that field.
2. **Edit locality** — an edit to one occurrence never rewrites, reorders, or drops an unrelated occurrence, file, or frontmatter key.
3. **Expansion ↔ collapse agreement** — `collapseToYaml(expand(x)) ≡ x` in store terms, including across the four `applyEdit` scopes (`all`, `single`, `future`, `add`).
4. **No lost update** — a compare-and-swap write never silently overwrites a change it did not see. Concurrent or interleaved writes either merge, conflict visibly, or fail loudly.
5. **Cache coherence** — the IndexedDB cache, the in-memory store and the backend never disagree in a way that survives a reload. A stale cache must never win over fresher remote content.
6. **Durability of accepted writes** — once the UI says "saved", the content survives a reload, a crashed tab, an offline period, and a later sync.
7. **Recoverability of destruction** — deletes, series splits and conflict resolutions are undoable or leave a recoverable artifact. Nothing user-authored disappears with no trace.
8. **Temporal correctness** — dates, times, durations and repeat rules mean the same thing across timezones, DST boundaries and locales. An occurrence never silently moves days.

## Process

**Probe, reproduce, then write** — three phases, in order. (1) **Threat plan:** for each invariant, name the code that is supposed to uphold it and the inputs or interleavings that could break it, in writing, before you start. (2) **Reproduction pass:** try to break each invariant against the real code — adversarial inputs, hand-authored files, interleaved sync operations, simulated failures. (3) Only then write the findings.

- **Every finding needs a reproduction.** A suspicion without one is at most an "unverified" note in the coverage statement. Record the starting vault state (file content, verbatim), the exact operation sequence, and the **observed** wrong result against the expected one — "observed" means you ran it. The cheapest repro is usually a failing Vitest test; where that works, quote it verbatim so it can be committed alongside the fix. Scratch tests and instrumentation are temporary — leave the tree clean.
- **Probe both round trips, and say which one you probed.** "Parse → serialize" and "parse → edit → serialize" are different checks that fail for different reasons, and the repo's own runtime guard (`roundTripLoss`) only performs the first — its doc comment says so. A file can round-trip byte-perfectly while untouched and lose three hand-authored keys on the first editor save; that is where three of the 2026-09-05 run's four fidelity findings lived. The cheap harness for the second is a **no-op save**: derive `EditFields` from an expanded occurrence via `entryFromOccurrence`, run it back through `mergeEditFields` → `applyEdit` → `serializeEntry`, and diff against the unedited serialization — for every fixture × every scope.
- **Ask what the repo's own guard can see.** Whenever you find a loss, run `roundTripLoss` over the same input and record its verdict. A loss the guard reports is a much smaller problem than one it calls clean, and a guard blind to a whole class is itself a finding.
- **Weight silence over noise.** A malformed file that throws a visible parse error is a far better outcome than one that quietly drops a frontmatter key. A failure the user can see and recover from is worth several points less than one that corrupts on save and surfaces weeks later in a git diff. Say explicitly, per finding, whether it fails loudly or silently.
- **Separate normalization from corruption, and say which the project intends.** Reformatting (key reordering, quote style, indentation) is not automatically a bug — but the README promises hand-created files are picked up, so files the user wrote by hand are in scope for fidelity. Where you find lossy normalization, state whether it is a deliberate product choice or an accident, and put the question to the user rather than assuming.
- **Existing tests are the raw material, not the verdict.** `src/model/` and `src/storage/` both sit near a 1:1 test-to-source line ratio, so "there are tests" is not an answer. Ask what they *don't* assert: which inputs never appear in the fixtures, which interleavings are never exercised, which assertions are loose enough to pass over a real defect. Pay particular attention to `src/model/__tests__/__snapshots__/` — a snapshot asserts only that output hasn't *changed*, not that it is *correct*, so one accepted with `-u` can bake corruption into the baseline and defend it forever.
- Evaluate the code on its merits, per [Running a survey](./README.md#running-a-survey) — here `src/model/AGENTS.md` is the doc that matters most, and "round-trips back to the same store state" and "this is atomic" are the claims to break.

## Known suspects

> **Standing hypotheses, each with the date it was last checked.** This survey keeps its
> memory here rather than in the tracker, and the [shared conventions](./README.md#reporting)
> allow that as its one exception. Re-issue and re-date each verdict per run;
> the findings-by-number in old verdicts and in `src/`'s
> "data-integrity survey, finding #N" comments are per-run numbers whose reports
> are in git history — per `plans/CLAUDE.md`, don't renumber them.

- **The `collapseToYaml` contract is the central claim of the whole model layer.** `src/model/AGENTS.md` describes its output as "the most compact `Record<string, unknown>` that round-trips back to the same store state". Verify that adversarially — especially the three hoisting branches (simple, single-series-with-instances, multi-series/container) and `hoistSharedMetadata`'s diffing — rather than trusting it.
  - **2026-09-05:** the hoisting itself is sound (a no-op-save sweep over 20 fixtures × 3 scopes × 3 occurrences found no hoisting defect). What broke the claim sat on either side of collapse: a structural key the parser can't type had no `extra` home and was deleted, and a scalar the parser had already flattened (`zip: 01234`, an ID past 2⁵³) came back changed. Both fixed (#982, #979). Collapse was doing the right thing with what it was handed; it was handed less than the file contained — so re-probe the *handoff*, not just the function.

- **Unknown / hand-authored frontmatter.** A user's own keys, comments, anchors, aliases, multi-line block scalars and key order all pass through `fileIO.ts` and `inheritance.ts`'s `serializeRawNode`. Determine what survives an edit-and-save cycle.
  - **2026-09-05: the load side was sound, the edit side was not.** Genuinely unknown keys survive both an unedited save and an edit — the `extra`-bag design works. The holes were on the edit path: a *known* key in an unrepresentable shape survived the load and was deleted by the first save (13 of 18 probed hand-authored shapes), and quoting turned out not to be cosmetic — `defaultStringType: 'PLAIN'` rewrites `x: "yes"` as `x: yes`, which YAML 1.1 readers (Obsidian, PyYAML) read as boolean `true`. Fixed (#975, #979). Comments, anchors/aliases and key order are still lost, deliberately per `AGENTS.md`.

- **There is no validation layer anywhere in the parse pipeline.** `src/model/AGENTS.md` claims `nodeSchema.ts` holds a Zod schema and type for `RawNode`; it is 11 lines of `type RawNode`, and `zod` is in neither `package.json`. **Still true as of 2026-09-13** — and it is the root cause the fidelity findings above kept sharing, since nothing between `yamlParse` and the store ever asks whether a value has the shape the model assumes. Every coercion is ad hoc and per-field.

- **Two tabs of one vault.** Tab B's in-memory store learning nothing of Tab A's edits, so B's next write collapses from a stale store and overwrites A.
  - **2026-09-05: CONFIRMED and worse than hypothesized** — the loss was in the cache's version bookkeeping, not the stores, so CAS never even caught it: `recordLocalEdit` inherited a version Tab A's push had just refreshed in the *shared* cache, so B's precondition matched the backend and `resolveCollision` was never entered. No conflict copy, no merge, no toast. Fixed (#977); `src/storage/cache/broadcast.ts` and `src/storage/crossTabSync.ts` now exist, where a 2026-09-05 grep for `BroadcastChannel|liveQuery|storage` event returned zero hits. **Re-probe the new mechanism rather than the old gap** — and note #1031's flake in its tests, which is a sign this area is timing-sensitive.

## Budget

- **Read closely, end to end:**
  - Parse/serialize: `src/fileIO.ts`, `src/model/nodeSchema.ts`, `inheritance.ts`, `storeItems.ts`, `collapse.ts`.
  - Edit and commit: `src/model/storeOps.ts` (`applyEdit`, all four scopes), `src/storeCommit.ts`, `src/persistencePort.ts`, `src/occurrenceActions.ts` (including the delete-undo toast).
  - Sync and cache: `src/storage/sync.ts` (`planReconcile`, `reconcileWithBackend`, `applyRemoteBatch`, `runSync`), `syncScheduler.ts` (`syncToBackend`, `autoSyncTick`, `flushPendingPush`), `syncState.ts`, `entityWrites.ts`, `inFlight.ts`, `crossTabSync.ts`, `cache/` (`files.ts`, `db.ts`, `pendingMoves.ts`, `broadcast.ts`), `conflictError.ts`, `conflictName.ts`.
  - The teardown path, where "the UI said saved" is decided: `src/editor/useAutoSave.ts`'s debounce and every call site of its flush, against the `visibilitychange`/`pagehide` handlers in `src/routes/__root.tsx`. A commit that only fires on React unmount is not durable — unmount effects don't run when a tab closes.
  - The backend contract in `src/storage/backend.ts` — whether every implementation honours the documented CAS semantics of `write(path, content, expectedVersion)` and the `ConflictError` it promises.
  - The temporal engine: `expansion.ts` (`expandNode`, `mergeNode`, `expandRange`, multiday), `repeat.ts`, `dateUtils.ts`, `duration.ts`, and `expansionCache.ts` (a cache over derived temporal data is a coherence risk in its own right — check its invalidation keys).
- **The cache layer can be exercised for real — do that rather than reasoning about it.** `src/storage/__tests__/cache.test.ts` has the recipe: import `fake-indexeddb/auto`, `vi.resetModules()` per test, drive the genuine Dexie code. Pairing that with a twenty-line in-memory CAS backend reproduces whole classes this Budget would otherwise call un-exercisable — the 2026-07-31 run parked the two-tab suspect as needing a two-store harness, and the 2026-09-05 run settled it with no second store at all.
- **Run the temporal probes under other timezones.** Category 6 is unreachable from a single `TZ`; `TZ=<zone> pnpm exec vitest run <file>` is the whole recipe, and a differential sweep — same rules, several zones, diff the emitted occurrence sets — finds in one pass what no single-zone assertion will. Zones worth including, and why: **America/New_York** and **Europe/Berlin** (ordinary one-hour spring-forward, the two halves of the user base), **Antarctica/Troll** (a *two*-hour jump, which catches an off-by-one-hour fix that a one-hour zone hides), **Australia/Lord_Howe** (30-minute DST shift), **Pacific/Chatham** (a :45 offset), **America/Santiago** (a midnight transition, so the skipped wall-clock hour is `00:00`). Sweep every half-hour of the day rather than a few times: the 2026-09-05 temporal finding fires only for anchors inside the skipped hour, 2 of 48 times in most zones.
- **Compare the three backends against the same contract.** `localBackend.ts`, `githubBackend.ts` (+ `githubApi.ts`) and `exampleBackend.ts` each implement `StorageBackend`; differences in version-token semantics, CAS enforcement and delete behaviour are prime lost-update territory. Only the example backend is exercisable here — record the other two as probed statically or through their unit tests.
- **Exercise realistic scale where volume changes behaviour** ([generator recipe](./README.md#what-this-environment-can-and-cannot-do)): batch writes, partial failure, reconcile over many files.
- **Run the quality gates once** — `pnpm run build`, `pnpm run lint`, `pnpm test` — and report each in the coverage statement. `pnpm run test:coverage` is configured; use it to find integrity-critical branches with no coverage at all, but treat the number as a pointer to look, never a finding by itself.
- Skim the rest so nothing is invisible. UI presentation, styling and render performance are **out of scope** ([health-ui.md](health-ui.md), [performance.md](performance.md)) except where a UI affordance causes an integrity failure — a save path that reports success before the write is durable, a destructive gesture with no undo.

## Output structure

**Reporting:** per the [shared reporting conventions](./README.md#reporting), plus the in-place suspect verdicts above, plus suggested improvements to this survey file itself.

1. **Integrity verdict** (~5 sentences) — can this app lose the user's writing, and if so how? Name the worst one or two invariants with the headline repro, and the single biggest structural theme (e.g. "the cache is treated as authoritative in three places where the backend version token is the only real source of truth").
2. **Coverage statement** — which invariants you probed with real reproductions, which you only reasoned about, which you skipped and why; which backends you exercised versus traced; the vault(s) used; each quality gate's status; roughly what fraction of the integrity-critical surface this rests on; anything unverified, and what would settle it.
3. **Category verdicts** — one line per category (1–7), per the [shared convention](./README.md#category-verdicts); here "the plan" means the threat plan and "scanning" means probing.
4. **Findings — top 8.**

Findings carry the [shared fields](./README.md#finding-fields) — `Breadth` here is very often a *condition* rather than a file set ("every entry, whenever two tabs are open"; "every series whose time falls in the DST gap"), which the shared rule allows, and `Fix` must say **how the repro should behave afterwards**. This survey adds:

- **Invariant violated** — which numbered invariant, and under what conditions (every save / only hand-authored files / only with two devices / only offline)
- **Category** — one or more of: `round-trip` `edit-locality` `lost-update` `cache-coherence` `durability` `recoverability` `temporal` `validation` `atomicity` `testing-gap`
- **Failure mode** — **silent** or **loud**, stated explicitly; if silent, say how a user would ever notice
- **Impact** — 1–10 (10 = silent, unrecoverable loss of user-authored content on a common path; 5 = recoverable or visible corruption, or silent loss on a rare path; 1 = cosmetic normalization the user wouldn't miss)
- **Repro** — starting file content verbatim, operation sequence, observed result, expected result, and the failing test where you wrote one

**Fails silently here** is especially nasty, because the obvious "fix" often just moves the corruption: a round-trip assertion loosened until it passes, a conflict resolved by always preferring local, a cache invalidation that works on one device and rots on the second, a repeat-rule fix correct in the author's timezone only. Reserve plan mode + multi-PR for a structural change **or** a product decision ("preserve comments" vs "declare the file format normalized on save"). Hazard note example: "Sonnet 5 if the CAS precondition to preserve is spelled out in the task; else Opus 5." The summary table adds `invariant` and `failure mode` columns; "confirming" a fix means re-running a repro or the test suite.

---

## Categories to probe — ranked by priority

Bullets are illustrations, not your search space — see [Running a survey](./README.md#running-a-survey).

### 1. Round-trip fidelity & edit locality _(highest weight)_

**Scope:** what a parse → edit → serialize cycle does to bytes the user wrote.

- Frontmatter keys Meridian doesn't know about, dropped or reordered on save; comments, anchors/aliases, block scalars or explicit quoting destroyed by re-serialization
- The Markdown body altered, re-wrapped, or losing trailing-whitespace/newline conventions; Unicode, emoji, RTL or CRLF normalized destructively
- An edit to one occurrence rewriting siblings, hoisting fields that were deliberately per-instance, or collapsing a structure the user hand-authored
- `hoistSharedMetadata` promoting a field to `defaults:` such that a later per-instance edit changes the wrong set of occurrences

### 2. Lost updates & conflict handling

**Scope:** two writers, one file — across devices, tabs, or a hand edit outside the app.

- CAS preconditions omitted, weakened, or passed a stale `expectedVersion`
- `ConflictError` caught and swallowed, retried blindly, or resolved by a silent "local wins"
- Backends that differ in whether they actually enforce `expectedVersion`
- Conflict artifacts (`conflictName.ts`) that collide, overwrite each other, or are themselves picked up as vault files and re-synced
- Delete-versus-edit races; tombstones resurrecting or suppressing a legitimately recreated file
- Two tabs of the same vault, or a sync tick overlapping an in-flight write

### 3. Cache coherence & durability

**Scope:** disagreement between IndexedDB, the in-memory store and the backend.

- A stale cached version winning over fresher remote content after reload, or `recordLocalEdit` → `markPushed` bookkeeping that can drop an edit if interrupted between the two
- Writes acknowledged in the UI before they are durable anywhere — the "saved" indicator as a lie; content that exists only in memory across a reload, tab crash or backgrounded PWA
- Offline edits queued but lost on eviction, quota exhaustion or a failed replay; `QuotaExceededError` unhandled
- `expansionCache.ts` invalidation keyed on something that can miss a real change
- Vault registry / active-vault state disagreeing with what is cached, so a sync targets the wrong vault

### 4. Atomicity & partial failure

**Scope:** what the vault looks like when an operation stops halfway.

- Multi-file operations (a `future`-scope series split, rename/retitle, batch sync) that leave a half-applied vault
- Failures mid-`applyRemoteBatch` leaving some files updated and others not, with no record of where it stopped
- Error paths that abandon in-flight bookkeeping (`markInFlight` with no guaranteed `clearInFlight`), stranding files as permanently "in flight"
- Retry/backoff that re-sends a write whose first attempt actually succeeded

### 5. Destruction & recoverability

**Scope:** whether anything user-authored can vanish with no way back.

- Deletes, swipe-deletes, series truncation (`deleteFollowing`) and exclusion paths without undo, confirmation or a recoverable artifact
- Undo windows that a sync can outlive, so the undo restores nothing or restores a stale copy
- Destructive conflict resolution that doesn't preserve the losing side
- Bulk operations whose blast radius is larger than the UI implies

### 6. Temporal correctness

**Scope:** the meaning of a date surviving the environment it's read in. Unreachable from one `TZ` — see the sweep recipe in Budget.

- DST/timezone handling in `expansion.ts` and `repeat.ts` — occurrences shifting a day near a boundary, or for a user east/west of the author
- Date parse/serialize asymmetries (`fmtISO`, `parseDateString`) that round-trip a date to a different day
- Duration and multiday arithmetic across month/year ends and leap days
- Repeat rules whose expansion depends on the window queried — the same rule yielding different occurrences for different ranges
- `stableOccId` collisions or instability, attaching an override to the wrong occurrence

### 7. Input validation & untrusted files

**Scope:** what happens when a vault file isn't what the app expects. Note the standing suspect above: there is **no** validation layer, so every coercion is ad hoc.

- Check both halves of the gap: an *inline* field, where `malformedKnownFields` routes the raw value into `extra`, and a *structural* key (`date`, `time`, `repeat`, `excluded`, `instances`, `defaults`), which `RESERVED_KEYS` keeps out of `extra` and nothing else catches
- Malformed YAML, wrong types, deeply nested or cyclic structures, enormous files — and whether one bad file can stop the rest of the vault loading
- Path handling in `pathToSlug` / `slugToPath` / `titleToSlug`: collisions between distinct titles, traversal-ish paths, case-insensitive filesystems, characters a backend rejects — any of which can make two entries fight over one file
- Files added out of band (hand-created, synced by a desktop client) that the app normalizes destructively on first save

---

**Scoring guidance:** Silent beats loud, common beats rare, unrecoverable beats recoverable — in that order. A defect that corrupts one file per thousand saves with no error message outranks one that throws visibly on every malformed file. A structural fix that upholds an invariant across all three backends or all four edit scopes scores like the class of failures it prevents, not one callsite. Skip findings that are merely untidy: if you cannot describe the byte the user loses, it belongs in the general health survey.
