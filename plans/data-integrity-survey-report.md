# Data Integrity & Durability Survey — report

Branch: `claude/data-integrity-durability-survey-b72a48` · Date: 2026-07-27

---

## 1. Integrity verdict

Yes, this app can lose the user's writing, and the biggest loss is not a race or a
crash — it is the ordinary save path. **Every write regenerates the whole `.md` file
from an eight-field in-memory model** (`collapseToYaml` → `saveFile`), so any
frontmatter Meridian doesn't have a name for — the user's own keys, YAML comments,
aliases, per-instance notes, even a known field carrying an unexpected type — is gone
the first time the entry is touched, with no warning and no artifact. The second-worst
is **`applyNew`'s slug guard**: creating a new entry whose title slugifies onto an
existing file silently replaces that file's tags, items, date, `done` state and body
with the new entry's, because the guard was written to make a re-entrant autosave
idempotent and cannot tell that case apart from "different entry, same slug." The
structural theme behind both: _the store, not the file, is treated as the source of
truth_ — the file is a projection of a closed domain model rather than a document the
model annotates, so anything the model can't express has nowhere to survive. The same
theme reappears one layer down, where the reconcile/CAS machinery is carefully correct
against a contract that only one of the three backends actually implements. The temporal
engine is a separate, smaller cluster: `generateScheduledDates` counts occurrences per
query window and overflows month ends, so bounded series repeat forever and "the 31st"
lands on the 1st.

---

## 2. Coverage statement

**Probed with real reproductions** (ran the code, captured output):

| Invariant              | How                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Round-trip fidelity  | Adversarial hand-authored files through the real `parseToStoreItems` → `collapseToYaml` → `saveFile` pipeline: unknown keys, comments, block scalars, aliases, CRLF, unicode/RTL/emoji, numeric- and boolean-looking strings, wrong-typed known fields |
| 2 Edit locality        | All four `applyEdit` scopes (`all`/`single`/`future`/`add`) plus `applyNew` on a weekly series with two overrides; byte-diffed the serialized output before/after                                                                                      |
| 3 Expansion ↔ collapse | All 13 fixtures via the existing round-trip suite, plus adversarial multi-series and post-`future`-split re-parse → re-expand                                                                                                                          |
| 4 No lost update       | The **real** `src/storage/fs.ts` driven against an in-memory `FileSystemDirectoryHandle` stand-in (not a mock of `fs.ts` — the actual `diskWrite`/`diskDelete`)                                                                                        |
| 7 Recoverability       | Swipe-delete undo window with an interleaved unrelated edit, through the real `occurrenceActions` + store + persistence port                                                                                                                           |
| 8 Temporal             | `end.type: count`, the 500-iteration cap, `bymonthday` month-end overflow, yearly-from-Feb-29, DST spring-forward/fall-back in `Europe/Berlin`                                                                                                         |
| — Validation           | Five malformed/hostile files through the real `parseFiles` load path                                                                                                                                                                                   |

**Reasoned about statically only** (no reproduction):

- Invariant 5 (cache coherence) below the store level and invariant 6 (durability):
  `cache.ts`'s Dexie transactions. Every sync test replaces `@/storage/cache` with a
  hand-written in-memory re-implementation, so I could exercise the _policy_ but not
  the real `markPushed` / `applyRemoteBatch` preconditions. Measured coverage confirms
  it: **`cache.ts` is at 3.73% statements**. Nothing I could see there is wrong — the
  six transitions each carry their precondition and the reasoning in the comments holds
  up — but "I read it" is the whole basis.
- IndexedDB quota exhaustion / `QuotaExceededError`. `recordLocalEdit` has no catch;
  a quota failure would reject into `writeEntityToCache`'s catch → `notifyError('Save
failed')`. That is the right shape (loud), so I did not pursue it. **Unverified.**
- Two tabs of the same vault. The in-flight registry is per-tab module state and Dexie
  is shared, so two tabs can each hold a `version` for the same path and each CAS
  successfully in turn — the second's write is based on content the first never saw.
  I could not build a two-tab repro in this harness. **Unverified**; settling it needs
  either a real two-context browser test or a `BroadcastChannel`-level design review.

**Skipped, with reason:** invariant 6's "backgrounded PWA" leg — `pagehide` +
`visibilitychange` both call `flushPendingPush` (`src/routes/__root.tsx:51,66`), which
is the correct hook set; verifying that it actually lands before process death needs a
real device, not this harness.

