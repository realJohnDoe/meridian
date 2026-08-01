# Data Integrity & Durability Survey — Results

Survey run: 2026-07-31, branch `claude/data-integrity-durability-survey-57d9f7`, worktree `octokit-lazy-bundle-9ac43c`.
Brief: [health-survey-data-integrity.md](health-survey-data-integrity.md).

---

## 1. Integrity verdict

Yes — this app can lose the user's writing, and the two worst cases are both silent. The headline is **`resolveCollision` in `src/storage/sync.ts`: it overwrites the dirty cache record with the freshly-pulled remote content *before* it writes the user's version to a conflict copy**, so if that copy write fails (offline mid-sync, a rate-limited 403, an expired token) the local edit exists nowhere — not on the backend, not in IndexedDB — while the UI says "You're offline — changes are saved locally and will sync when you reconnect." The second-worst is structural rather than a slip: **inheritance is flattened at parse time and re-derived on collapse, and "cleared" is not representable in that round-trip** — emptying an occurrence's `participants`, or untracking one occurrence of a series, writes a file that re-inherits the old value from `defaults:` on the next load, so the change survives in the store until reload and then quietly reverts.

**These eight findings are not eight problems.** They are five architectural roots, set out in §2: the file is a *projection* of the store that nothing requires to be **total** (four separate leaks, findings #2/#3/#5/#8); **nothing ever reads back what it wrote**, which is why every one of those leaks is silent rather than loud; the one cache function permitted to destroy local content without a precondition is the one handling the hardest case (#1, #4); a **viewer preference is an input to a domain computation**, so the same file means different things on two devices (#6); and **store transitions don't report which files they touched**, so half the delete path forgets to persist them (#7). Fixing the eight one at a time would leave all five roots in place and the next leak just as invisible — §2 states the root fix for each, and every finding below carries a **Root** field saying which of them subsumes it.

The sync layer is otherwise in genuinely good shape — CAS is enforced by both writable backends, `planReconcile`'s decision table is fully enumerated by tests, and the in-flight/`markPushed`/`applyRemoteBatch` guards against mid-flight edits all hold up under direct probing. The damage is concentrated in the two error paths sync tests never enter, and in the model layer's collapse projection.

---

## 2. Architectural roots

Every finding below is a symptom. This section is the diagnosis: five structural properties of the design, what each one costs, and what the *root* fix is as distinct from the point fix. The per-finding **Fix** lines in §6 are deliberately scoped to one call site each — they are what you'd do if you were patching. If you'd rather fix the architecture, work this section instead and the findings fall out as consequences.

| Root | Property | Findings | Root fix | Tier |
|---|---|---|---|---|
| **A** | The file is a projection of the store, and nothing requires the projection to be **total** | #2, ~~#3~~ (fixed), #5, #8 | Define and enforce totality; close the remaining three leaks | Opus 5, plan mode / multi-PR |
| **B** | **Nothing reads back what it wrote** — the store is never compared against what actually landed | *why* A's leaks, and #7, are all silent | Two read-back checks (collapse totality at save, source fidelity at load), split into **B-test** (done — `round-trip-totality.test.ts`) and **B-runtime** (still open) — see below. ~162 ms/300 files | Sonnet 5 |
| **C** | The one cache transition allowed to destroy local content has an unenforced precondition | ~~#1, #4~~ (**fixed**) | Decision table landed; the cache-API type change is still open — see Root C | Sonnet 5 → Opus 5 |
| **D** | A viewer preference is an input to a domain computation | #6 | Take `weekStart` out of expansion; source recurrence semantics from the file | Opus 5 |
| **E** | Store transitions don't report which files they touched | #7 | Return the affected slug set from the transition | Haiku 4.5 |

**B is a ratchet, not a diagnostic — split it and put the halves at opposite ends.** An earlier draft of this report said "do B first" wholesale; measuring it showed that to be wrong. The runtime half **cannot be switched on today**: check 1 fires on every exclude (#3) and every cleared inherited field (#2), and check 2 on any file with a nested `title:` (#5), so shipping it early buys a detector you must leave muted until the leaks close. And for the leaks already found it is redundant — all four arrive with their own regression tests, which is the verification mechanism. Its real value is the *fifth* leak and regression prevention afterwards, and ratchets belong after the thing they protect is correct.

So: **B-test first** (the two checks as fixture-corpus assertions — zero false positives today, 18/18 fixtures clean, and it *is* Root A step 1), and **B-runtime last** (the prod `notify()`/refuse-to-write path, once turning it on is not an alarm). See §6 Sequencing for the full order and Root B below for the measured behaviour of each check.

---

### Root A — the projection isn't required to be total

The pipeline is `file → RawNode → EffectiveNode → StoreItem[] + FileMetadata → collapse → file`. After load, **the file is no longer the source of truth; the store is**, and every save regenerates the whole file from it. That is a legitimate design — but it makes one invariant load-bearing, and that invariant is written down nowhere:

> everything the file said must survive into the store, and everything the store holds must come back out.

Nothing owns it, no single function is responsible for it, and no test asserts it (see the round-trip note under Root B). So it leaks in four independent places, each a different *kind* of hole:

| Finding | Where it leaks | Kind |
|---|---|---|
| #5 | parse — `RESERVED_KEYS` filters a key out at a node with no `StoreItem` home | the store **cannot hold** it |
| #8 | parse — `loadFile` trims the body, `wrapFrontmatter` hardcodes `\n` | the store **never held** it |
| #2 | collapse — `inlineFieldEmpty` can't distinguish "cleared" from "never set" | the store holds it, the projection **can't express** it |
| #3 | collapse — `serializeChildren` has `c.metadata` in hand and emits `date`/`time`/`excluded` only | the store holds it, the projection **just doesn't emit** it |

Four leaks, one missing invariant. The `extra` bag is the project's own patch for this class, and its shape shows where the model stops: it hangs off `StoreItem`s and `FileMetadata`, not off *nodes of the YAML tree* — which is exactly why #5 exists, since a container node and a `title:` on a child are both tree positions with no `StoreItem` to attach to. `src/model/AGENTS.md` already lists #3, #5 and #8 among its "still-open losses," so the design knows the bag doesn't cover the tree; what it doesn't have is anything that would stop leak number five appearing.

**One genuinely hard sub-case.** #2 has two halves and they need different answers:

- **#2a (clear one occurrence)** is an *expressibility* problem. Making "cleared" emittable — an explicit `participants: []` / `done: null` on the diverging instance, read back as cleared by `parseInlineField` — fixes it without touching the parse pipeline.
- **#2b (clear the whole series, one override keeps the old value)** is a *provenance* problem. `buildEffectiveTree` merges `defaults:` into children and, per `EffectiveNode`'s own doc, `Fields carry plain values — no origin tracking.` So an override that merely *inherited* `participants: [alice, bob]` is indistinguishable from one that stated it, and collapse's diff correctly reports a divergence that the user never authored. Expressibility does not fix this. It needs either per-field provenance (explicit vs inherited) carried through the store, or a product decision that scope `all` rewrites overrides' inherited fields.

**Root fix, in order:** (1) write the totality invariant down, in `AGENTS.md` and as a test that asserts source→saved containment for a fixture set that includes CRLF, container nodes, and excluded instances with metadata — **done**, `round-trip-totality.test.ts`; (2) close #3 (**done**) and #5 (both mechanical once the invariant is stated); (3) make "cleared" expressible, fixing #2a; (4) decide #2b — provenance or edit semantics — as its own PR. **Resist starting at (4).** Retaining provenance means changing what `EffectiveNode` is, and that is the layer `AGENTS.md` correctly insists stays field-agnostic; steps 1–3 recover most of the loss without going there.

**What a bandage looks like here:** special-casing `excluded` in `serializeChildren`, or adding `title` to a second allow-list. Both close one leak and leave the invariant unowned.

---

### Root B — nothing reads back what it wrote

`commitNext` is `setData(next); slugs.forEach(writeEntity)`, and the registered implementation (`src/storage/index.ts:5`) is:

```ts
  writeEntity: slug => { void writeEntityToCache(slug) },
```

Fire-and-forget, returning `void`. The store is updated synchronously and unconditionally; the file is written asynchronously and **never verified against the store it came from**. `writeEntityToCache` collapses, serializes, hands the string to `recordLocalEdit`, and stops.

This is why every Root-A leak — and #7 — is *silent rather than loud*. In each case the store holds the correct value and the file holds a lossy one, and there is no mechanism anywhere that would notice: reconcile skips dirty records, so the next sync doesn't catch it either. The divergence materialises only on reload, when `hydrateFromCache` re-parses the file and the store finally learns what was actually written — hours or weeks after the edit, with no connection to the action that caused it.

This is the **highest-leverage item in the survey and the cheapest**. But it is **two checks at two different times**, not one — measured against the four A-class repros and all 18 fixtures:

| | **Check 1 — collapse totality** | **Check 2 — source fidelity** |
|---|---|---|
| Question | does the store survive its own serialization? | did the file lose anything the source had? |
| Compare | `normalizeIds(store)` vs `normalizeIds(parse(serialize(store)))` | `collectKeyValues` of source vs of saved, set containment |
| Runs at | **save** (`writeEntityToCache`, after `saveFile`) | **load** — on `serialize(parse(content))`, before any edit |
| Catches #2 | ✅ fires | ❌ clean (the loss is relative to the *edit*, not the source) |
| Catches #3 | ✅ fires | ✅ fires |
| Catches #5 | ❌ clean (the store never held the keys) | ✅ fires |
| Catches #8 | ❌ clean | ❌ clean — needs a **byte** compare, not a semantic one |
| 18 fixtures, unedited | clean | clean |
| Ordinary edit (`done: false` → `true`) | clean | 🔴 **false-positives** — reports `done=false` as lost |

Two consequences that decide the design:

- **Check 2 must never run on the save path.** Any intentional change looks like a loss to it — the control edit above fires on a plain checkbox toggle. It is only sound where no edit sits between the two sides, i.e. **at load**. That is the better place anyway: it fires while the original file is still intact on disk, *before* Meridian has written anything.
- **The parse-side leaks (#5, #8) are invisible to a save-time check**, because for those the store is already missing the data by the time you compare. This is why the split matters — one check does not cover Root A.

Cost, measured over a 300-file corpus built from the fixtures: parse alone **131.5 ms**, parse + serialize + re-parse **293.2 ms** — an added **~162 ms** for the whole vault, i.e. ~0.5 ms per file. Cheap enough to run in production (see the `notify()` note below); if a cold-start budget is tight, run check 2 lazily on first write attempt per slug and cache the verdict, which keeps the "before the damage" property at zero startup cost.

Note what this does **not** do: it does not fix a single finding. It is a **ratchet, not a diagnostic** — and that decides when each half lands:

- **B-test — DONE.** `src/model/__tests__/round-trip-totality.test.ts` implements both checks as reusable functions (`assertCollapseTotality`, `assertSourceFidelity`) and pins the leaks the fixture corpus didn't cover — an excluded instance carrying metadata (#3), a title on a non-root node (#5), and a narrower, non-normalisation-conflicting slice of #8 (a save must never mix CRLF and bare LF in one file) — as `it.fails` cases, so the suite stayed green while each was open. **Verified the ratchet actually ratchets**, not just documents: before landing #3's real fix, patching `serializeChildren` to emit the excluded child's diffed metadata was tried, and it flipped the case from expected-fail to `Error: Expect test to fail` — proof a real fix is required to close it, not just any change. #3's case has since been flipped to a normal `it` and moved into a "closed leaks" describe block — see finding #3's verification note. #5 and #8's narrow slice remain `it.fails`. The two blanket corpus suites (`yaml-roundtrip.test.ts`'s "preserves store structure", `unknown-keys.test.ts`'s "no key loss") were deliberately left untouched rather than folding the new fixtures into `fixtures/` — adding a known-failing case to an `it.each` sweep with no all-fixtures-pass guarantee would have gone red immediately; keeping the two classes separate is what lets this be a ratchet instead of a broken build.
- **Not built:** #2 has no fixture-corpus form — it only exists relative to an `applyEdit` call, which is out of scope for an *unedited* round-trip check. Its own repro (finding #2) is the thing that pins it.
- **B-runtime — still to do.** Wiring the checks into `writeEntityToCache` and the load path. It **cannot be switched on until the leaks close** (constraint 1 below), and for the four leaks already found it is redundant — each arrives with its own regression test. Its value is the *fifth* leak and regression prevention afterwards, which is precisely the value a ratchet has once the thing it protects is already correct.

An earlier draft of this report recommended doing B wholesale first. Measuring it showed that to be wrong: the runtime half would have spent the whole project muted.

**When B-runtime does land, run it in production, not just `import.meta.env.DEV`.** The codebase already made this call for the same class of problem — `reportParseFailures` toasts in prod, with the rationale spelled out in its doc comment: *"A `console.warn` alone is invisible in a PWA with no open devtools — this is the one user-visible signal that a hand-edited file silently dropped out of the vault."* A file Meridian would rewrite lossily is the same category of event. Three constraints on doing it well:

1. **Enable after closing the leaks, or it is a permanent alarm.** Today check 1 fires on every exclude (#3) and every cleared inherited field (#2), and check 2 fires on any file with a nested `title:` (#5). Ship the checks with the fixes, or land them logging-only first and flip to `warn()` per leak as each closes.
2. **Make the message actionable, and dedupe it.** Both checks already compute *what* was lost, so say so — "`trip.md` has frontmatter Meridian can't preserve: `title` on 2 instances. Editing it here will drop those keys." Dedupe per slug per session, the way `sync.ts` dedupes actionable errors with `_lastErrorSig`.
3. **Prefer refusing to write over warning about a write.** The strongest use of check 2 is not a toast at all: a file that fails it is one Meridian *cannot round-trip*, which is a weaker form of the condition `unreadableSlugs` already models. Marking it read-only (or gating the first edit behind a confirmation) turns the detector into recoverability — the loss never happens rather than being reported after the fact.

**The test suite has the same blind spot, from the same cause.** `yaml-roundtrip.test.ts` asserts `serialize(parse(serialize(f))) === serialize(f)` — a fixed point on Meridian's *own* output — so the loss on the first pass is invisible to it by construction. `unknown-keys.test.ts` exists because someone spotted this and asserts against the source instead, but only for the `extra`-bag class. Separately, `src/storage/cache.ts` sits at 3.73% statements because `sync.test.ts` mocks it with a hand-written **re-implementation**: the tests verify `sync.ts` against a second copy of the cache's logic rather than against the cache. Both are the same architectural habit — treating the store as authoritative and the file as derived — reproduced in the tests.

---

### Root C — the escape hatch was carved for the highest-risk path

`src/storage/cache.ts`'s header describes discipline that is genuinely good:

> Six transitions cover every way a record's status can legitimately change. Each is a single transaction with its precondition built in, so "don't clobber a locally-modified record" is not a rule call sites must remember — there is no function that does an unconditional clean write except `setResolvedClean`, which exists solely for `resolveCollision`'s two intentional overwrites (the local content has already been copied out by the time it's called).

The parenthetical is finding #1 in full. The invariant is stated, the single exemption is named, and **the exemption's stated precondition is false in program order** — `setResolvedClean` runs *before* the copy write, not after. The one function permitted to destroy local content without a precondition is the one handling the case where local content is most at risk, and the comment asserting otherwise is what stopped anyone re-checking.

The missing structural piece: there is nowhere to express *"the user's content must exist in at least one durable place at every instant."* If the transition API had no way to say "discard local content" without evidence of a copy — e.g. `setResolvedClean(vaultId, path, remote, { copiedTo })` requiring a confirmed path — #1 would be **unrepresentable** rather than merely untested. #4 is the same function's other missing branch (`if (fresh)` silently no-ops when the remote file is gone, leaving the record dirty forever), which is why the two must be fixed together rather than in sequence.

A second-order instance of the same confusion: `isTransientSyncError` classifies by **transport**, and the UI then asserts a fact about **storage** — *"changes are saved locally and will sync when you reconnect."* In #1 the transport classification is correct and the sentence is a lie, because whether changes are saved locally is a property of the cache that nothing consults before saying so. Any fix should derive that message from the cache's actual state.

**Root fix:** give `resolveCollision` a total decision table over {remote present, remote gone} × {copy written, copy failed}, and encode the "content must survive somewhere" precondition in the cache API's type rather than in a comment. **Tier: Sonnet 5** if the task states the ordering constraint and the API change explicitly; **Opus 5** otherwise — the naive reorder creates the mirror bug (an orphan copy with no cache record when the *re-read* fails), and both `pushed` (feeding `planReconcile`'s `skipPaths`) and `collisionMerges` (feeding `mergeChangedIntoStore`) must stay consistent with whichever half completed.

**What a bandage looks like here:** swapping the two statements in `resolveCollision`. That fixes #1's repro and leaves the next caller of `setResolvedClean` free to do the same thing again.

**Verification — landed (#1 + #4 in one PR, three commits).**

`resolveCollision` is now a decision table rather than a linear path with an `if (fresh)` bolted on:

| case | behaviour |
|---|---|
| remote diverged | copy the local content out **first**, then revert the original to remote |
| remote gone | re-create the local content **at its original path**, warn, done — no copy |
| copy write fails | record stays `dirty`, error rethrown; the edit is never in neither place |
| copy path already taken (same second) | walk the timestamp forward until a free name is found |
| path re-created mid-resolution | fall back to the diverged case — there is remote content to preserve after all |

- **Policy resolved, and it made the codebase more consistent, not less.** The remote-gone case restores at the original path (see #4's verification for why). That is the same rule `pushDirty`'s tombstone branch already applied from the other side — **an edit beats a delete** — which was previously two unrelated-looking behaviours and is now one stated rule.
- **Red-then-green confirmed, not assumed.** With `sync.ts` stashed back to its pre-fix state and the new tests kept, **4 of the 5 new tests fail**; all pass after. The fifth (`falls back to a conflict copy if the path is re-created mid-resolution`) passes against both — under the old code trivially, because `!fresh` fell straight through to the copy path — so it pins the new fallback branch rather than proving a fix, and is labelled as such here rather than counted as a regression test.
- **Two extra defects fixed in the same rewrite, named rather than smuggled.** (a) The same-second copy collision found during the survey: `conflictPath` is second-granular, so two conflicts on one path produced the same name and the second write's `ConflictError` escaped `resolveCollision` to be reclassified as an actionable sync failure. `writeConflictCopy` now retries with the timestamp walked forward — a counter suffix would be eaten by `conflictPath`'s own `SUFFIX_RE` the next time that copy conflicted. (b) `backend.write` returns a version token only *"if the backend can determine it"*; recording a bare `undefined` would make the next edit to that file CAS with no precondition — which every backend reads as *"must be absent"* — so a file that plainly exists would conflict for no reason. `versionAfterWrite` falls back to a read. The original code did this defensively for the copy path only; it now applies to the re-create path too.
- **~15 lines of dead code removed.** `resolveCollision`'s `cacheMap` parameter and both `if (cacheMap)` blocks were never reachable — the sole caller passes four arguments. Carrying them through the rewrite would have preserved dead branches in the one function being made legible. (`CacheRecord` stays imported; `planReconcile` still uses it.)
- **Not done: the cache-API type change.** The root fix above also calls for encoding "content must survive somewhere" in `setResolvedClean`'s signature so the next caller cannot repeat #1. That is still a comment, not a type. The decision table makes the current caller correct; it does not make the mistake unrepresentable. Worth doing when a second caller ever appears.
- Full suite **76 files / 933 passed + 2 expected-fail**, `pnpm run lint` 0 errors, `pnpm run build` exit 0.

---

### Root D — a viewer preference is an input to a domain computation

`expandRange(items, roots, from, to, weekStart)` makes the occurrence set a function of *(file, viewer)*. Everything downstream — including the edit path, which writes overrides keyed by expanded dates — treats it as a function of *(file)*. That mismatch is #6, and it is why the damage escapes into the file instead of staying on screen: an override written on a Monday-first device lands on a date that a Sunday-first device's schedule does not contain, and surfaces there as a phantom `source: 'explicit'` occurrence.

The tell is that `weekStartsOn(localePrefs)` has two legitimate roles that were never separated: **view layout** (`MonthView.tsx:34`, `DatePickerDialog.tsx:78` — correctly locale-dependent) and **recurrence semantics** (`expansion.ts`'s weekly branch — must not be). One value, two meanings, no boundary.

The general rule the codebase is missing: **anything that reaches `expandNode` must come from the file, or cross-device agreement breaks.** Today only `weekStart` violates it; nothing prevents the next parameter. That rule belongs in `src/model/AGENTS.md` next to the existing layering rules, and it is enforceable — `expandNode`'s inputs are a short list.

**Root fix:** ground the `byweekday` week on the series anchor, or persist a `wkst` in the repeat block (RFC 5545's answer), and keep `localePrefs` for layout only. **Tier: Opus 5** — any change here re-dates every existing biweekly series in every vault, so it needs a migration decision; and `src/model/__tests__/weekStart.test.ts` currently pins *both* behaviours as correct, so the fix has to argue with an existing test rather than just make it pass. The trap: "just hardcode Monday" is correct in the author's locale and silently wrong in the US.

---

### Root E — store transitions don't report their blast radius

`deleteByFileSlug` strips backlinks from *other* files' roots, but the set of files it touched is not in its return value — it returns only the new `StoreData`. So `commitDelete(next, slug, backlinkSlugs)` requires the caller to independently re-derive that set via `getBacklinks()`. The editor's delete path does (`src/editor/save.ts:171-173`, `:185-187`); the swipe path doesn't (`src/occurrenceActions.ts:124-126`). That is #7 — an API where the correct call is harder than the incorrect one.

The general shape: `writeEntity(slug)` takes a slug, so every `commitNext(next, [slug])` site must independently know which slugs the transition dirtied. Nothing derives it from the transition. Search: `grep -rn "commitNext(\|commitDelete(" src --include=*.ts --include=*.tsx | grep -v __tests__` → **15 call sites**, each a place to forget one.

**Root fix:** have store transitions return `{ data, affectedSlugs }` and have `commitNext`/`commitDelete` persist exactly that set. This closes the class rather than #7, and it makes Root B's read-back check trivially correct — it would then verify precisely the slugs the transition claims to have written. **Tier: Haiku 4.5** for the mechanical propagation once the signature change is decided; the undo half of #7 stays Sonnet 5 (see the finding).

---

## 3. Coverage statement

### Probed with real reproductions

| Invariant | How |
|---|---|
| 1 round-trip fidelity | 12 adversarial hand-authored files through `parseToStoreItems` → `collapseToYaml` → `saveFile`, comparing against the **source**, not against Meridian's own output |
| 2 edit locality | `applyEdit` at all four scopes on a series with a `defaults:` block and an override; `excludeOccurrence`; `deleteFollowing` |
| 3 expansion ↔ collapse | drove the three hoisting branches (flat single, single-series-with-instances, container) with clear-a-field and exclude-an-instance edits |
| 4 no lost update | real `syncToBackend()` against a fake `StorageBackend`, with an injected failure on the conflict-copy write and with the file deleted remotely |
| 5 cache coherence | reconcile cycles with clock control (`vi.setSystemTime`) over 4 sync ticks |
| 7 recoverability | `beginSwipeDelete` + Undo under jsdom with the real store, toasts and fake persistence |
| 8 temporal | biweekly `byweekday` expansion at `weekStart` ∈ {0,1,6}; a daily 02:30 series across the Europe/Berlin spring-forward (`TZ=Europe/Berlin`); a monthly series anchored on the 31st |

### Reasoned about statically only

- **Invariant 6 (durability)** beyond the conflict path. `writeEntity` is fire-and-forget (`src/storage/index.ts:5`, `void writeEntityToCache(slug)`); the window between `setData` and the Dexie write landing is real but I did not build a kill-the-tab harness. `pagehide` + `visibilitychange` flushes are wired (`src/routes/__root.tsx:62-66`) and tested.
- **Two tabs of the same vault.** There is no `BroadcastChannel`, `storage` event, or Dexie observable anywhere in `src/` (searched `BroadcastChannel|addEventListener\('storage'|liveQuery`— zero hits). Tab B's in-memory store never learns about Tab A's edits, so B's next `writeEntityToCache` collapses from a stale store and overwrites A. **Unverified** — settling it needs a two-store harness, which the current test-utils don't support.
- **IndexedDB quota / `QuotaExceededError`.** Never handled: `recordLocalEdit`'s rejection is caught by `writeEntityToCache`'s `catch` → `notifyError('Save failed', e)`, so it is loud, but the edit is then only in memory with no retry. **Unverified.**

### Skipped, with reason

- **Live local-FS and GitHub backends.** As the brief anticipated: the automated browser cannot grant File System Access permission or complete the GitHub OAuth flow. Both were read end to end and compared against `backend.ts`'s contract statically, and exercised through `fs.test.ts` / `githubBackend.test.ts`. `LocalBackend` itself has **0% coverage** (it is a pure delegation shell over `fs.ts`).
- **The `meridian_bigvault` generator.** Not used. Nothing in the findings is volume-dependent; the one scale-sensitive path (`LARGE_RECONCILE_THRESHOLD` routing through `readAll`) already has a 51-file test in `sync.test.ts`.
- **`fast-check` dry run.** Not installed, and I did not add it — see the verdict on that suspect below.

### Backends: exercised vs traced

| Backend | Status |
|---|---|
| Fake in-memory `StorageBackend` (mirrors GitHub's PUT-without-sha-is-a-create semantics) | **exercised** — drove the real `syncToBackend`/`reconcileWithBackend` |
| `ExampleBackend` | **exercised** by the app's own suite; `readOnly = true` so no write path exists |
| `LocalBackend` / `fs.ts` | **traced** + its own unit tests; CAS logic in `diskWrite`/`diskDelete` read line by line |
| `GitHubBackend` / `githubApi.ts` | **traced** + its own unit tests |

Vaults used: the 16-file shipped Tutorial vault (`exampleBackend.ts`), the 18 `src/model/__tests__/fixtures/*.md`, and ~15 hand-written adversarial files created for this pass.

### Quality gates (single run each)

| Gate | Result |
|---|---|
| `pnpm run build` | **PASS** (exit 0) |
| `pnpm run lint` | **PASS** — 0 errors, 14 pre-existing warnings (all `react-hooks/incompatible-library` on TanStack Virtual/Router) |
| `pnpm test` | **PASS** — 75 files, 926 tests (survey run). Since: 926+3 expected-fail after B-test; 928+2 after #3; **933 passed + 2 expected-fail after Root C (#1+#4)** — see §2 Root B/Root C and findings #1, #3, #4 |
| `pnpm run test:coverage` | **PASS** — all thresholds met. Totals 61.69% stmts / 58.19% branch / 64.02% lines |

Coverage pointers worth acting on (pointers, not findings):

- **`src/storage/cache.ts`: 3.73% statements, 0% branches.** Every real Dexie transaction — `recordLocalEdit`, `markPushed`, `applyRemoteBatch`, `recordLocalDelete`, `confirmDeleted` — is exercised only through **hand-written re-implementations** in `sync.test.ts`'s `vi.mock('@/storage/cache')`. The mock and the real code agree today because someone kept them in sync by hand; nothing enforces it. This is the least-defended integrity-critical file in the repo — and, per §2 Root B, it is the same blind spot as the production code: the tests verify `sync.ts` against a second copy of the cache's logic rather than against the cache.
- `src/storage/localBackend.ts`: 0%. `src/model/inheritance.ts`: 67% (the `mergeValue` sum-type / product-dict branches at lines 70 and 75 are never taken).

### Fraction of the integrity-critical surface

Roughly **75–80%**. The parse/serialize pipeline, all four `applyEdit` scopes, the collapse hoisting branches, `planReconcile`, `pushDirty`, `resolveCollision`, `reconcileWithBackend` and the expansion engine were all read end to end and probed. The gaps are the ones named above: real-Dexie behaviour, live backends, multi-tab, and quota.

---

## 4. Category verdicts

Categories are the brief's taxonomy; the **Root** column maps them onto §2's, which is the axis to fix along.

| # | Category | Verdict | Root |
|---|---|---|---|
| 1 | Round-trip fidelity & edit locality | **findings: #2, #3, #5, #8** | all four are Root **A**, silent because of **B** |
| 2 | Lost updates & conflict handling | **findings: #1, #4** | both Root **C** |
| 3 | Cache coherence & durability | **partially assessed** — `planReconcile`, `markPushed`, `applyRemoteBatch` and the in-flight registry were probed and are clean; multi-tab and IndexedDB quota were reasoned about only (see coverage statement) | — |
| 4 | Atomicity & partial failure | **findings: #1, #4** — `markInFlight`/`clearInFlight` pairing was checked at every call site and is `finally`-guarded; `applyRemoteBatch` is a single Dexie transaction | **C** |
| 5 | Destruction & recoverability | **findings: #3, #7** | **A** + **E** |
| 6 | Temporal correctness | **findings: #6** — DST, month-end overflow, leap-day and count-vs-window independence were all probed and are correct | **D** |
| 7 | Input validation & untrusted files | **clean** — a malformed file fails per-file with a user-visible toast (`reportParseFailures`), its slug is reserved via `unreadableSlugs` so a new entry cannot overwrite it, and `titleToSlug` collisions are resolved with a `-2`/`-3` suffix. This is genuinely well built. (The nested-node key drop is filed under round-trip as #5.) | — |

---

## 5. Verdicts on the brief's "known suspects"

| Suspect | Verdict |
|---|---|
| `collapseToYaml` is "the most compact object that round-trips back to the same store state" | **Confirmed false**, three ways: #2 (a cleared inherited field does not round-trip), #3 (an excluded instance's metadata does not round-trip), #5 (a key with no `StoreItem` home does not round-trip). The three hoisting branches themselves are correct — `hoistSharedMetadata`/`computeSharedFields`/`diffMetadata` hoist and diff soundly, including `deepEqual` on nested unknown values. The claim fails on *what reaches* the hoisting, not on the hoisting. |
| Unknown / hand-authored frontmatter | **Mostly refuted, one real hole.** Unknown keys, explicit `null`, empty lists, nested mappings, and known-fields-with-wrong-types all survive — `unknown-keys.test.ts` and `extras-preservation.test.ts` are thorough and the `extra`-bag design works. The hole is #5: `title`/`tags`/`items` on a non-root node, and *all* keys on an intermediate container node, are filtered out by `RESERVED_KEYS` / dropped by the container branch and land nowhere. Comments, anchors/aliases, key order and quoting are lost — deliberately, per `AGENTS.md`. |
| `src/model/AGENTS.md` has drifted | **Confirmed**, and worse than the brief guessed. The layering table still points at `src/meridian.ts` and `src/App.tsx` (neither exists). `nodeSchema.ts` is described as holding a **Zod schema** — it is 11 lines of `type RawNode`, with no Zod anywhere in `package.json`; there is no validation layer at all. `storeItems.ts` is documented as exporting `parseYamlToStoreItems` — it doesn't. Against that, the *invariants* in the "Unknown-key preservation" section held up under adversarial probing, and its "Deliberate non-goals / still-open losses" paragraph honestly pre-declares #3, #5 and #8. The docs are stale on structure but honest on semantics. |
| No property-based testing | **Refuted as a priority.** I found all eight findings with hand-authored examples, and none of them would have been caught by a generator over well-formed store states: #2, #3 and #5 are all cases where the *input space the generator would sample from* (valid `StoreItem[]`) already excludes the shape that breaks. `fast-check` over `StoreItem[] → collapse → parse → StoreItem[]` would be a genuine ratchet for the hoisting algorithm — which is the part that is already correct. **Recommendation: don't install it yet.** Fix #2/#3/#5 first, then, if you want the ratchet, generate *source YAML* (not store states) and assert set-containment of key/value pairs, which is the assertion `collectKeyValues` already implements. |
| `planReconcile` tests only happy paths | **Refuted.** `reconcile.test.ts` enumerates 16 cases across all four decision branches: never-seen, version-drift, dirty + remote-changed, tombstone + still-listed, skipPaths for just-pushed/just-created/just-deleted, vanished-file drops for clean/dirty/tombstone, and four grace-window boundary cases including the exact boundary. This is the best-tested code in the survey. What *isn't* tested is `resolveCollision` — the function `planReconcile` hands off to — which is where #1 and #4 both live. |

---

## 6. Findings

### Summary table

| # | Finding | Root | Invariant | Failure | Impact | Breadth | Model (point fix) |
|---|---|---|---|---|---|---|---|
| 1 | ~~`resolveCollision` reverts the cache before the copy is safe~~ — **FIXED** | **C** | 4, 6, 7 | **silent** | 9 | 1 fn, all backends, every conflicting write | Sonnet 5 (with the ordering constraint stated) |
| 2 | Clearing an inherited field silently reverts on reload | **A** | 1, 2, 3 | **silent** | 7 | every file with a `defaults:` block | Opus 5, plan mode / multi-PR |
| 3 | ~~Excluding an occurrence discards everything on it~~ — **FIXED** | **A** | 1, 2, 7 | **silent** | 7 | 1 line, 3 prod callers, every recurring entry | Sonnet 5 |
| 4 | ~~Remote-deleted + local edit ⇒ one conflict copy per sync tick, forever~~ — **FIXED** | **C** | 4, 5 | **loud, unbounded** | 6 | 1 fn, all backends | Sonnet 5 |
| 5 | Frontmatter on a node with no `StoreItem` home is deleted | **A** | 1 | **silent** | 6 | hand-authored multi-event files | Sonnet 5 (with the ownership rule stated) |
| 6 | Biweekly `byweekday` series expand differently per device locale | **D** | 8, 2 | **silent** | 6 | `freq: weekly` + `interval ≥ 2` + `byweekday` | Opus 5 |
| 7 | Swipe-delete Undo doesn't restore the wikilinks it removed | **E** | 7, 2 | **silent** | 5 | 1 of 2 delete paths | Sonnet 5 |
| 8 | Body whitespace and CRLF rewritten on every save | **A** | 1 | **silent** | 3 | **every file, every save** | Haiku 4.5 |

Ranked by `(impact × breadth) ÷ effort` with the scoring guidance's tiebreakers (silent > loud, unrecoverable > recoverable) applied. #1 leads on unrecoverability; #8 ranks high on the raw formula (breadth = all files, effort = 1) and is listed last only because its impact is genuinely small — re-sort freely.

**The "Model (point fix)" column costs the patch, not the cure.** Each entry is the tier for the one-call-site change described in that finding's **Fix** line. If you are working §2 instead, use the tiers in the roots table there — they are different, and mostly higher, because a root fix is load-bearing judgement where a point fix is mostly mechanical.

### Sequencing

**Root-first (recommended).** This order never patches the same file twice and keeps the suite green at every step:

1. **B-test — done.** `src/model/__tests__/round-trip-totality.test.ts`. See Root B for what it covers, what it deliberately doesn't (#2), and the verification that the ratchet actually flips.
2. **#3 — done.** One line in `serializeChildren` plus two regression tests (`edits.test.ts`) and the B-test ratchet flip (`round-trip-totality.test.ts`). See finding #3's verification note for what was checked before landing it: every pre-existing exclude test traced by hand and confirmed not to regress, and the ratchet confirmed to require the real fix rather than any change.
3. **Root C — done (#1 and #4 together).** `resolveCollision` is now a decision table. Landed as one PR because the two are independent defects in the same 48-line function — neither fix implies the other, but the end state is one structure and the intermediate state is incoherent. The cache-API precondition (making #1 unrepresentable rather than merely fixed) is still open; see Root C's verification block.
4. **#5**, then **#8**, the remaining mechanical A leaks in `src/model/collapse.ts` + `src/types.ts`. #5 changes where the parse side routes reserved keys; #8 needs a **byte** compare and a CRLF fixture, which neither semantic check catches.
5. **#2a** (make "cleared" expressible), then **#2b** as its own PR once provenance vs. edit semantics is decided. #2 changes the emit predicates (`inlineFieldEmpty`, `diffMetadata`) and will conflict with #5 if taken before it — #3 is already landed, so that conflict no longer applies.
6. **Root E** — the `{ data, affectedSlugs }` signature change, then #7's undo half by hand.
7. **Root D** — #6, gated on the migration decision and on rewriting `weekStart.test.ts`.
8. **B-runtime** — wire the two checks into `writeEntityToCache` and the load path, and flip them from logging-only to `warn()` (or to refusing the write, per Root B's third constraint). By this point they are quiet on a correct vault, so enabling them is a ratchet rather than an alarm.

**Steps 2 and 3's severity-vs-frequency tradeoff is now moot — #3 landed first regardless, and it was cheap enough (one line, two tests) that it barely delayed Root C either way.** For the record, the reasoning that would have applied to a costlier #3: severity-first says C before #3, since #1 is total, silent, unrecoverable loss of an edit (impact 9); frequency-first says the reverse, since #1 needs a conflict *and* a network failure inside a ~1-second window (rare-but-catastrophic) while #3 fired on every delete of a recurring occurrence carrying data (single device, no conflict required). Keep that framework for any future case where step ordering is genuinely expensive to get wrong.

**Patch-first**, if you want the bleeding stopped before any restructuring: **#1 → ~~#3~~ (done) → #5 → #7**, which is the same file ordering with the roots left in place. Note that #2 has no safe point fix — every version of it is a change to the emit predicates, which is why it carries a plan-mode tier in the table above.

---

### #1 — `resolveCollision` reverts the local edit before the conflict copy is durable — **FIXED**

- **Invariant violated:** 4 (no lost update), 6 (durability of accepted writes), 7 (recoverability). Fires whenever a CAS write conflicts *and* the follow-up conflict-copy write fails — i.e. a network drop, a GitHub rate limit, or an expired token landing in the ~1-second window between the two calls. Both writable backends, any file.
- **Category:** `lost-update` `durability` `atomicity` `recoverability`
- **Root:** **C** — the destructive cache transition's precondition lives in a comment, not in the API. The root fix makes this state unreachable rather than merely untested; see §2 Root C.
- **Failure mode:** **Silent.** `TransientSyncError` is classified as offline, so `runSync` reports `setSyncOffline(true)` and — on a manual sync — toasts *"You're offline — changes are saved locally and will sync when you reconnect."* That sentence is false for this file. A user would notice only by reopening the entry after a reload and finding the other device's version. If the failure is a 401 instead, the toast says "Sync failed" — equally uninformative about the destroyed edit.
- **Impact:** **9**

**Repro.** Starting state — backend holds `task.md` at version `sha1`; another device pushes `REMOTE v2`; our cache holds an unpushed local edit derived from `sha1`:

```
cache:   { path: 'task.md', content: 'MY PRECIOUS LOCAL EDIT', status: 'dirty', version: 'sha1' }
backend: { path: 'task.md', content: 'REMOTE v2', version: 'v1' }
```

Operation sequence: `syncToBackend()`, with the backend configured to throw `TransientSyncError('Failed to fetch')` on any write to a path matching `^task_\d` (the conflict copy).

**Observed:**

```
cache after:      [{ path: 'task.md', content: 'REMOTE v2', status: 'clean', version: 'v1' }]
backend files:    ['task.md']
syncError:        null
syncOffline:      true
cache after a 2nd sync: unchanged — 'MY PRECIOUS LOCAL EDIT' is gone for good
```

**Expected:** the local content is either on the backend as a conflict copy, or still `dirty` in the cache for the next cycle. It must never be in neither place.

Failing regression test (drop into `src/storage/__tests__/sync.test.ts`, which already has the `FakeBackend` and cache-mock wiring; add `failWritesTo` to that class):

```ts
describe('pushDirty — a conflict-copy write that fails must not destroy the local edit', () => {
  it('keeps the local content recoverable when the copy write fails mid-resolution', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    setActiveBackend(backend)
    await backend.write('task.md', 'REMOTE v2', 'sha1')      // another device pushed first
    seedDirty('fake-vault', 'task.md', 'MY LOCAL EDIT', 'sha1')
    backend.failWritesTo(/^task_\d/)                          // network dies on the conflict copy

    await syncToBackend()

    const copy = backend.listPaths().find(p => p !== 'task.md')
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    // The local edit must survive somewhere: either copied out, or still dirty.
    expect(copy ? backend.get(copy)!.content : cached?.content).toBe('MY LOCAL EDIT')
  })
})
```

- **Breadth:** one function, but it gates every conflicting write on every backend. Search: `grep -rn "resolveCollision" src` → 2 hits (definition + the single call in `pushDirty`). Every `.md` file in every writable vault is exposed.
- **Recommended model:** **Sonnet 5 if the task states the ordering constraint explicitly** ("write and verify the conflict copy before `setResolvedClean` touches the original's record; on any failure leave the record `dirty` and rethrow"); **else Opus 5**. The hazard that sets the tier: a naive reorder creates the mirror bug — an orphan conflict copy with no cache record when the *re-read* fails instead — and both `pushed` (which feeds `planReconcile`'s `skipPaths`) and `collisionMerges` (which feeds `mergeChangedIntoStore`) must stay consistent with whichever half completed, or the next reconcile re-pulls stale content over the resolution. It fails silently either way, which is why the constraint has to be in the prompt rather than left to judgement.
- **Evidence** — `src/storage/sync.ts:108-131`:

```ts
  const [fresh] = await backend.readFiles([path])
  if (fresh) {
    await setResolvedClean(vaultId, path, fresh.content, fresh.version)
```

  …and only afterwards:

```ts
  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)
```

  `setResolvedClean` is documented in `src/storage/cache.ts:127` as safe precisely because *"the local content has already been copied out to a conflict-copy path first"* — which, in program order, it has not been.
- **Problem:** a conflict resolution that fails halfway leaves the user's unpushed edit in neither the cache nor the backend, while the UI claims it is saved locally.
- **Fix:** write (and confirm) the conflict copy first, then `setResolvedClean` the original; on any error from the copy write, leave the original record `dirty` and rethrow. After the fix the repro's assertion passes via the `dirty` branch on the first cycle and via the copy on the next. **Root fix (preferred):** do this as part of Root C's decision table + cache-API precondition, so the next caller cannot repeat it.

**Verification — fixed as part of Root C.** `resolveCollision` now writes the conflict copy first and only then reverts the original's cache record; any failure in between leaves the record `dirty` and rethrows, so the edit is retried next cycle. Confirmed red-then-green: with `sync.ts` reverted to its pre-fix state the new test `keeps the local edit recoverable when the conflict-copy write fails mid-resolution` fails, and passes after. See Root C's verification block.

---

### #2 — Clearing a field inherited from `defaults:` silently reverts on reload

- **Invariant violated:** 1 (round-trip fidelity), 2 (edit locality), 3 (expansion ↔ collapse agreement). Every save, on any file whose collapse shape produces a `defaults:` block — which is *every* series with instances, i.e. the shape Meridian itself writes.
- **Category:** `round-trip` `edit-locality`
- **Root:** **A** — the projection can't *express* "cleared". #2a (one occurrence) is fixed by expressibility; **#2b (whole series) is the one genuinely hard sub-case in the survey** and needs provenance or an edit-semantics decision — see §2 Root A.
- **Failure mode:** **Silent, and actively misleading.** The store keeps the cleared value, so the UI shows the change as applied and the sync indicator goes green. The value reappears on the next reload, on another device immediately, and there is no error anywhere. A user would notice as "the app keeps re-adding Bob to my Tuesday standup."
- **Impact:** **7**

**Repro (symptom a — clear on one occurrence).** Starting file `ts.md`, verbatim:

```yaml
---
title: Team Standup
date: 2026-04-06
time: "09:00"
participants: [alice, bob]
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
instances:
  - date: 2026-04-13
    done: true
---
```

Operation: open the 2026-04-20 occurrence, choose scope **"This event"**, remove both participants, save (`applyEdit(..., 'single', { participants: [] })`).

**Observed** file written:

```yaml
---
defaults:
  done: false
  participants:
    - alice
    - bob
title: Team Standup
date: 2026-04-06
time: 09:00
repeat: {...}
instances:
  - date: 2026-04-13
    done: true
  - date: 2026-04-20
    time: 09:00          # ← no `participants:` key at all
---
```

Re-parsing that file gives **every** occurrence, including 2026-04-20, `participants: ["alice","bob"]`. **Expected:** 2026-04-20 has no participants.

**Repro (symptom b — clear on the whole series).** Same file, scope **"All events"**, remove both participants. Observed output keeps `participants: [alice, bob]` on the 2026-04-13 instance — an "All events" edit that reaches all but one event, because that override's metadata was materialised from the inherited value at parse time and now reads as a divergence.

The same mechanism breaks untracking: scope "This event" + `tracked: false` writes a bare `- date: 2026-04-20, time: 09:00` and the occurrence comes back as a task with `done: false`.

Failing regression test (`src/model/__tests__/`):

```ts
it('clearing an inherited field on one occurrence does not come back on reload', () => {
  const src = [
    '---', 'title: Team Standup', 'date: 2026-04-06', 'time: "09:00"',
    'participants: [alice, bob]',
    'repeat:', '  type: schedule', '  freq: weekly', '  byweekday: [mo]',
    'defaults:', '  done: false',
    'instances:', '  - date: 2026-04-13', '    done: true', '---',
  ].join('\n')
  const p = parseToStoreItems('ts.md', src)
  const roots = new Map([['ts', p.root]])
  const occ = expandRange(p.items, roots, new Date(2026, 3, 1), new Date(2026, 4, 31))
    .find(o => o.date === '2026-04-20')!

  const next = applyEdit({ items: p.items, roots }, occ, 'single', {
    title: 'Team Standup', tags: [], items: [], participants: [],   // ← cleared
    tracked: true, done: false, priority: null,
    scheduled: { date: '2026-04-20', time: '09:00' }, duration: '', repeat: null, body: '',
  })
  const written = saveFile(collapseToYaml(next.items, next.roots.get('ts')), '')

  const reparsed = parseToStoreItems('ts.md', written)
  const after = expandRange(reparsed.items, new Map([['ts', reparsed.root]]),
    new Date(2026, 3, 1), new Date(2026, 4, 31)).find(o => o.date === '2026-04-20')!
  expect(after.metadata.participants).toEqual([])   // observed: ['alice','bob']
})
```

- **Breadth:** all five `OCCURRENCE_FIELDS` are affected in principle; `participants` (the only `required: true` occurrence array) and `done` are the reachable ones today. Search: `grep -l "defaults:" src/model/__tests__/fixtures/*.md | wc -l` → **13 of 18** fixtures, and `grep -c "^defaults:" src/storage/exampleBackend.ts` → **2 of 16** shipped tutorial files, already carry a `defaults:` block. `collapseToYaml` emits one for every single-series-with-instances file, so in a real vault this is roughly "every recurring entry the user has ever overridden".
- **Recommended model:** **Opus 5 in plan mode, for a plan spanning multiple PRs.** This needs a product decision before any code: does a cleared field emit an explicit empty marker (`participants: []`, `done: null`) into the instance, or does collapse stop hoisting a field the moment any item diverges? The hazard that sets the tier: `inlineFieldEmpty` is shared by `occMetaToYaml` *and* `fileMetaToYaml`, so loosening it globally makes every file in every vault grow `participants: []` / `tags: []` / `items: []` on the next save — a whole-vault diff shipped as a bugfix. And symptom (b) is a different decision from symptom (a): whether "All events" should rewrite explicit overrides at all. Both must be settled together or the fix moves the corruption rather than removing it.
- **Evidence** — `src/types.ts:229` makes an empty array indistinguishable from an absent one:

```ts
export function inlineFieldEmpty(kind: InlineFieldKind, v: unknown): boolean {
  if (v === undefined) return true
  return kind === 'stringArray' ? !Array.isArray(v) || v.length === 0 : false
}
```

  `src/model/collapse.ts:189-198` (`occMetaToYaml`) then drops exactly the `[]` that `diffMetadata` at `:223-237` correctly identified as a divergence:

```ts
    const v = (m as Record<string, unknown>)[spec.key as string]
    if (!inlineFieldEmpty(spec.kind, v)) result[spec.key] = v
```

  `src/model/AGENTS.md` already lists *"absent-vs-empty for required arrays"* among its still-open losses — this finding is what that sentence costs in practice.
- **Problem:** an occurrence-level field the user cleared is written as an absent key, so `defaults:` inheritance restores the old value on the next load and the edit is undone without a trace.
- **Fix:** make "cleared" representable — emit an explicit empty/null marker for a field that diverges from its inherited default, and teach `parseInlineField` to read it back as cleared; afterwards the #2a test above passes. **There is no point fix for #2b** — the stale `participants:` on the 2026-04-13 instance needs the provenance-or-semantics decision in §2 Root A, and should be a separate PR.

---

### #3 — Excluding an occurrence discards every field on it — **FIXED**

> Fixed in `src/model/collapse.ts`'s `serializeChildren` (commit "Land finding #3"). The repro, expected/observed, and original point-fix guidance below are kept verbatim as the historical record; see the verification block at the end for what actually landed.

- **Invariant violated:** 1 (round-trip), 2 (edit locality), 7 (recoverability). Fires on every swipe-delete or "This occurrence" delete of a recurring occurrence that carries per-occurrence data, and on every override at or after the cut when "This and following" is used.
- **Category:** `round-trip` `recoverability` `edit-locality`
- **Root:** **A** — the projection *has* the data and simply doesn't emit it. The cheapest of the four A leaks to close, and the natural place to start Root A.
- **Failure mode:** **Silent.** The store keeps the full metadata after the exclude, so nothing looks wrong; the loss materialises only on the next reload or on the other device. The swipe-delete undo toast lasts 4 seconds and restores from an in-memory snapshot — after that there is no artifact anywhere. The editor's "This and following" path (`deleteFuture`) has no undo toast at all.
- **Impact:** **7**

**Repro.** Starting file `s2.md`, verbatim:

```yaml
---
title: Standup
date: 2026-04-06
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-04-13
    done: true
    minutesUrl: https://example.com/notes/13
---
```

Operation: expand, take the 2026-04-13 occurrence, `excludeOccurrence(...)` (exactly what a swipe-delete does), serialize.

**Observed:**

```yaml
---
title: Standup
date: 2026-04-06
repeat:
  type: schedule
  freq: weekly
  byweekday:
    - mo
instances:
  - date: 2026-04-13
    excluded: true
---
```

`minutesUrl` — a URL the user hand-wrote and Meridian promised to preserve — is gone, along with `done: true`. **Expected:** the exclusion stub keeps the child's own fields; only its visibility changes. The same happens for hand-authored excluded children on load: a source file with `excluded: true, cancelReason: public holiday, owner: bob` round-trips to just `date` + `excluded`.

Failing regression test:

```ts
it('excluding an occurrence keeps the unknown keys it carried', () => {
  const src = [
    '---', 'title: Standup', 'date: 2026-04-06',
    'repeat:', '  type: schedule', '  freq: weekly', '  byweekday: [mo]',
    'instances:', '  - date: 2026-04-13', '    done: true',
    '    minutesUrl: https://example.com/notes/13', '---',
  ].join('\n')
  const p = parseToStoreItems('s2.md', src)
  const roots = new Map([['s2', p.root]])
  const occ = expandRange(p.items, roots, new Date(2026, 3, 13), new Date(2026, 3, 13, 23, 59))[0]!

  const next = excludeOccurrence({ items: p.items, roots }, occ)
  const out = saveFile(collapseToYaml(next.items, next.roots.get('s2')), '')

  expect(out).toContain('minutesUrl: https://example.com/notes/13')  // observed: absent
})
```

- **Breadth:** one line of code, three production call sites — `src/occurrenceActions.ts:108` (swipe-delete), `src/editor/save.ts:165` ("This occurrence"), and `src/editor/save.ts:178` (`deleteFollowing`, which sets `excluded: true` on **every** override at or after the cut date in a single action, so its blast radius is N overrides at once). Search: `grep -rn "excludeOccurrence(\|deleteFollowing(" src --include=*.ts --include=*.tsx | grep -v __tests__`.
- **Recommended model:** **Sonnet 5.** The fix is local to `serializeChildren`. The hazard to name in the task: the emitted stub must still be *diffed against the series metadata* (`diffMetadata(c.metadata, seriesMeta)`), not dumped wholesale — dumping re-materialises every inherited value onto every exclusion stub and inflates the file on each delete; and `excluded` must stay in `STRUCTURAL_KEYS` so `emitExtra`'s defensive skip keeps working. With those two sentences in the prompt this is a mechanical edit; without them the plausible-wrong version passes the existing snapshot and grows every recurring file.
- **Evidence** — `src/model/collapse.ts:150`:

```ts
    if (c.excluded) return { date: c.date, ...(c.time ? { time: c.time } : {}), excluded: true }
```

  Note `src/model/__tests__/__snapshots__/edits.test.ts.snap` bakes this shape in at four places (e.g. `- date: 2026-04-20 / time: 09:00 / excluded: true`) — but every fixture there excludes a *generated* occurrence with nothing to lose, so the snapshot is defending a case that has never carried data. That is exactly the "snapshot asserts stability, not correctness" trap the brief flagged.
- **Problem:** deleting one occurrence of a series erases the notes, links and overrides the user attached to that occurrence, with a 4-second undo window and no recoverable artifact after it.
- **Fix:** emit the excluded child's diffed metadata alongside `excluded: true` in `serializeChildren`; afterwards the test above passes and the hand-authored `cancelReason`/`owner` case round-trips. **Root fix:** land it under Root A step 2, with the totality assertion in place, so the fix is verified against the invariant rather than against one repro.

**Verification — landed as described, no surprises.**

- `serializeChildren` now builds `{ date, time?, excluded?, ...diffedMetadata }` unconditionally instead of early-returning `{ date, time?, excluded: true }` for an excluded child — the exact change the point-fix predicted, including the diffed-against-series-metadata caveat (no wholesale dump).
- **The ratchet caught the fix, as designed.** `round-trip-totality.test.ts`'s `excluding a recurring occurrence keeps the metadata it carried` moved from `it.fails` to `it` and now passes; before landing the real change, patching the stub *without* diffing (returning the raw metadata unconditionally) was tried first and correctly flipped the ratchet to `Error: Expect test to fail` rather than green — confirming the assertion pins the specific behaviour, not just "some change happened."
- **Two regression tests added, not one.** The report's repro above now lives in `src/model/__tests__/edits.test.ts` as `excludeOccurrence keeps an unknown key the occurrence carried, on a fresh exclusion stub` (verbatim: creates the exclusion stub from a generated slot, asserts `minutesUrl` and `done: true` both survive). A second case, `excludeOccurrence preserves an override's unknown key on the store item, AND on save`, extends a pre-existing test (`unknown-keys-series` fixture) that had only checked the *store item* kept its unknown key — not that a save actually emitted it. That test's own comment used to say collapse "deliberately does not emit metadata on excluded instances (documented non-goal)" — which was simply wrong; `AGENTS.md`'s own "Deliberate non-goals" list correctly filed it as a **still-open loss**, not a non-goal, and has been corrected to say it's closed.
- **Every pre-existing exclude test was traced by hand before the fix landed**, to confirm none would regress: all target occurrences with metadata identical to their series (a freshly-excluded generated slot, or an override created with no divergent fields), so `diffMetadata` against the series always produces `{}` for them and their snapshots are byte-for-byte unchanged. Confirmed by running the suite: **76 files, 928 passed + 2 expected-fail** (down from 3 — #3's case closed; #5 and #8's narrow slice remain open), zero snapshot diffs. `pnpm run build` and `pnpm run lint` both pass with no new errors or warnings.
- **What #3 does *not* fix:** an excluded child's metadata was already correct on the *store item* before this change (`upsertOverride` never touched it) — the bug was purely in what `serializeChildren` chose to emit. So this closes the round-trip leak without touching `expandNode`'s exclusion logic (`eff.excluded` still suppresses the occurrence before its metadata is ever read) or any other Root-A leak. #2, #5 and #8 are unaffected and remain open, tracked by the two remaining `it.fails` cases in `round-trip-totality.test.ts`.

---

### #4 — A remotely-deleted file with a pending local edit spawns a new conflict copy every sync tick, forever — **FIXED**

- **Invariant violated:** 4 (no lost update), 5 (cache coherence). Fires when a file is deleted or renamed on the other device — or by hand, or by `git rm` in a GitHub vault — while the local cache still holds an unpushed edit for it.
- **Category:** `lost-update` `cache-coherence` `atomicity`
- **Root:** **C** — the same function's other missing branch. Fix with #1, not after it: #1's reordering is what makes this branch's "re-push as a create" safe.
- **Failure mode:** **Loud, but unbounded and non-converging.** Each cycle raises one `warn` toast ("Conflict on task.md — your version saved as …") and creates one new file; the dirty badge never clears because `task.md` stays `dirty` forever. The user's content is never lost, but the vault fills with duplicates at one per `autoSyncTick` (60 s ⇒ ~1440 files/day), each of which is itself a `.md` vault entry that gets parsed into the store and pushed to the backend.
- **Impact:** **6**

**Repro.** Starting state — the cache holds a dirty record whose base version refers to a file the backend no longer has (deleted on another device):

```
cache:   { path: 'task.md', content: 'local edit', status: 'dirty', version: 'sha1' }
backend: (empty)
```

Operation: four `syncToBackend()` calls, 61 seconds apart (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`).

**Observed:**

```
backend paths: [ 'task_20260731-080000.md', 'task_20260731-080101.md',
                 'task_20260731-080202.md', 'task_20260731-080303.md' ]
cache:         task.md → dirty (still, with the stale 'sha1'), plus 4 clean copies
syncError:     null
```

Four identical copies of the same content, and `task.md` unchanged. **Expected:** one cycle resolves it — either the local content is re-created at `task.md` (a create, since the remote is gone) or exactly one conflict copy is made and the record stops being dirty.

Two conflicts on the *same* path inside one second is a related second-order bug: `conflictPath` returns the same name, the copy write hits an existing file, and the resulting `ConflictError` escapes `resolveCollision` past `pushDirty`'s `catch (e) { if (e instanceof ConflictError) … }` — where it is re-classified as an actionable failure. Observed: `syncError = "Conflict on a_20260731-082303.md: backend version diverged since last sync."`

- **Breadth:** one function, all backends. Any vault touched by a second device, a hand-rename, or a `git rm`.
- **Recommended model:** **Sonnet 5.** The hazard: the obvious fix — "if the re-read returns nothing, push the local content as a create" — must **clear the record's stale `version` first**, or the very next CAS presents `sha1` against an absent file and reproduces the conflict immediately; and it must not silently resurrect a file the other device deliberately deleted, so the user needs telling which of the two happened. Naming those two constraints makes this a Sonnet job; without them the plausible fix looks correct and loops just as hard.
- **Evidence** — `src/storage/sync.ts:107-131`: the `if (fresh)` guard means the dirty record is simply left untouched when the remote file is gone, while the copy is written unconditionally below it:

```ts
  const [fresh] = await backend.readFiles([path])
  if (fresh) {
    await setResolvedClean(vaultId, path, fresh.content, fresh.version)
```

  and the copy write carries no precondition and no collision retry:

```ts
  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)
```
- **Problem:** a file deleted on one device while edited on another wedges sync permanently and litters the vault with one duplicate entry per minute.
- **Fix:** handle the "remote is gone" case explicitly — clear the record's base `version` and re-push it as a create (or tombstone it, with a toast saying which) — and make the copy write collision-tolerant by bumping the timestamp/suffix on `ConflictError`; afterwards the four-cycle repro produces at most one extra file and ends with no dirty records. **Root fix:** this is one cell of Root C's decision table — write the table, don't add a branch.

**Verification — fixed as part of Root C, with the policy resolved.** The open question in the Fix line above ("re-push as a create, *or* tombstone") was settled deliberately: **the local content is restored at its original path**, not written to a conflict copy. A copy would orphan every `[[wikilink]]` pointing at that slug, and re-deleting is one gesture where finding a stray copy and renaming it back is several. The user is warned so a delete they meant can simply be repeated. This also makes the policy symmetric with the tombstone branch, which already keeps a remote edit that lands after a local delete — one rule, stated in the code: **an edit beats a delete.** The four-cycle repro now ends with exactly `['task.md']` on the backend, a clean cache record, and one warning. See Root C's verification block.

---

### #5 — Frontmatter on a node the parser gives no `StoreItem` home is silently deleted

- **Invariant violated:** 1 (round-trip fidelity). Hand-authored files only, on the first save after the file is edited through the app.
- **Category:** `round-trip` `validation`
- **Root:** **A** — the *store* has no home for the data, so the leak is on the parse side. This is the leak that shows the `extra` bag hangs off `StoreItem`s rather than off tree nodes; see §2 Root A.
- **Failure mode:** **Silent.** No parse error, no toast; the file loads, the keys are simply absent from the store and therefore from the next write. A user would notice as "Meridian ate my per-event titles" in a `git diff`, possibly weeks later.
- **Impact:** **6**

**Repro (a) — file-level keys on a child node.** Starting file, verbatim:

```yaml
---
instances:
  - date: 2026-01-01
    title: Meeting A
  - date: 2026-01-02
    title: Meeting B
---
```

Operation: `parseToStoreItems` → `collapseToYaml` → `saveFile` (the exact `writeEntityToCache` path).

**Observed:**

```yaml
---
title: ""
instances:
  - date: 2026-01-01
  - date: 2026-01-02
---
```

Both titles deleted, and an empty one invented at the root. **Expected:** the titles survive somewhere — even if Meridian's model insists `title` is file-level, the bytes should be preserved under their own key, exactly as `project:`/`url:`/`aliases:` already are.

**Repro (b) — any key on an intermediate container node.** Starting file:

```yaml
---
title: Trip
instances:
  - project: apollo
    reviewer: alice
    instances:
      - date: 2026-01-01
      - date: 2026-01-02
---
```

**Observed:** `project` and `reviewer` are gone; output is `title: Trip` + the two bare dates. Same for a `defaults:` block nested inside an instance: `defaults: { tags: [work], owner: alice }` loses `tags` and keeps only `owner`.

Failing regression test:

```ts
it('keeps file-level keys written on a child node', () => {
  const src = [
    '---', 'instances:',
    '  - date: 2026-01-01', '    title: Meeting A',
    '  - date: 2026-01-02', '    title: Meeting B', '---',
  ].join('\n')
  const p = parseToStoreItems('c.md', src)
  const out = saveFile(collapseToYaml(p.items, p.root), p.root.body ?? '')
  expect(out).toContain('Meeting A')   // observed: absent
  expect(out).toContain('Meeting B')   // observed: absent
})
```

- **Breadth:** two distinct holes. (a) the three `level: 'file'` registry keys — `title`, `tags`, `items` — on any non-root node; (b) *all* keys on a container node. Search: `grep -rn "unknownKeys(" src` → 2 call sites, `types.ts:215` (definition) and its uses in `extractFileMetadata`/`extractOccurrenceMetadata`; the container branch is `src/model/storeItems.ts:125-127`. Affects any hand-written file that groups several dated events under one root — a natural shape given the model, and the shape the `irregular-instances` fixture itself uses.
- **Recommended model:** **Sonnet 5 if the task spells out the ownership rule** from `src/model/AGENTS.md` ("the root is an item, or the file owns it, never both" — a reserved key with no home *at this level* belongs in that node's `extra`); **else Opus 5**. The hazard: routing `title` into an occurrence `extra` bag naively makes `fileMetaToYaml`'s `if (root.extra && spec.key in root.extra) continue` short-circuit prefer the stale raw value over the typed root title, and if the root *is* the item the key then emits twice — the exact double-emission the `unknown-keys.test.ts` "emits date exactly once" test was written to catch. Hole (b) needs a place to hang a container's remainder at all, which is a small structural addition.
- **Evidence** — `src/types.ts:187` filters by the union of both levels, while `extractOccurrenceMetadata` only ever stores the occurrence half:

```ts
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...STRUCTURAL_KEYS,
  ...INLINE_FIELDS.map(s => s.key as string),
])
```

  and `src/model/storeItems.ts:125-127` walks past a container without collecting anything:

```ts
    } else {
      n.instances.forEach(walk)  // container node
    }
```
- **Problem:** a hand-authored file that puts a title (or any key) on a nested node loses those bytes the first time Meridian saves it, despite the README promising hand-created files are picked up.
- **Fix:** route reserved keys with no home at the current level into that node's `extra` bag, and give container nodes a remainder home; afterwards both repros round-trip their keys and the "emits `date` exactly once" test still passes. **Root fix:** giving the *tree* a remainder home (rather than adding a second allow-list) is what stops leak number five; see §2 Root A. Flip B-test's `a title written on a child instance survives the save` case from `it.fails` to `it` as part of this PR — that is the fix's acceptance check.

---

### #6 — A biweekly `byweekday` series expands to different dates depending on the reader's locale

- **Invariant violated:** 8 (temporal correctness) always; 2 (edit locality) as soon as one device writes an override. Two devices with different `Intl` locales, or one device whose locale changes.
- **Category:** `temporal` `edit-locality`
- **Root:** **D** — the only place a viewer preference reaches a domain computation. The root fix is the boundary rule (nothing reaches `expandNode` that isn't in the file), not just this call site.
- **Failure mode:** **Silent.** Both devices render a perfectly plausible schedule; they just disagree about which days it falls on. A user would notice as "my sprint review shows on the 19th on my laptop and the 12th on my phone."
- **Impact:** **6**

**Repro.** Starting file `sr.md`, verbatim:

```yaml
---
title: Sprint review
date: 2026-04-02
repeat:
  type: schedule
  freq: weekly
  interval: 2
  byweekday: [su]
---
```

Operation: `expandRange(items, roots, 2026-04-01, 2026-05-31, weekStart)` for each locale value.

**Observed** — no overlap after the anchor:

| `weekStart` | locale | dates |
|---|---|---|
| 1 | de-DE, en-GB (Monday first) | `04-02, 04-05, 04-19, 05-03, 05-17, 05-31` |
| 0 | en-US (Sunday first) | `04-02, 04-12, 04-26, 05-10, 05-24` |
| 6 | ar-SA (Saturday first) | `04-02, 04-12, 04-26, 05-10, 05-24` |

Control: the same file with `interval: 2` removed gives identical dates at every `weekStart`, so the divergence is specific to `interval ≥ 2`.

The divergence then gets written into the file. On the Monday-first device, mark the 2026-04-19 occurrence done → the file gains:

```yaml
instances:
  - date: 2026-04-19
    done: true
```

Re-reading that file on the Sunday-first device **observes** an extra occurrence at 2026-04-19 with `source: 'explicit'` that is not part of its schedule at all — a phantom event sitting between the 12th and the 26th. **Expected:** one file, one schedule, one set of dates, everywhere.

Failing regression test:

```ts
it('a biweekly byweekday series yields the same dates regardless of locale week start', () => {
  const src = [
    '---', 'title: Sprint review', 'date: 2026-04-02',
    'repeat:', '  type: schedule', '  freq: weekly', '  interval: 2',
    '  byweekday: [su]', '---',
  ].join('\n')
  const p = parseToStoreItems('sr.md', src)
  const roots = new Map([['sr', p.root]])
  const from = new Date(2026, 3, 1), to = new Date(2026, 4, 31)
  const mon = expandRange(p.items, roots, from, to, 1).map(o => o.date)
  const sun = expandRange(p.items, roots, from, to, 0).map(o => o.date)
  expect(sun).toEqual(mon)   // observed: ['2026-04-02','2026-04-12',…] vs ['2026-04-02','2026-04-05',…]
})
```

- **Breadth:** `freq: weekly` + `interval ≥ 2` + a `byweekday` list. `weekStart` reaches expansion from `weekStartsOn(localePrefs)` at four call sites — `src/calendar/useExpandWithMultiday.ts:49`, `src/routes/_app.entry.$slug.tsx:56`, `src/store.ts:161`, and `src/fileOccurrence.ts:123` — and `localePrefs.firstDayOfWeek` is auto-detected per device from `Intl.Locale.getWeekInfo()` (`src/store.ts:11-12`) into per-device localStorage.
- **Recommended model:** **Opus 5.** The hazard that sets the tier: the correct answer is to derive the week grouping from the series **anchor** (or to persist a `wkst` in the repeat block, RFC 5545's answer) rather than from the reader — but *any* change here re-dates every existing biweekly series in every user's vault, so it needs a migration decision, and `weekStart` must keep coming from the locale for *view* layout (`MonthView.tsx:34`, `DatePickerDialog.tsx:78`). The specific trap: "just hardcode Monday" is correct in the author's locale and silently wrong in the US — the same class of fix that voids itself. `src/model/__tests__/weekStart.test.ts` currently pins **both** behaviours as intended, so the fix also has to argue with an existing test rather than just make it pass.
- **Evidence** — `src/model/expansion.ts:241-243`, inside `matchesInPeriod`'s weekly branch:

```ts
        const wd = periodStart.getDay()
        const weekStartOff = -((wd - weekStart + 7) % 7)
        const periodWeekStart = new Date(periodStart)
```

  With `interval ≥ 2` the period cursor advances 14 days, so which fortnight a `byweekday` day falls into depends entirely on where the reader's week boundary sits.
- **Problem:** the same vault file describes two different schedules on two devices, and an override written on one appears as a phantom extra occurrence on the other.
- **Fix:** ground the `byweekday` week on the series anchor (or a persisted `wkst`) instead of the viewer's `localePrefs`, with a migration note; afterwards the test above passes and the cross-device override lands on a real generated slot on both devices. **Root fix:** add the boundary rule to `src/model/AGENTS.md` in the same PR — `expandNode`'s inputs are a short list, so it is enforceable by review.

---

### #7 — Swipe-delete's Undo restores the entry but not the wikilinks it removed

- **Invariant violated:** 7 (recoverability), 2 (edit locality). Swipe-deleting a standalone entry that other notes link to.
- **Category:** `recoverability` `edit-locality` `cache-coherence`
- **Root:** **E** for the missed persistence (the transition doesn't report what it touched); the *undo* half is its own bug and survives the Root E fix — see the Fix line.
- **Failure mode:** **Silent.** After Undo the entry is back and looks intact; the linking note's `items` list is empty in the store while the file on disk still has the link. Nothing warns. The user notices when the linking note's Items section is short a row — or never, until they edit that note and the link is written out of the file for real.
- **Impact:** **5**

**Repro.** Store state: `note-a` (a standalone occurrence) and `note-b` whose root carries `items: ['[[note-a]]']`.

Operation: `beginSwipeDelete(occA)`, run the returned apply function, then click **Undo** before the 4 s toast closes.

**Observed:**

```
after delete:  note-b items = []      writes = []        deletes = []
after undo:    note-b items = []      writes = ['note-a'] deletes = []
```

**Expected:** `note-b items = ['[[note-a]]']` after Undo. Two separate defects show here: the backlink removal is never persisted in the first place (`writes` never contains `note-b`, unlike the editor's own delete path), and Undo never restores it.

Failing regression test (`src/occurrenceActions.test.tsx` style — that file already has `setupStore`/`installFakePersistence`/`makeOcc`/`makeRoots`):

```ts
it('Undo restores the wikilink the delete removed from another file', () => {
  const a = makeOcc({ id: 'occ-a', fileSlug: 'note-a', metadata: { participants: [], title: 'A', tags: [], items: [] } })
  const b = makeOcc({ id: 'occ-b', fileSlug: 'note-b', metadata: { participants: [], title: 'B', tags: [], items: ['[[note-a]]'] } })
  const roots: Roots = makeRoots('note-a', { title: 'A' })
  roots.set('note-b', { title: 'B', tags: [], items: ['[[note-a]]'] })
  seedStore([a, b], roots)
  render(<Toaster />)

  const apply = beginSwipeDelete(a)
  act(() => apply())
  act(() => { vi.advanceTimersByTime(20) })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  expect(useStore.getState().roots.get('note-b')?.items).toEqual(['[[note-a]]'])  // observed: []
})
```

- **Breadth:** one of the two delete paths. The editor's delete does it correctly — `src/editor/save.ts:171-173` and `:185-187` both compute `getBacklinks().get(item.fileSlug)` and route through `commitDelete(next, slug, affected)`, which persists the backlink files. The swipe path skips both.
- **Recommended model:** **Sonnet 5.** The hazard: the fix must restore the *other* files' roots as well as the deleted slug's, and persist them — but a blanket "restore the whole snapshot" reintroduces the bug `src/occurrenceActions.test.tsx`'s existing test *"undoing a delete does not revert an unrelated edit made during the toast window"* was written to prevent. The restore has to be scoped to exactly the backlink slugs the delete touched, which is the same set `commitDelete` already takes.
- **Evidence** — `src/occurrenceActions.ts:124-126` mutates other files' roots but persists only the deleted slug:

```ts
    return () => {
      if (!cancelled) setData(deleteByFileSlug(getSnapshot(), o.fileSlug))
    }
```

  while `restoreFileSlug` at `:18-30` is scoped to one slug by construction:

```ts
  const roots = new Map(current.roots)
  const snapshotRoot = snapshot.roots.get(fileSlug)
  if (snapshotRoot) roots.set(fileSlug, snapshotRoot)
```
- **Problem:** undoing a swipe-delete leaves other notes missing the wikilink they carried to the restored entry, and the next edit to those notes writes that loss to disk.
- **Fix:** have `beginSwipeDelete` pass the backlink slugs through `commitDelete`, and have the undo path restore and re-persist those same slugs; afterwards the test above passes and `writes` contains `note-b` on both the delete and the undo. **Root fix:** Root E's `{ data, affectedSlugs }` return removes the *class* (15 call sites can no longer forget a slug), but the undo half still needs fixing by hand — restoring the backlink slugs without clobbering unrelated edits made during the toast window.

---

### #8 — Body whitespace and CRLF rewritten on every save

- **Invariant violated:** 1 (round-trip fidelity). Every save of every file; the CRLF half hits every vault authored on Windows or synced through a tool that normalises to CRLF.
- **Category:** `round-trip`
- **Root:** **A** — the store *never held* the bytes; `loadFile` trims them at parse. Note that **neither** of Root B's semantic checks catches this one (measured: both clean on a CRLF file) — it needs a **byte** compare at load, plus a CRLF fixture, which the corpus currently lacks.
- **Failure mode:** **Silent.** No error; the content is semantically identical. The user notices as a whole-file `git diff` on a one-character edit, or as lost indentation on a body that started with an indented code block.
- **Impact:** **3**

**Repro.** Three inputs, verbatim, through the production write path:

| In | Out |
|---|---|
| `"---\ntitle: A\n---\n\n  indented start\n\ncode:\n\n```\n  x = 1\n```\n\n\n"` | `"---\ntitle: A\n---\n\nindented start\n\ncode:\n\n```\n  x = 1\n```"` — leading indentation and the trailing newline gone |
| `"---\r\ntitle: A\r\ndate: 2026-01-01\r\n---\r\n\r\nline1\r\nline2\r\n"` | `"---\ntitle: A\ndate: 2026-01-01\n---\n\nline1\r\nline2"` — frontmatter converted to LF, body left CRLF ⇒ **mixed line endings** |
| `"# Hello\n\nSome notes.\n"` (a plain `.md` with no frontmatter — a README, a note from another tool) | `"---\ntitle: \"\"\n---\n\n# Hello\n\nSome notes."` — gains an empty-title frontmatter block |

**Expected:** at minimum, the file's dominant line ending is preserved and the trailing newline is kept. The CRLF case is the one worth fixing: converting to LF *or* keeping CRLF would both be defensible; producing a mixed file is the one outcome that is strictly worse than either.

- **Breadth:** every `.md` file in every vault, on every save. Search: `grep -rn "wrapFrontmatter\|splitFrontmatter" src` → `src/fileIO.ts` only, with `saveFile` (`src/model/inheritance.ts:210`) as the sole writer, called from `src/storage/sync.ts:588`.
- **Recommended model:** **Haiku 4.5.** Purely mechanical: record the source's line ending and trailing-newline convention on the `FileMetadata` root, and re-apply it in `wrapFrontmatter`. The hazard is small and loud: if the round-trip is wrong the existing `yaml-roundtrip.test.ts` fixed-point tests fail immediately, which is the safe failure mode. (Add a CRLF fixture — there is none today, which is why this has never been caught.)
- **Evidence** — `src/fileIO.ts:25` trims the body unconditionally:

```ts
  if (m) return { fm: m[1]!, body: m[2]!.trim() }  // both groups are mandatory
```

  and `src/fileIO.ts:30-32` re-emits with hard-coded LF and no trailing newline:

```ts
export function wrapFrontmatter(yamlFields: string, body: string): string {
  return `---\n${yamlFields}\n---${body ? '\n\n' + body : ''}`
}
```
- **Problem:** every save rewrites bytes the user did not change — indentation on the first body line, the trailing newline, and every `\r` in the frontmatter — turning a one-field edit into a whole-file diff on Windows-authored vaults.
- **Fix:** carry the source line ending and trailing-newline convention through `loadFile` → `FileMetadata` → `wrapFrontmatter`, and trim only the blank lines around the frontmatter fence rather than the whole body; afterwards all three repro inputs round-trip byte-identically when nothing changed. **Root fix:** add a byte-level arm to Root B's load-time check and a CRLF fixture, so this cannot regress — the two semantic checks will not catch it. B-test already pins the narrowest slice of this (no mixed line endings within one file, `round-trip-totality.test.ts`); flip that case as part of this PR, and extend it once the fuller line-ending/trailing-newline fix is decided.

---

## 7. Things checked and found sound

Worth recording so the next pass doesn't re-derive them:

- **CAS is real on both writable backends.** `fs.ts`'s `diskWrite` treats `undefined` as "must be absent" (`if (cur !== expectedVersion) throw new ConflictError(path)`), and `diskDelete` mirrors it while staying idempotent for an already-absent file. `githubBackend` passes `expectedVersion` as the `sha` and never falls back to its own `_shas` cache for writes. `mapGitHubError` maps 409/422 → `ConflictError`, 403-with-rate-limit-headers → transient rather than auth. `statAll` refuses a truncated tree listing rather than reading it as a mass deletion.
- **`markPushed`, `applyRemoteBatch` and the in-flight registry** all correctly refuse to clean-stamp a record a local edit touched mid-flight; I re-ran the existing probes and could not break them.
- **DST.** A daily 02:30 series across the Europe/Berlin spring-forward keeps `date: 2026-03-29` and `time: "02:30"` in the model; only `jsTime`'s wall clock shifts to 03:30 (the hour that does not exist), which affects Day-view placement, not the stored day. **No occurrence moves days.**
- **Month-end and leap days.** A monthly series anchored on the 31st correctly skips short months rather than overflowing (`01-31, 03-31, 05-31, 07-31, 08-31, 10-31, 12-31`); a Feb-29 yearly anchor skips non-leap years.
- **Window-independence.** `end: { type: 'count' }` enumerates from the anchor and clips at the end, so the same rule yields the same occurrences whatever range is queried — the skip-ahead optimisation is correctly gated on `maxCount === Infinity`.
- **`stableOccId` and duplicate dates.** Two instances on the same date get distinct `#2` suffixes at parse time (`storeItems.ts`'s `usedKeys` counter) and each keeps its own metadata through the round-trip; `expandNode`'s `findOverrides` returns every match rather than the first.
- **Malformed input.** A file with bad YAML fails individually, raises a `warn` toast, and reserves its slug via `unreadableSlugs` so a new entry cannot be written over it. Verified with duplicate keys, tab indentation, and unquoted colons.

## 8. Smaller observations (not findings — no byte lost)

- **`applyFuture` on a count-bounded series silently changes the total.** Splitting a 10-occurrence series at its third occurrence caps the first at `until: 2026-04-19` but copies `end: { type: count, occurrences: 10 }` verbatim onto the new one — total goes 10 → 12 (verified). Not a byte lost, but "this and following" changes the schedule's meaning.
- **"Remove repeat" does nothing to an existing series.** `useEntryDialogs.ts:74` sets `repeat: null`, but `applyFieldsToItem` does `repeat: repeat ?? item.repeat` (`storeOps.ts:291`), so a scope-`all` save keeps the old rule. Verified: the file is unchanged.
- **`timezone` is a registered, parsed, round-tripped field that nothing reads.** `grep -rn "timezone" src` → 4 hits, all declarations. A user writing `timezone: America/New_York` gets no effect; every time is floating wall-clock. Probably the right product choice, but the field is a trap as it stands.
- **`parseDurationDays` treats a month as 30 days and a year as 365** for multiday span rendering — a "2 months" event always covers exactly 60 days.
- **`src/model/AGENTS.md` needs a pass** — see the suspects table above.