**Backends:**

| Backend  | Exercised how                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Example  | Read end-to-end (it is `readOnly`, so no write path exists to test)                                                                                                                                                                                                                    |
| Local FS | **Exercised** — `diskWrite`/`diskDelete` run for real against a fake directory handle. Could not exercise `LocalBackend` itself (no File System Access API in Node, no permission grant in the automated browser), but it is a 20-line delegation to `fs.ts` and was read line by line |
| GitHub   | **Traced only** — no OAuth flow available. Read `githubBackend.ts` + `githubApi.ts` end to end; its behaviour is inferred from the Contents API semantics its code relies on. Existing tests cover it at 89%                                                                           |

**Vaults used:** the 17-entry Tutorial vault (`exampleBackend.ts`) and hand-written
adversarial fixtures. I did **not** use `testVaultGen.ts`'s 300-file vault: nothing
in the findings is volume-dependent, and the two places where volume changes behaviour
(`LARGE_RECONCILE_THRESHOLD`, `GRAPHQL_BATCH_SIZE`) are throughput paths, not
correctness paths.

**Quality gates** (single run each):

| Gate                     | Status                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run build`         | **pass** — `tsc -b` + vite, built in 10.08s                                                                                                                                                                                             |
| `pnpm run lint`          | **pass** — 0 errors, 2 pre-existing `react-hooks/incompatible-library` warnings (`AgendaList.tsx`, `FileResultsList.tsx`). Generated types were produced first (`pnpm run build`, `pnpm --filter meridian-oauth-worker run cf-typegen`) |
| `pnpm test`              | **pass** — 53 files, 642 tests                                                                                                                                                                                                          |
| `pnpm run test:coverage` | 57.56% statements overall; integrity-critical files below                                                                                                                                                                               |

Coverage on the integrity surface, used only as a pointer to where to look:

```
collapse.ts      95.87 |  storeOps.ts    91.35 |  sync.ts       91.80
expansion.ts     85.51 |  storeItems.ts  81.57 |  inheritance.ts 66.66
fs.ts             0.00 |  localBackend.ts 0.00 |  cache.ts        3.73
```

The three zeros are not a coincidence: **the only backend whose CAS semantics diverge
from the contract is the only one with no tests at all**, and the module holding every
dirty/tombstone transition is mocked out of existence in the suite that tests it.
That pairing is finding #3.

**Fraction of the integrity-critical surface this report covers:** roughly 70%.
Fully covered: the parse/serialize pipeline, all four edit scopes, the temporal
engine, `planReconcile`'s decision table, the local FS write/delete contract. Partially:
`reconcileWithBackend`'s effectful half and `pushDirty` (exercised through the suite's
fakes, not the real cache). Not covered: real Dexie behaviour, GitHub against a live
repo, multi-tab.

---

## 3. Category verdicts

| #   | Category                            | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Round-trip fidelity & edit locality | **findings: #1, #2**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | Lost updates & conflict handling    | **findings: #3**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | Cache coherence & durability        | **findings: #4** — and _partially assessed_: real `cache.ts` transactions and the two-tab case were reasoned about, not reproduced (see coverage statement)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | Atomicity & partial failure         | **clean** — threat plan executed. `applyRemoteBatch` is a single Dexie transaction; `pushDirty` leaves un-pushed files dirty and pushed ones clean on a mid-loop throw; `markInFlight` is refcounted and cleared in a `finally` on both paths; `applyFuture`'s series split is a pure single-file operation, so it cannot half-apply. The one wart — a throw late in `pushDirty` skips `mergeChangedIntoStore(collisionMerges)`, leaving an already-written conflict copy invisible until the next reconcile — is recoverable and loses nothing, so it is below the bar for this report |
| 5   | Destruction & recoverability        | **findings: #4, #7** — `removeVault` was a suspect and is **refuted**: `VaultSettings.tsx` shows an explicit "N unsynced changes … will be lost" warning before `cacheDeleteAll`                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | Temporal correctness                | **findings: #5, #6, #8** — DST specifically **refuted**: `withTime`'s `startOfDay` + `setHours` keeps local wall-clock time across both Berlin transitions                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7   | Input validation & untrusted files  | **findings: #7**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 4. Findings

### Summary table

| #   | Finding                                                        | Invariant     | Failure mode              | Impact | Recommended model                  |
| --- | -------------------------------------------------------------- | ------------- | ------------------------- | ------ | ---------------------------------- |
| 1   | Every save discards frontmatter outside the 8-field model      | 1, 2          | **silent**                | 9      | Opus 5, plan mode, multi-PR        |
| 2   | New entry on a colliding slug overwrites the existing file     | 2, 7          | **silent**                | 9      | Opus 5 (Sonnet 5 if scoped)        |
| 3   | Local FS backend ignores the CAS contract on create and delete | 4             | **silent**                | 8      | Sonnet 5 if scoped, else Opus 5    |
| 4   | Delete-undo restores a whole-store snapshot                    | 2, 5, 6       | **silent**                | 7      | Sonnet 5                           |
| 5   | `end: {type: count}` is counted per query window               | 8             | **silent**                | 6      | Sonnet 5 if scoped, else Opus 5    |
| 6   | Month-end overflow moves and skips monthly/yearly occurrences  | 8             | **silent**                | 6      | Sonnet 5                           |
| 7   | One YAML typo removes a file from the vault, signal-free       | 7, validation | **silent** (console only) | 5      | Sonnet 5                           |
| 8   | 500-iteration cap hides daily series past ~16 months           | 8             | **silent**                | 5      | Haiku 4.5 if scoped, else Sonnet 5 |

**Sequencing note.** #5, #6 and #8 all live inside `generateScheduledDates`
(`src/model/expansion.ts:168–258`) — land them as one PR in the order **#6 → #5 → #8**
(cursor arithmetic first, then the count semantics that ride on it, then the iteration
budget, which has to be re-derived once the cursor is correct). #1 changes what
`collapseToYaml` consumes and #2 changes `applyNew`'s branch on `roots.has(fileSlug)`;
do **#1 before #2**, since #1's raw-node passthrough is what gives #2's "this slug is
already taken" check something to preserve when it forks the file. #3, #4 and #7 are
independent of everything else.

---

### #5 — `end: {type: count}` is counted per query window, so a bounded series repeats forever

- **Invariant violated:** 8 (temporal correctness). Every series using
  `end: { type: count }`, as soon as the user scrolls the calendar past the series' real end.
- **Category:** `temporal`
- **Failure mode:** **silent.** The phantom occurrences look exactly like real ones. A
  user notices only by counting.
- **Impact:** **6** — no byte is lost by expansion alone, but ticking or editing a phantom
  occurrence writes an `instances:` override into the file for a date the rule should never
  have produced, so the corruption does reach disk.

**Repro.** Starting file `s.md`, verbatim:

```markdown
---
title: Physio
date: "2026-01-05"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
  end:
    type: count
    occurrences: 3
---
```

Operation: `expandRange` over four different windows.

Observed:

```
Jan..Dec 2026 : 2026-01-05, 2026-01-12, 2026-01-19, 2026-01-26   (4 — anchor + 3)
Mar 2026 only : 2026-03-02, 2026-03-09, 2026-03-16
Jun 2026 only : 2026-06-01, 2026-06-08, 2026-06-15
2030 only     : 2030-01-07, 2030-01-14, 2030-01-21
```

Expected: `2026-01-05, 2026-01-12, 2026-01-19` in the first window and **nothing** in the
other three. Note the second defect visible here: the anchor is emitted outside the
counting loop, so `occurrences: 3` yields four.

Failing test to commit with the fix:

```ts
it("a count-bounded series yields the same occurrences regardless of the query window", () => {
  const p = parseToStoreItems(
    "s.md",
    [
      "---",
      "title: Physio",
      'date: "2026-01-05"',
      'time: "09:00"',
      "repeat:",
      "  type: schedule",
      "  freq: weekly",
      "  byweekday: [mo]",
      "  end:",
      "    type: count",
      "    occurrences: 3",
      "---",
    ].join("\n"),
  );
  const roots: Roots = new Map([["s", p.root]]);
  const all = expandRange(
    p.items,
    roots,
    new Date(2026, 0, 1),
    new Date(2026, 11, 31),
  );

  expect(all.map((o) => o.date)).toEqual([
    "2026-01-05",
    "2026-01-12",
    "2026-01-19",
  ]);
  expect(
    expandRange(p.items, roots, new Date(2026, 2, 1), new Date(2026, 2, 31)),
  ).toEqual([]);
  expect(
    expandRange(p.items, roots, new Date(2030, 0, 1), new Date(2030, 0, 31)),
  ).toEqual([]);
});
```

- **Breadth:** one function, `generateScheduledDates` (`src/model/expansion.ts:249–256`).
  Affects every series in every vault whose `repeat.end.type === 'count'` — the
  "repeat N times" option in `RepeatDialog`.
- **Recommended model:** **Sonnet 5 if the task states that counting must start at the
  anchor and be independent of `from`/`to`, and that the anchor slot is emitted separately
  at `expansion.ts:322` (the off-by-one); else Opus 5.** The hazard: the obvious fix —
  start iterating at `from` instead of the anchor — reintroduces window dependence in the
  opposite direction and would still pass a single-window test. The correct shape is
  enumerate-from-anchor-then-clip, which also changes what the `LIMIT` budget has to cover
  (see #8). Get this wrong and it fails silently: every individual window still looks
  plausible.
- **Evidence:** `src/model/expansion.ts:249` — `count` only increments for dates that
  survived the `>= from` / `<= to` filter:

  ```ts
    while (cursor <= maxDate && count < maxCount && iter++ < LIMIT) {
      const dates = matchesInPeriod(cursor).filter(d => d > anchor && d >= from && d <= maxDate && d <= to)
      for (const d of dates.sort((a, b) => a.getTime() - b.getTime())) {
        if (d > anchor && count < maxCount) { results.push(d); count++ }
      }
  ```

- **Problem:** a series the user bounded at N occurrences generates N _more_ occurrences
  in every window they scroll to, forever, and interacting with one writes a bogus
  override into the file.
- **Fix:** enumerate candidate dates from the anchor without the window filter, take the
  first `occurrences` of them (counting the anchor), and only then clip to `[from, to]`.
  After the fix the repro must return three dates in January and empty arrays for March,
  June and 2030.

---

### #7 — One YAML syntax error removes a file from the vault with no user-visible signal

**Status: fixed.** `parseFiles` now collects a `{path, slug, message}` failure per
unparseable file instead of only `console.warn`-ing; `reportParseFailures` toasts them
and the sync popover lists them persistently. Every failure's slug is also recorded in a
new `unreadableFiles` store field, kept out of `roots` so it can't masquerade as a real
entry — and `newEntrySlug`'s `slugTaken` check (see #2) now consults it too, so a new
entry whose title slugifies onto an unreadable file's slug is placed on a free one
instead of silently overwriting it on next save.

- **Invariant violated:** 7 (recoverability), plus the validation category. Any
  hand-edited file with a YAML syntax error — and hand editing is a headline feature.
- **Category:** `validation` `recoverability`
- **Failure mode:** **silent** in every sense that matters: a `console.warn` in a PWA the
  user has no devtools open for. The entry vanishes from the agenda, from search, and from
  wikilink resolution.
- **Impact:** **5** — the bytes are still on disk, so it is recoverable _if the user
  realises what happened_; but see the compounding path below, which makes it
  unrecoverable.

**Repro.** Five files loaded through the real `parseFiles`:

```markdown
good.md ---\ntitle: Good\ndate: "2026-04-08"\n---\n\nfine
bad.md ---\ntitle: Bad: with a colon\ndate: "2026-04-08"\n---\n\noops
tabs.md ---\ntitle: Tabs\ndefaults:\n\tdone: false\n---
dup.md ---\ntitle: A\ntitle: B\n---
also-good.md ---\ntitle: Also good\n---
```

Observed:

```
slugs that survived: [ 'good', 'also-good' ]
items: 2
```

Three ordinary hand-edit typos — an unquoted colon in a title, a tab used for indentation,
a duplicated key — each remove the file from the vault entirely. Expected: the entry
surfaces with a per-file error the user can act on ("couldn't read `bad.md`: line 1"),
not silence. The good news, and it is genuinely good: the rest of the vault loads fine —
one bad file does **not** block the others.

- **Breadth:** one function, `parseFiles` (`src/storage/sync.ts:38–51`) — the single load
  path for cache hydration (`hydrateFromCache`), reconcile merges (`mergeChangedIntoStore`)
  and every backend's initial read. Exposure is any vault file the user hand-edits.
- **Recommended model:** **Sonnet 5.** The hazard: a failed parse must not leave the slug
  looking _free_. Today an unparseable file is absent from `roots`, which is precisely what
  sends `applyNew` down its fresh-root branch (#2) and destroys the file. So the fix has to
  do two things — surface the error _and_ record the slug as occupied-but-unreadable — and
  the second one is invisible to any test that only checks the toast. A fix that adds
  error reporting and stops there looks complete and leaves the destructive path open.
- **Evidence:** `src/storage/sync.ts:44`:

  ```ts
  try {
    const parsed = parseToStoreItems(path, content);
    loaded.push(...parsed.items);
    roots.set(pathToSlug(path), parsed.root);
  } catch (e) {
    console.warn("[vault] parse failed for", path, e);
  }
  ```

  Worth noting alongside this: `src/model/AGENTS.md` describes `nodeSchema.ts` as a "Zod
  schema and TypeScript type for `RawNode`". The file contains no Zod and no runtime
  validation at all — it is eleven lines declaring an open TypeScript type. A reader
  trusting that doc would assume malformed files are rejected with a structured error.
  (The same file's layering table is stale in the way the survey brief suspected: it points
  persistence at `src/meridian.ts` and React state at `src/App.tsx`, neither of which
  exists.)

- **Problem:** a single typo in hand-edited frontmatter makes the entry disappear from the
  app with no explanation, and leaves its slug free for a later new entry to overwrite.
- **Fix:** collect per-file parse failures into store state, surface them in the UI, and
  reserve the slug so `applyNew` cannot claim it. After the fix the repro must still load
  `good` and `also-good`, and must additionally report three named, actionable failures.

---

### #8 — The 500-iteration cap hides daily series past roughly 16 months from their anchor

- **Invariant violated:** 8 (temporal correctness). Any high-frequency series (daily, or
  short-interval) once the queried window is more than `LIMIT` periods from the anchor.
- **Category:** `temporal`
- **Failure mode:** **silent** — no error — though the _consequence_ is visible: the entry
  is simply missing from the calendar.
- **Impact:** **5** — no bytes are lost and the file is intact, but a daily habit created
  18 months ago renders zero occurrences today, which reads to the user as data loss.

**Repro.** Starting file, verbatim:

```markdown
---
title: Meds
date: "2026-01-01"
time: "08:00"
repeat: { type: schedule, freq: daily }
---
```

Operation: `expandRange` over July 2027 and July 2029.

Observed:

```
Jul 2027 count: 0
Jul 2029 count: 0
```

Expected: 31 occurrences in each. The anchor is 2026-01-01; the loop advances one day per
iteration and stops after 500, i.e. around 2027-05-16 — everything beyond is silently
empty.

Failing test to commit with the fix:

```ts
it("a daily series still expands far beyond its anchor", () => {
  const p = parseToStoreItems(
    "meds.md",
    [
      "---",
      "title: Meds",
      'date: "2026-01-01"',
      'time: "08:00"',
      "repeat: { type: schedule, freq: daily }",
      "---",
    ].join("\n"),
  );
  const occs = expandRange(
    p.items,
    new Map([["meds", p.root]]),
    new Date(2029, 6, 1),
    new Date(2029, 6, 31, 23, 59),
  );
  expect(occs).toHaveLength(31);
});
```

- **Breadth:** one constant and one loop, `src/model/expansion.ts:248–249`. Affects every
  daily series older than ~500 days and every sub-daily interval proportionally; weekly
  series are safe for ~9.6 years.
- **Recommended model:** **Haiku 4.5 if the task states that the cap exists as a
  runaway-loop guard and must stay bounded — the fix is to skip the cursor forward to
  `from` before iterating, not to raise `LIMIT`; else Sonnet 5.** The hazard, and the
  reason the scoping matters: simply raising `LIMIT` turns an invisible-occurrence bug into
  an unbounded loop for a malformed `interval: 0`, and the seek-forward version must land
  the cursor on a real period boundary or every generated date shifts — which fails
  silently. Naming the approach makes this mechanical.
- **Evidence:** `src/model/expansion.ts:248`:

  ```ts
    let cursor = new Date(anchor)
    const LIMIT = 500; let iter = 0
    while (cursor <= maxDate && count < maxCount && iter++ < LIMIT) {
  ```

- **Problem:** a long-running daily entry silently stops rendering any occurrences once the
  view is more than ~500 periods from its anchor, so the user's oldest habits disappear
  from the calendar.
- **Fix:** advance the cursor to the first period boundary at or after `from` before
  entering the loop (keeping `LIMIT` as a guard sized to the window, not to the distance
  from the anchor). After the fix the repro must return 31 occurrences for July 2029.
  Land this **after** #5, since the correct counting semantics change what the loop must
  enumerate.

---

## 5. Verdicts on the brief's known suspects

| Suspect                                      | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `collapseToYaml` contract                | **Confirmed as written, but the contract is the wrong one.** All three hoisting branches and `hoistSharedMetadata` round-trip correctly for everything the store can represent — verified across all 13 fixtures plus adversarial multi-series input and post-`single`/`future` re-parse → re-expand. Its promise is "the most compact object that round-trips back to _the same store state_", and it keeps that promise. The loss (finding #1) happens upstream, before collapse ever runs: the store state itself has already discarded everything outside the 8-field registry. Hoisting specifically is **refuted** as a corruption source — a hand-authored per-instance `priority: high` on two sibling series is promoted to a shared root `defaults:`, but that is semantically identical and recomputed correctly when a third series diverges |
| Unknown / hand-authored frontmatter          | **Confirmed** — finding #1. Survives: `title`, `tags`, `items`, `done`, `participants`, `priority`, `duration`, `timezone`, `date`, `time`, `repeat`, `excluded`, `instances`, unicode/emoji/RTL, quoting-sensitive strings (`"2026"`, `"true"` stay strings). Does not survive: any other key at any nesting level, YAML comments, aliases, block scalars, the trailing newline, CRLF in the frontmatter (the body's CRLF is kept, giving a mixed-ending file), and known fields carrying an unexpected type                                                                                                                                                                                                                                                                                                                                            |
| `src/model/AGENTS.md` is stale               | **Confirmed, and worse than described.** The layering table still points persistence at `src/meridian.ts` and React state at `src/App.tsx`, neither of which exists. Beyond that, it describes `nodeSchema.ts` as "Zod schema and TypeScript type" — the file has no Zod and no runtime validation whatsoever, which is load-bearing for finding #7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| No property-based testing (`fast-check`)     | **Worth adopting, but not where the brief expected.** A generator over `RawNode` shapes asserting round-trip stability would **not** have found #1: the loss is a fixed point, and a generator that only emits representable shapes never produces an unknown key. Example-based fixtures are sufficient there — what was missing was one adversarial _fixture_, not a generator. Where fast-check would pay: the temporal engine. A single property — `expand(item, W₁ ∪ W₂) ⊇ expand(item, W₁)`, i.e. expansion is monotone in the query window — is ~20 lines and finds **#5 and #8 immediately**, and a second property (every generated date's day-of-month matches the rule) finds **#6**. Recommend `fast-check` scoped to `expansion.ts`, not to round-trip                                                                                      |
| `planReconcile` tests only cover happy paths | **Refuted.** `reconcile.test.ts` enumerates 17 cases across the real decision table: dirty-file-vs-remote-drift, tombstone-vs-still-listed, just-pushed skip, just-created skip, just-deleted-no-resurrection, and four cases around the delete grace window including its exact boundary. This is the best-tested logic in the codebase. The gap is one layer down — the CAS contract those decisions delegate to is verified only against a fake that behaves like GitHub while being labelled `kind: 'local'` (finding #3)                                                                                                                                                                                                                                                                                                                            |

---

## 6. Question for the user (normalization vs. corruption)

Finding #1 is the one place where I need a product decision rather than a fix:

**Is Meridian's file format normalized on save, or is it a document the app annotates?**

- If **normalized** — the fix is documentation plus a one-time warning ("Meridian rewrites
  frontmatter on save; keys it doesn't recognise are removed"), and the README's promise
  about hand-created files needs qualifying. Cheap, honest, and the current behaviour
  becomes intentional.
- If **annotated** — the fix is architectural: carry each YAML node's unparsed remainder
  through the store and re-emit it during collapse. This is the multi-PR path, and it is
  what makes "plain Markdown files in a folder you own — no lock-in" (the Tutorial vault's
  own words) actually true.

Everything else in this report is a defect with an obvious right answer. This one is a
choice, and it belongs to you.
