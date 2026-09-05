# Data Integrity & Durability — survey results

Run 2026-09-05 against `main` (`47f601b`). Survey: [`surveys/data-integrity.md`](surveys/data-integrity.md);
shared conventions: [`surveys/README.md`](surveys/README.md).

**Finding numbers restart at #1 for this run.** The `#N` references appended to
the "Known suspects" entries in the survey file before 2026-09-05 belong to the
2026-07-31 run, whose results file was deleted when its last finding closed.
Code comments citing "data-integrity survey, finding #N" likewise refer to that
earlier run; they have not been renumbered.

---

## 1. Integrity verdict

Yes — Meridian can lose the user's writing, in two structurally different ways,
and in both the mechanism built to catch it is looking the other way. The worst
is **a second view of the same vault**: two tabs (or a tab plus the installed
PWA) share one IndexedDB but not one in-memory store, so Tab B's next save
carries the version token Tab A's push just wrote into the shared cache — the
compare-and-swap precondition matches, the write lands, and Tab A's edit is gone
with no `ConflictError`, no conflict copy, no three-way merge and no toast
(finding #2). The second is a **malformed structural key**: a hand-written
`date:`, `excluded:` or `instances:` in a shape the parser can't type has no
`extra` home and is silently deleted on the next save, in one case reviving an
occurrence the user had deliberately hidden (finding #4).

The single biggest structural theme is that **the round-trip guard checks the
wrong round trip, and checks it on parsed values rather than bytes**.
`roundTripLoss` is sound only on an *unedited* file (its own doc comment says
so), and it compares `key=value` pairs after both sides have been through
`yamlParse` — so it reports `[]` for every one of findings #4 and #6. Every
loss this run found is invisible to the one runtime check that exists to find
the next one.

---

## 2. Coverage statement

**Invariants probed with real reproductions** (a failing test was written and
run, and is quoted in the finding):

| Invariant | Probed how |
|---|---|
| 1 round-trip fidelity | 39 adversarial frontmatter shapes through `parseToStoreItems` → `serializeEntry`, plus all 20 `model/__tests__/fixtures/*.md` |
| 2 edit locality | No-op save of every fixture × 3 scopes (`all`/`single`/`future`) × first 3 occurrences (60 combinations), diffed against the unedited serialization |
| 4 no lost update | Two-tab write sequence against the **real** Dexie cache (`fake-indexeddb`) plus a hand-rolled CAS backend |
| 5 cache coherence | Same harness; plus a static trace of `hydrateFromCache` / `planReconcile` to establish that no later reconcile can repair the stale tab |
| 6 durability | `useAutoSave` under jsdom with fake timers, driven to `pagehide`/`visibilitychange` |
| 8 temporal correctness | Differential expansion across 9 timezones (UTC, America/New_York, Europe/Berlin, America/Santiago, Australia/Lord_Howe, Pacific/Chatham, Pacific/Auckland, Asia/Tehran, Antarctica/Troll) × 13 repeat rules × 6 anchors × 4 times; then a 48-time-of-day sweep asserting daily continuity (366 distinct days) and exact `count` cardinality for daily/weekly/monthly/yearly |

**Reasoned about statically, not reproduced:**

- Invariant 3 (expansion ↔ collapse agreement) beyond what the fixture no-op
  sweep covers. `computeSharedFields` / `occMetaToYaml` / `emitExtra` were read
  end-to-end and the hoisting logic looks sound; the losses found sit *upstream*
  of it, in what reaches collapse at all.
- Invariant 7 (recoverability) — the delete-undo toast, `deleteFollowing`,
  `excludeOccurrence`, the staged cross-vault move and the retention sweep's
  undo were all read end-to-end. `moveEntry.ts`/`pendingMoves.ts`'s
  stage-then-release ordering holds up; `retentionDays` is opt-in (blank by
  default in `VaultSettings.tsx:94`), so the bulk archive sweep never fires
  unasked. Nothing reproduced. The one recoverability-adjacent defect found is
  finding #4's `excluded:` deletion.

**Skipped, with the reason:**

- **Atomicity / partial failure (category 4).** Interrupting a Dexie
  `bulkPut` mid-transaction, or `persistEntries` mid-loop, needs a fault-injection
  harness the current test-utils don't offer. Traced statically only — see
  "unverified" below.
- **IndexedDB quota exhaustion.** `fake-indexeddb` does not enforce a quota, so
  `QuotaExceededError` handling could not be exercised.

**Backends.** Exercised for real: the model layer, and `storage/cache/` through
the genuine Dexie code on `fake-indexeddb`. `localBackend`/`fs.ts`,
`githubBackend`/`githubApi`, `exampleBackend` and `icalBackend` were **traced
statically** and read against the `StorageBackend` contract — the automated
browser can grant neither File System Access permission nor an OAuth flow, as
the survey's Budget predicted. Against that contract all three writable
implementations do honour CAS: `fs.ts`'s `checkCas` treats `undefined` as
"must be absent" and is migration-aware for pre-hash `mtime:size` tokens;
`githubBackend.write` passes `expectedVersion` as the Contents-API `sha` and
deliberately does *not* fall back to its own `_shas` cache. `encodeBase64` is
UTF-8-safe. No CAS gap was found in any backend.

**Vaults used.** The 20 hand-written fixtures in `src/model/__tests__/fixtures/`,
plus ~55 synthetic single-file vaults written for the probes. The large-vault
generator (`storage/devFixtures/testVaultGen.ts`) was **not** used: nothing this
run found is volume-dependent, and the two candidates that would have been
(batch write, reconcile fan-out) fall in the skipped atomicity category.

**Quality gates** — one run each, on a fresh worktree with the gitignored types
generated first (`pnpm run build` for `src/routeTree.gen.ts`,
`pnpm --filter meridian-oauth-worker run cf-typegen` for the worker types):

| Gate | Result |
|---|---|
| `pnpm run build` | **pass** (exit 0) |
| `pnpm run lint` | **pass** (exit 0; depcruise: no violations, 445 modules / 1714 dependencies) |
| `pnpm test` | **pass** — 157 files / 3425 tests, plus worker 3 files / 41 tests |

**Fraction of the integrity-critical surface.** Roughly **70%**. Read end to
end: `fileIO.ts`, `nodeSchema.ts`, `inheritance.ts`, `storeItems.ts`,
`fieldRegistry.ts`, `collapse.ts`, `merge.ts`, `roundTripCheck.ts`,
`expansionCache.ts`, `dateUtils.ts`, `duration.ts`, `retention.ts`,
`storeCommit.ts`, `persistencePort.ts`, `occurrenceActions.ts`, `sync.ts`,
`cache/files.ts`, `cache/db.ts`, `cache/pendingMoves.ts`, `entityWrites.ts`,
`inFlight.ts`, `syncScheduler.ts`, `backend.ts`, `localBackend.ts`, `fs.ts`,
`githubApi.ts`, `exampleBackend.ts`, `conflictError.ts`, `conflictName.ts`,
`moveEntry.ts`, `retentionSweep.ts`, `parseReport.ts`, `useAutoSave.ts`,
`editor/save.ts`. Read partially: `storeOps.ts` (~40%), `expansion.ts` (~55%),
`githubBackend.ts` (write/delete/error paths only). Not read: `repeat.ts`,
`vaultRegistry.ts`, `githubOAuth.ts`, `storage/ical/*`, `syncJournal.ts`,
`syncState.ts`, `itemIndex.ts`.

**Unverified — flagged, not claimed:**

- **A torn multi-file operation.** `persistEntries` writes N files in a loop of
  independent, individually-transactional Dexie writes; `beginSwipeDelete`'s
  non-recurring branch then calls `deleteEntity` *after* that loop
  (`occurrenceActions.ts:183`). A crash between them leaves some files'
  `[[wikilink]]` backlinks stripped while the target still exists. Settling it
  needs a way to abort the process between two awaits — a fault-injection hook
  in `persistencePort`, or driving `persistEntries` directly with a
  `writeEntity` stub that throws on the second call.
- **Mock/real divergence in `sync.test.ts`.** `vi.mock('@/storage/cache/files')`
  (line 80) is still a hand-written re-implementation of the real cache. It is
  *close* — `recordLocalEdit`'s base capture, `markPushed`'s content
  precondition and `applyRemoteBatch`'s dirty skip all match — but one gap is
  visible by inspection: the fake's `applyRemoteBatch` drops `lastModified`,
  which the real one carries through via `...r`, so no sync test can catch a
  regression in the retention sweep's age signal. Settling whether anything
  *else* diverges needs a differential harness running one operation script
  against both implementations and diffing the resulting rows.
- **`repeat:` reaches `expandNode` through an unchecked cast**
  (`storeItems.ts`, `n.fields.repeat as Repeat`). A hand-written
  `repeat: weekly` (a bare string) round-trips intact — verified — but is read
  by `expandNode` as an `after_completion` rule with a default `1 day`
  interval, producing an occurrence set that has nothing to do with what the
  user wrote. No byte is lost, so it is below this survey's bar; noting it
  because the same cast is what makes finding #4's structural-key hole
  reachable from the other direction.

---

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Round-trip fidelity & edit locality | **findings: #4, #5, #6** |
| 2 | Lost updates & conflict handling | **findings: #2** |
| 3 | Cache coherence & durability | **findings: #2, #7** |
| 4 | Atomicity & partial failure | **partially assessed** — read end to end (`pushDirty`, `applyRemoteBatch`, `markInFlight`/`clearInFlight`'s refcounting, `moveEntityInCache`'s stage-then-release, `settlePendingMoves`) and nothing wrong was found by inspection, but no interruption was actually injected. The one concrete suspicion is recorded as unverified above. |
| 5 | Destruction & recoverability | **findings: #4** (a hand-written `excluded:` marker in a shape the parser can't type is deleted on save, so a deliberately-hidden occurrence silently returns). Everything else in this category — swipe-delete undo, `deleteFollowing`, the staged cross-vault move, the retention sweep's undo — was probed and is **clean**. |
| 6 | Temporal correctness | **findings: #3** |
| 7 | Input validation & untrusted files | **findings: #4** |

---

## 4. Findings

Ranked by `(impact × breadth) ÷ effort`, with `effort` read as the
recommended-model ordinal (Sonnet 5 = 2, Opus 5 = 3, Opus 5 plan-mode = 5).

| # / rank | Finding | Invariant | Failure mode | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|---|
| **#2** | A second tab silently overwrites the first, CAS and all | 4, 5 | **silent** | 9 | every entry in every writable vault; 3 write paths; 0 coherence mechanisms in `src/` | Opus 5, plan mode / multi-PR |
| **#3** | A DST spring-forward truncates bounded series and rewrites clock times | 8 | **silent** | 6 | 2 defects in 1 file; every bounded or `after_completion` series timed inside the gap | Sonnet 5 |
| **#4** | A malformed *structural* key has nowhere to live and is deleted on save | 1, 7 | **silent** | 7 | all 6 `STRUCTURAL_KEYS`, every node of every file; 6 of 14 probed shapes lose bytes | Opus 5 |
| **#5** | The round-trip guard cannot see any value-level loss | 1 (guard) | **silent** | 4 | 1 file, guarding every file on every load | Sonnet 5 |
| **#6** | YAML scalars are re-emitted from JavaScript values, not from source | 1 | **silent** | 5 | every unknown key in every file; 7 of 39 probed shapes change | Opus 5 |
| **#7** | A pending editor autosave is never flushed at page teardown | 6 | **silent** | 4 | 1 file; every editor session | Sonnet 5 |

Numbers are identity **and** rank for this run — the two coincided, so there is
no separate rank column to read.

**Sequencing note.** #4 and #6 both land in the parse/emit pipeline and #5 is
the guard over it: do **#5 first** (it is the only one that will *tell you*
whether the other two are fixed), then #4 (`fieldRegistry.ts`/`storeItems.ts`/
`roundTripCheck.ts`), then #6 (`fileIO.ts`/`inheritance.ts`). #4 and #5 both
touch `collectKeyValues`' `STRUCTURAL_KEYS` skip — doing #5 first means #4
only has to widen a check that already exists. #2, #3 and #7 are independent
of all of these and of each other.

---

### #2 — A second tab silently overwrites the first, CAS and all

- **Invariant violated:** 4 (no lost update) and 5 (cache coherence). Fires
  whenever **two views of the same vault are open** — two browser tabs, a tab
  plus the installed PWA, or two windows. Not two devices: those each have their
  own IndexedDB, and CAS catches them correctly.
- **Category:** `lost-update` `cache-coherence`
- **Failure mode:** **Silent, and unrecoverable.** No `ConflictError` is raised,
  so none of the conflict machinery runs: no conflict copy, no three-way merge,
  no `warnWithDetails` toast, no journal `push-conflict` line. The overwritten
  content is not preserved anywhere — the cache row that held it was replaced by
  the same push. A user notices only by remembering what they wrote in the other
  tab.
- **Impact:** **9** — silent, unrecoverable loss of user-authored content, on a
  path any multi-tab user reaches, with the entire collision-resolution system
  bypassed rather than defeated.

**Repro.** Starting state: one file at `note.md` in a writable vault, identical
in both tabs, clean in the cache at version `v0`:

```markdown
---
title: Note
---

Original body.
```

Operation sequence:

1. Tab A renames the title to `Note (renamed by A)` and its push cycle runs.
   The backend is now at `v1`; the shared Dexie row is `clean`, `content` = A's
   text, `version` = `v1`.
2. Tab B — which has been open the whole time and never heard about step 1 —
   appends a line to the body and saves. Its store still holds the *original*
   text, so `recordLocalEdit` writes B's content, inheriting `version: v1` from
   the existing row (by design: `version` is documented as "the *base* backend
   token the edit derives from").
3. Tab B's push CASes `v1` against a backend that is at `v1`. The precondition
   matches.

**Observed** — the backend now holds:

```markdown
---
title: Note
---

Original body.

B added a line.
```

A's rename is gone. `resolveCollision` was never entered.

**Expected:** either B's write is refused (a `ConflictError` → three-way merge
against `baseContent`, which the cache *does* correctly hold as A's content →
both changes survive), or B's store learns of A's edit before B saves.

Failing test, run against the **real** Dexie code (put it beside
`src/storage/__tests__/cache.test.ts`, which already sets up `fake-indexeddb`):

```ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { recordLocalEdit, markPushed, cacheGetDirty } from '@/storage/cache/files'
import { cacheInit } from '@/storage/cache/db'
import { ConflictError } from '@/storage/conflictError'

const remote = new Map<string, { content: string; version: string }>()
let seq = 0
async function write(path: string, content: string, expectedVersion?: string): Promise<string> {
  if (remote.get(path)?.version !== expectedVersion) throw new ConflictError(path)
  const version = `v${++seq}`
  remote.set(path, { content, version })
  return version
}

/** One vault's push cycle, exactly as pushDirty does it. */
async function push(vaultId: string) {
  for (const f of await cacheGetDirty(vaultId)) {
    const v = await write(f.path, f.content, f.version)
    await markPushed(vaultId, f.path, f.content, v)
  }
}

describe('two tabs, one vault', () => {
  beforeEach(() => { remote.clear(); seq = 0 })

  it('Tab B does not silently overwrite Tab A', async () => {
    await cacheInit()
    const V = 'vault', P = 'note.md'
    const ORIGINAL = '---\ntitle: Note\n---\n\nOriginal body.\n'

    remote.set(P, { content: ORIGINAL, version: 'v0' })
    await recordLocalEdit(V, P, ORIGINAL)
    await markPushed(V, P, ORIGINAL, 'v0')

    // Tab A edits the title and pushes.
    const aEdit = ORIGINAL.replace('title: Note', 'title: Note (renamed by A)')
    await recordLocalEdit(V, P, aEdit)
    await push(V)
    expect(remote.get(P)!.content).toBe(aEdit)

    // Tab B still holds the ORIGINAL in memory, and appends to it.
    const bEdit = ORIGINAL.replace('Original body.', 'Original body.\n\nB added a line.')
    await recordLocalEdit(V, P, bEdit)
    await push(V)

    expect(remote.get(P)!.content).toContain('title: Note (renamed by A)')  // ← fails today
  })
})
```

**No later sync repairs Tab B.** After step 3 the shared cache row agrees with
the backend, so `planReconcile` (`sync.ts:305-341`) puts `note.md` in neither
`changed` (`entry.version === diskToken`) nor `deleted`. `hydrateFromCache`
(`vaultRegistry.ts:209`) runs only on restore and registration, and
`visibilitychange` calls `autoSyncTick()` and nothing else
(`routes/__root.tsx:170-190`). Tab B stays wrong until it is reloaded.

**Breadth.** Every entry in every writable vault, through all three port write
paths (`writeEntityToCache`, `deleteFromBackend`, `moveEntityInCache`). Search
run: `grep -rn "BroadcastChannel\|liveQuery\|addEventListener('storage'" src/` —
**zero hits**; there is no cross-tab coherence mechanism of any kind in `src/`.

**Evidence.** `src/storage/cache/files.ts:73-88` — the version inheritance that
is correct for one tab and wrong for two:

```ts
export async function recordLocalEdit(vaultId: string, path: string, content: string): Promise<void> {
  const d = await cacheInit()
  const key = vp(vaultId, path)
  await d.transaction('rw', d.files, async () => {
    const existing = await d.files.get(key)
    if (existing && existing.content === content) return
    await d.files.put({
      vaultPath: key, vaultId, path, content,
      dirty: DIRTY_BY_STATUS.dirty, updatedAt: Date.now(),
      version: existing?.version,
      baseContent: baseFor(existing),
    })
  })
}
```

Note that `baseContent` here is *correct* — it is A's content, exactly the
ancestor a three-way merge would need. The merge simply never runs, because
`version` also came from A and so the CAS succeeds.

**Problem.** A second tab's save inherits the version token the first tab's push
just wrote into the shared cache, so its compare-and-swap passes against content
it has never seen, and the first tab's edit is destroyed with no conflict, no
copy and no message.

**Fix.** Give the in-memory store a way to learn that a cache row changed under
it — a `BroadcastChannel` posting `{vaultId, path}` from `markPushed` /
`markMerged` / `applyRemoteBatch` / `setResolvedClean`, with listening tabs
re-reading those rows and folding them in through the existing
`mergeChangedIntoStore` path — so that after the repro's step 3 the backend
still contains A's rename (whether because B's store was refreshed before it
saved, or because B's write was refused and three-way merged).

**Task context**

- **Why this stays at Opus 5 in plan mode, and why more context would not
  help.** Two genuine decisions have to be made by someone who owns the product,
  not inferred from the code:
  1. **What happens to a tab with an open editor on the affected entry.** The
     editor deliberately never re-reads its fields (`merge.ts:145-158`: "a live
     re-read would move the cursor and reshuffle the form under the user's
     hands"). Refreshing the store under an open editor therefore does *not*
     refresh the editor, and `touchedFieldsOnly` would then merge the user's
     next save against the newly-arrived content — which is probably right, but
     it is a behaviour change to the editor's contract and should be chosen
     deliberately.
  2. **Refresh, or force a conflict?** A narrower alternative closes the *loss*
     without any cross-tab messaging: stamp each row with the id of the tab that
     last wrote it, and have `recordLocalEdit` drop `version` to `undefined`
     when the existing row was last written by a different tab — the write then
     goes out as a create, the backend refuses it, and `resolveCollision`'s
     three-way merge (which already has the right `baseContent`) does the rest.
     That is smaller and safer but leaves Tab B's *display* stale, which is its
     own reportable bug. Choosing between "make tabs coherent" and "make the
     second tab conflict loudly" is the plan-mode question.
- **Where a fix lands, once chosen.** Publishers: `cache/files.ts`'s
  `markPushed` (line 108), `markMerged` (line 140), `setResolvedClean` (line 99)
  and `applyRemoteBatch` (line 167). Subscriber: the same seam `reconcileWithBackend`
  already uses — `mergeChangedIntoStore` (`sync.ts:361-390`), which is already
  written to touch one vault layer and to route parse failures and the
  round-trip audit correctly. A new listener should call it rather than write
  the store directly.
- **The trap, located.** `getInFlightPaths` (`inFlight.ts:45`) is per-process
  in-memory bookkeeping, so it protects nothing across tabs: a broadcast landing
  while this tab has a write in flight must be filtered by that set, or the
  refresh will paint over an edit that is still only in the store. The same
  reasoning that put `effectiveSkip` in `reconcileWithBackend` (`sync.ts:429-433`)
  applies verbatim.
- **The precedent for returning-a-request-rather-than-calling-up.**
  `SyncCycleResult` (`sync.ts:722-745`) — the cache layer is downstream of the
  store, so a broadcast handler must not import `@/store`; hand the affected
  paths upward as data, the way `releasedVaults` already travels.

---

### #3 — A DST spring-forward truncates bounded series and rewrites clock times

- **Invariant violated:** 8 (temporal correctness), and the boundary rule
  `src/model/AGENTS.md` states for `expandNode` — "a recurrence rule has to mean
  the same thing on every device". Fires when a series' clock time falls inside
  its viewer's spring-forward gap (02:00–02:59 in most of the US and EU;
  01:00–02:59 in zones with a two-hour jump such as Antarctica/Troll) and the
  series either is `count`-bounded, is `until`-bounded with a `time`, or repeats
  `after_completion`.
- **Category:** `temporal`
- **Failure mode:** **Silent.** The occurrence simply is not there; nothing warns.
  The `after_completion` half is worse than silent — it writes a wrong value
  into the user's file.
- **Impact:** **6** — a scheduled occurrence disappears, and a clock time the
  user authored is silently rewritten to disk. Held below the round-trip
  findings because it needs an anchor time in a one-hour window that exists once
  a year per zone; raised above a 4 because the same file expands *differently
  for two readers*, which is the precise failure the engine's boundary rule was
  written to make impossible.

**Repro (a).** Starting file, verbatim:

```markdown
---
title: Standup
date: 2024-03-08
time: "02:30"
repeat:
  type: schedule
  freq: daily
  end:
    type: count
    occurrences: 10
---
```

Operation: expand it over 2024 with `TZ=America/New_York`.

**Observed:** 9 occurrences — `2024-03-08` through `2024-03-16`.
**Expected:** 10 — through `2024-03-17`, which is what the same file yields
under `TZ=UTC`.

**Repro (b).** Starting file, verbatim:

```markdown
---
title: Water the plants
date: 2024-03-10
time: "02:30"
repeat:
  type: after_completion
  interval: 3 days
---
```

Operation: tick the 2024-03-10 occurrence done (the agenda checkbox), with
`TZ=America/New_York`.

**Observed** — the file now reads:

```markdown
---
title: Water the plants
date: 2024-03-10
time: 02:30
repeat:
  type: after_completion
  interval: 3 days
instances:
  - date: 2024-03-10
    time: 03:30
    done: true
---
```

The instance is stamped `03:30`, an hour later than the series it belongs to and
than anything the user typed. Under `TZ=UTC` the same action writes `02:30`.

**Expected:** `time: 02:30`, matching the series and the file.

Failing tests (`src/model/__tests__/` — all four pass under `TZ=UTC` and fail
under `TZ=America/New_York`; a permanent version should pin the zone rather than
depend on the runner's):

```ts
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { serializeEntry } from '@/model/collapse'
import { expandRange } from '@/model/expansion'
import { toggleDone } from '@/model/storeOps'
import type { Entries } from '@/types'

function expand(content: string) {
  const p = parseToStoreItems('a.md', content, 'v')
  return expandRange(p.items, new Map([[p.key, p.root]]),
    new Date(2024, 0, 1), new Date(2024, 11, 31, 23, 59, 59))
}

describe('DST spring-forward', () => {
  it('a daily count:10 series yields 10 occurrences', () => {
    expect(expand(`---\ntitle: S\ndate: 2024-03-08\ntime: "02:30"\nrepeat:\n  type: schedule\n  freq: daily\n  end:\n    type: count\n    occurrences: 10\n---\n`)).toHaveLength(10)
  })

  it('a weekly count:5 series anchored on the transition weekday yields all 5', () => {
    expect(expand(`---\ntitle: W\ndate: 2024-02-25\ntime: "02:30"\nrepeat:\n  type: schedule\n  freq: weekly\n  end:\n    type: count\n    occurrences: 5\n---\n`).map(o => o.date))
      .toEqual(['2024-02-25', '2024-03-03', '2024-03-10', '2024-03-17', '2024-03-24'])
  })

  it('an until bound carrying a time still admits its last day', () => {
    expect(expand(`---\ntitle: U\ndate: 2024-03-08\ntime: "02:30"\nrepeat:\n  type: schedule\n  freq: daily\n  end:\n    type: until\n    date: 2024-03-15\n    time: "02:30"\n---\n`).map(o => o.date))
      .toContain('2024-03-15')
  })

  it('completing an after_completion occurrence keeps its authored clock time', () => {
    const CONTENT = `---\ntitle: A\ndate: 2024-03-10\ntime: "02:30"\nrepeat:\n  type: after_completion\n  interval: 3 days\n---\n`
    const p = parseToStoreItems('n.md', CONTENT, 'v')
    const entries: Entries = new Map([[p.key, p]])
    const [occ] = expand(CONTENT)
    const e = toggleDone({ entries }, occ!).entries.get(p.key)!
    expect(serializeEntry(e.items, e.root)).not.toContain('03:30')
  })
})
```

**Breadth.** Two independent defects in one file. Search run: a differential
expansion sweep over 9 timezones × 13 repeat rules × 6 anchors × 4 times, then a
48-time-of-day sweep per zone asserting exact `count` cardinality for daily,
weekly, monthly and yearly frequencies over 2024. Results: **daily continuity is
correct in every zone** (366 distinct days, correct times, no duplicates —
so this is *not* a general date-walk bug); divergence is confined to the
`count`/`until`-with-time bound and to `after_completion`. Affected: every
bounded series and every `after_completion` series whose `time` falls in the
gap — 2 of 48 half-hourly times in New York and Berlin, 4 of 48 in Troll.

**Evidence.** `src/model/expansion.ts:257-264` — the cursor advances by
wall-clock `setDate`, so once it steps onto a non-existent local time JavaScript
normalises it forward an hour and it stays an hour ahead for the rest of the
walk:

```ts
  function nextBase(d: Date): Date {
    const n = new Date(d)
    if (freq === 'daily')        n.setDate(n.getDate() + interval)
    else if (freq === 'weekly')  n.setDate(n.getDate() + 7 * interval)
    else if (freq === 'monthly') { n.setDate(1); n.setMonth(n.getMonth() + interval) }
    else                         { n.setMonth(0, 1); n.setFullYear(n.getFullYear() + interval) }
    return n
  }
```

while the bound it is compared against is rebuilt canonically each period by
`withTime` (`expansion.ts:236-242`), so at `expansion.ts:502-504` the drifted
cursor overshoots and the loop stops one period early:

```ts
  const walkBound = dateBound < to ? dateBound : to
  let iter = 0
  while (cursor <= walkBound && iter++ < PERIOD_WALK_LIMIT) {
```

And `src/model/expansion.ts:699` (with the same at `:719`) — the
`after_completion` branch derives the emitted clock time from the normalised
`Date` rather than from the node:

```ts
        const spec = jsDateToSpec(entry.jsTime)
```

whereas the `schedule` branch keeps `node.time` and is unaffected.

**Problem.** A bounded recurring series silently loses its final occurrence, and
a completion-driven one has its clock time rewritten an hour later in the user's
file, whenever the series' time sits in the local spring-forward gap.

**Fix.** Normalise the walk cursor through `withTime` before each comparison
(and before each `nextBase` step) so it can never drift off the anchor's
wall-clock time, and have the `after_completion` branch emit `node.time` /
`inst.time` verbatim instead of `jsDateToSpec(...).time`; afterwards all four
tests above pass in every timezone.

**Task context**

- **Sites to change.** `src/model/expansion.ts`: the cursor drift is
  `nextBase` (line 257) and `advanceCursor` (line 282) feeding the
  `while (cursor <= walkBound)` loop (line 503) and `resolveCountBound`'s own
  walk (line 447). The time rewrite is the two `jsDateToSpec(...)` emissions at
  lines 699 and 719 (`time: spec.time ?? node.time` in both). `withTime`
  (line 236) is already the canonical "put the anchor's clock time on this day"
  helper — reuse it, don't write a second one.
- **What stays.** Do **not** touch `matchesInPeriod`'s `.map(withTime)`
  (line 414) or `periodDates`' instant dedup (line 430) — the *dates* produced
  are already correct in every zone (verified: 366/366 distinct days for a daily
  series at all 48 half-hourly times, in all 9 zones tested). Only the cursor
  and the bound disagree.
- **The trap, located.** Fixing `nextBase` alone is not enough and fixing
  `resolveCountBound` alone is not either: the count bound resolved at line 447
  and the enumeration at line 503 walk the cursor *separately*, so a fix applied
  to one leaves the other producing a mismatched bound. Both `count` and
  `until`-with-`time` reach line 503; the `until`-without-time case is
  accidentally safe because `endOfDay` puts the bound at 23:59:59, which a
  one-hour drift cannot overshoot — so a repro that only uses a plain `until`
  will look green while nothing is fixed. Test #3 above exists to catch that.
- **The second trap.** The `after_completion` fix must keep the *date* from
  `spec` (the next slot genuinely is computed by `addInterval`) and take only
  the *time* from the node — `time: node.time ?? spec.time`, not the reverse,
  and the same for an instance's own `inst.time`.
- **Verification recipe.** Run the model suite under at least
  `TZ=America/New_York` and `TZ=Antarctica/Troll` as well as `TZ=UTC`; Troll's
  two-hour jump widens the gap to 01:00–02:59 and catches an off-by-one-hour fix
  that a one-hour zone would hide.
- **Why Sonnet 5.** The mechanism is fully diagnosed, both defective
  expressions are quoted with line numbers, the correct helper already exists in
  the same file, and four tests pin the outcome. The named traps are what would
  otherwise make this an Opus job.

---

### #4 — A malformed *structural* key has nowhere to live and is deleted on save

- **Invariant violated:** 1 (round-trip fidelity), and 7 (recoverability) for
  the `excluded:` case. Fires on **any save** of an affected file — an unedited
  collapse already drops the key, so any edit anywhere in the entry writes the
  loss to disk.
- **Category:** `round-trip` `validation` `recoverability`
- **Failure mode:** **Silent.** `roundTripLoss` reports `[]` for every case
  below, because `collectKeyValues` deliberately skips `STRUCTURAL_KEYS` — so
  the one warning path (`reportRoundTripLosses`, "This is a bug — please report
  it") is structurally unable to fire for any of them.
- **Impact:** **7** — silent deletion of the key that *defines* the entry's
  schedule, plus one case that resurrects a deliberately-hidden occurrence and
  one that actively injects garbage keys into the file. Below finding #1 only
  because the shapes are less likely to be typed by hand than `tags: shopping`.

**Repro.** Six starting files, verbatim (each is the frontmatter shown plus
`title: Note`, `project: apollo` and a `Body.`):

| Starting frontmatter | Observed after a save | Expected |
|---|---|---|
| `date:`<br>`  - 2026-04-08` | the whole `date:` block is **gone**; the entry silently becomes undated | the value survives, or the file is refused as unreadable |
| `date:`<br>`  start: 2026-04-08` | `date:` **gone** | as above |
| `date: 2026-04-08`<br>`time:`<br>`  - "09:00"` | `time:` **gone** | as above |
| `date: 2026-04-08`<br>`excluded: "yes"` | `excluded:` **gone** — the occurrence the user hid reappears | as above |
| `date: 2026-04-08`<br>`instances:`<br>`  a: 1` | the whole `instances:` block is **gone** | as above |
| `date: 2026-04-08`<br>`defaults: everything` | ten new keys appear: `"0": e`, `"1": v`, `"2": e`, `"3": r`, `"4": y`, `"5": t`, `"6": h`, `"7": i`, `"8": n`, `"9": g` | as above |

The last row is the sharpest: a scalar `defaults:` is spread character-by-character
into the root, so the save *adds* ten garbage keys to the user's file.

Failing test:

```ts
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { serializeEntry } from '@/model/collapse'
import { roundTripLoss } from '@/model/roundTripCheck'

const CASES: Array<[string, string]> = [
  ['date as list',         'date:\n  - 2026-04-08'],
  ['date as mapping',      'date:\n  start: 2026-04-08'],
  ['time as list',         'date: 2026-04-08\ntime:\n  - "09:00"'],
  ['excluded as string',   'date: 2026-04-08\nexcluded: "yes"'],
  ['instances as mapping', 'date: 2026-04-08\ninstances:\n  a: 1'],
  ['defaults as scalar',   'date: 2026-04-08\ndefaults: everything'],
]

describe('malformed structural keys', () => {
  it.each(CASES)('%s survives an unedited save, or is reported', (_name, frag) => {
    const content = `---\ntitle: Note\n${frag}\nproject: apollo\n---\n\nBody.\n`
    const parsed = parseToStoreItems('note.md', content, 'v')
    const saved = serializeEntry(parsed.items, parsed.root)
    const key = frag.split('\n').pop()!.trim().split(':')[0]!

    // Either the key survives, or the guard says it was dropped. Today: neither.
    expect(saved.includes(key + ':') || roundTripLoss('note.md', content, parsed).length > 0).toBe(true)
  })
})
```

**Breadth.** All six `STRUCTURAL_KEYS` (`date`, `time`, `repeat`, `excluded`,
`instances`, `defaults`), on every node of every file. Search run: 14
malformed-structural shapes through parse → collapse → `roundTripLoss` →
`expandRange`. **6 of 14 lose bytes; 1 of 14 injects garbage; all 14 report a
clean round trip.** `repeat` in any shape happens to survive (it is stored and
re-emitted opaquely) — that is luck, not coverage: it survives because
`collapseToYaml` copies `s.repeat` through verbatim, not because anything
guards it.

**Evidence.** The hole is that `RESERVED_KEYS` excludes structural keys from the
`extra` bag while `malformedKnownFields` only ever considers `INLINE_FIELDS`, so
a wrong-shaped structural value has no home at either level.
`src/model/fieldRegistry.ts:56-65`:

```ts
/** Keys the YAML shape itself owns — never metadata, never part of `extra`. */
export const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  'date', 'time', 'repeat', 'excluded', 'instances', 'defaults',
])

/** Structural keys plus every registry key, at both levels. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...STRUCTURAL_KEYS,
  ...INLINE_FIELDS.map(s => s.key as string),
])
```

and the guard's matching blind spot, `src/model/roundTripCheck.ts:47`:

```ts
    if (STRUCTURAL_KEYS.has(k)) continue
```

The `defaults:` explosion comes from `src/model/storeItems.ts`'s `buildRoot`,
which spreads without checking the shape:

```ts
  const defaults = (rawNode.defaults as Record<string, unknown> | undefined) ?? {}
  return extractFileMetadata(
    { ...defaults, ...rawNode, body: body || undefined },
```

**Problem.** A structural key written in a shape the parser cannot type is
silently deleted from the user's file on the next save — taking the entry's
schedule, its override list, or a deliberate exclusion with it — and the
round-trip guard is explicitly coded not to look at those keys.

**Fix.** Decide where a wrong-shaped structural value goes and put it there —
either refuse the file (throw in `parseToStoreItems`, routing it to
`unreadableFiles` where it is loud, visible and untouchable) or carry it in a
structural remainder that `collapseToYaml` re-emits — and widen
`collectKeyValues` to stop skipping structural keys so the guard reports it
either way; afterwards the test above passes for all six cases.

**Task context**

- **Why this stays at Opus 5, and what the context can and cannot settle.**
  The mechanism is fully diagnosed and the sites are named below, but the choice
  between the two fixes is a product decision with real consequences either way:
  *refusing the file* means a single mistyped `date:` drops a whole entry out of
  the vault (loud, safe, and a visible regression for anyone whose file loads
  today), while *carrying a structural remainder* means `collapseToYaml` can emit
  a `date:` that disagrees with the item's own — the exact double-emission hazard
  `emitExtra`'s `STRUCTURAL_KEYS.has(k) continue` guard (`collapse.ts:176`) was
  added to prevent, so it needs a separate bag with its own emit rule rather than
  reuse of `extra`. Adding words does not make that call for the implementer.
  Worth noting that the survey's own scoring rule ("a malformed file that throws
  a visible parse error is a far better outcome than one that quietly drops a
  frontmatter key") points at refusal.
- **Sites to change, whichever way it goes.** The decision point is
  `src/model/storeItems.ts`'s `effectiveNodeToStoreItems` walk — each of the
  three `scalarToString(n.fields.date) ?? ''` / `?? 'undated'` coercions is a
  place where a non-scalar value is currently swallowed. `excluded` is read as
  `child.fields.excluded === true`, which silently treats every non-`true` value
  as "not excluded". `instances` is read as `Array.isArray(node.instances) ?
  node.instances : []` in `inheritance.ts`'s `buildEffectiveTree`. `defaults` is
  the `buildRoot` spread quoted above, and separately `childDefaults`'
  `node.defaults ?? {}` in `inheritance.ts`.
- **The guard half is independent and cheap.** `roundTripCheck.ts:47`'s skip can
  be narrowed to `instances`/`defaults` (which legitimately restructure) while
  letting `date`/`time`/`repeat`/`excluded` through — those are emitted at
  predictable positions and a lost pair is always a real loss. Doing that half
  first turns this finding from invisible into merely unfixed, and gives the
  larger change a check to work against. It pairs naturally with finding #5.
- **The trap, located.** `collectKeyValues` compares **stringified parsed
  values** (`roundTripCheck.ts:49`: `` out.push(`${k}=${JSON.stringify(v)}`) ``),
  so simply un-skipping structural keys will *not* catch finding #6's class and
  will produce false positives wherever collapse legitimately relocates a
  `date` between a node and its `defaults:`. Read that line before assuming the
  guard half is a one-character change.
- **Precedent.** `malformedKnownFields` (`fieldRegistry.ts`) is exactly this
  problem already solved once, for inline fields — including the "the raw value
  wins over the typed fallback on emission" rule that `fileMetaToYaml` /
  `occMetaToYaml` implement. Read it before designing the structural equivalent;
  the asymmetry is deliberate today only in the sense that nobody has needed the
  other half yet.

---

### #5 — The round-trip guard cannot see any value-level loss

- **Invariant violated:** none directly — this is the *guard* over invariant 1,
  and it is the reason findings #1, #4 and #6 all shipped silently.
- **Category:** `testing-gap`
- **Failure mode:** **Silent** by construction: the guard's own verdict is
  "clean", which is indistinguishable from "checked and fine".
- **Impact:** **4** — it loses no byte itself; it is why three findings that do
  were invisible.

**Repro.** `roundTripLoss` returns `[]` for all of the following, each of which
this run reproduced as a real loss or corruption:

| Input | What a save produces | `roundTripLoss` says |
|---|---|---|
| `tags: shopping` + a title edit | the line is deleted (finding #1) | `[]` |
| `date:`<br>`  - 2026-04-08` | the `date:` block is deleted (finding #4) | `[]` |
| `discord: 1234567890123456789` | `discord: 1234567890123456800` (finding #6) | `[]` |
| `zip: 01234` | `zip: 1234` (finding #6) | `[]` |
| `phone: +49123456789` | `phone: 49123456789` (finding #6) | `[]` |

Two independent causes, both quotable:

1. **It compares parsed values, not source text.** `collectKeyValues` runs on
   the output of `loadFile(...).rawNode` for *both* sides, so anything the YAML
   parser flattened is flattened identically before and after and cancels out.
   `12345678901234567890` and `12345678901234567000` are the same JS double, so
   the pair matches.
2. **It only ever checks the unedited round trip.** `roundTripCheck.ts`'s own
   header says so — "sound only on an UNEDITED round trip" — and `parseFiles`
   captures the parse specifically to keep it that way. Finding #1 happens
   entirely on the edited path.

Failing test:

```ts
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { roundTripLoss } from '@/model/roundTripCheck'

describe('roundTripLoss sees value-level loss', () => {
  it.each([
    ['a big integer',       'discord: 1234567890123456789'],
    ['a leading zero',      'zip: 01234'],
    ['a leading plus',      'phone: +49123456789'],
    ['a malformed date',    'date:\n  - 2026-04-08'],
  ])('%s', (_n, frag) => {
    const content = `---\ntitle: T\n${frag}\n---\n`
    const parsed = parseToStoreItems('n.md', content, 'v')
    expect(roundTripLoss('n.md', content, parsed)).not.toEqual([])  // ← fails today
  })
})
```

**Breadth.** One file (`src/model/roundTripCheck.ts`, 70 lines) guarding every
file in every vault, on every load — `parseFiles` runs it over the whole corpus
via `runInIdleBatches` (`parseReport.ts:37-49`). The three findings it is blind
to together cover the entire hand-authored-frontmatter surface.

**Evidence.** `src/model/roundTripCheck.ts:41-52`:

```ts
export function collectKeyValues(node: unknown): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'defaults') { out.push(...collectKeyValues(v)); continue }
    if (k === 'instances') {
      if (Array.isArray(v)) for (const child of v) out.push(...collectKeyValues(child))
      continue
    }
    if (STRUCTURAL_KEYS.has(k)) continue
    out.push(`${k}=${JSON.stringify(v)}`)
  }
  return out
}
```

and `src/model/roundTripCheck.ts:63-70`, where both sides go through `loadFile`:

```ts
  const before = new Set(collectKeyValues(loadFile(path, content).rawNode))
  const after = new Set(collectKeyValues(loadFile(path, saved).rawNode))
  return [...before].filter(pair => !after.has(pair))
```

**Problem.** The only runtime check standing between a user's frontmatter and a
lossy save compares values after both sides have already been flattened by the
same parser, and only ever inspects a save nobody edited — so it reports "clean"
for every loss this survey found.

**Fix.** Compare the frontmatter *source text* key-by-key (parse both sides with
the `yaml` package's `parseDocument` and compare each `Scalar`'s `source`, not
its JS value) and stop skipping `date`/`time`/`repeat`/`excluded`; afterwards
every row in the table above is reported instead of silently passing.

**Task context**

- **Sites to change.** `src/model/roundTripCheck.ts` only —
  `collectKeyValues` (line 41) and `roundTripLoss` (line 63). Its two consumers
  are `src/storage/parseReport.ts:40` (the idle sweep) and
  `src/model/__tests__/helpers.ts`, which **re-exports `collectKeyValues`
  deliberately** so that `unknown-keys.test.ts` uses the production comparison
  rather than a hand-synced copy. Any signature change has to keep that
  re-export working; `unknown-keys.test.ts` is the suite that will tell you
  whether the new comparison is too strict.
- **The scope split, and where it stops being Sonnet-able.** The *source-text*
  half is fully specified: `parseDocument(text)` from the `yaml` package (already
  a direct dependency — `inheritance.ts` imports `stringify` from it) gives
  `Scalar` nodes carrying `.source`, the original characters. Walking the
  document instead of the plain object and emitting `` `${k}=${scalar.source}` ``
  is a mechanical rewrite of ~20 lines. That half is **Sonnet 5**.
  The *edited-round-trip* half — checking that an `applyEdit` result did not
  lose anything it was not asked to change — is **not**: the file's header
  explains why (it needs id-normalised `StoreItem` comparison, can only say
  "something changed" rather than naming a key, and only means anything relative
  to a specific `applyEdit` call). Leave it deferred, and cover finding #1 with
  its own regression test instead.
- **The trap, located.** Collapse legitimately **relocates** a key between a
  node and its `defaults:` block and changes how many times it appears — which
  is exactly why the current check is set containment rather than equality (see
  the doc comment at `roundTripCheck.ts:34-40`). A source-text comparison must
  keep that containment semantics; switching to a positional or ordered
  comparison at the same time will produce a flood of false "losses" on every
  series file. Quoting also changes legitimately (`fileMetaToYaml` emits
  `title: "2024"` for a numeric-looking title on purpose), so a strict
  source-equality rule on *typed* fields will fire; scope the source comparison
  to keys in the `extra` bag, where nothing may be reformatted at all.
- **Measured baseline to re-check after the change.** Today the guard fires on
  exactly one shape out of the 39 probed: `duration: 90` (a bare number where the
  registry wants a string) is coerced to `duration: "90"` and correctly reported.
  After the fix, re-run the fixture corpus and confirm the only reports are the
  ones findings #1/#4/#6 predict — a guard that fires on ordinary files will be
  turned off, which is worse than one that fires on none.

---

### #6 — YAML scalars are re-emitted from JavaScript values, not from source

- **Invariant violated:** 1 (round-trip fidelity). Fires on **every save** of a
  file whose frontmatter carries a numeric-looking or explicitly-quoted scalar
  under a key Meridian does not type.
- **Category:** `round-trip`
- **Failure mode:** **Silent**, and invisible to `roundTripLoss` for the reason
  finding #5 describes — both sides parse to the same JS value, so the pair
  matches.
- **Impact:** **5** — the two genuinely destructive cases (integers past 2⁵³, a
  leading `+`) lose information that cannot be recovered from the file; the rest
  is reformatting that changes what *other* tools read. Not higher because the
  keys involved are ones Meridian does not use, so nothing in Meridian
  misbehaves — the damage is to the user's own data and to interoperability.

**Repro.** Each row is a file of the form `---\ntitle: T\n<line>\n---\n`, saved
unedited:

| Starting line | Observed | Expected | Kind |
|---|---|---|---|
| `discord: 1234567890123456789` | `discord: 1234567890123456800` | unchanged | **value corrupted** (past 2⁵³) |
| `phone: +49123456789` | `phone: 49123456789` | unchanged | **value corrupted** (`+` dropped) |
| `zip: 01234` | `zip: 1234` | unchanged | **value corrupted** (leading zero) |
| `version: 1.0` | `version: 1` | unchanged | reformatted |
| `n: 1e3` / `n: 0x1F` / `n: 0o17` | `1000` / `31` / `15` | unchanged | reformatted |
| `x: "yes"` | `x: yes` | `x: "yes"` | **interop break** — YAML 1.1 readers (PyYAML, Ruby, js-yaml's default schema, Obsidian) read the unquoted form as boolean `true` |
| `x: &a {k: v}` / `y: *a` | both expanded to full copies | anchors preserved | documented non-goal |

Failing test:

```ts
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { serializeEntry } from '@/model/collapse'

describe('scalar fidelity', () => {
  it.each([
    ['a snowflake id',   'discord: 1234567890123456789'],
    ['an E.164 number',  'phone: +49123456789'],
    ['a zip code',       'zip: 01234'],
    ['a quoted "yes"',   'x: "yes"'],
  ])('%s survives an unedited save', (_n, line) => {
    const content = `---\ntitle: T\n${line}\n---\n`
    const p = parseToStoreItems('n.md', content, 'v')
    expect(serializeEntry(p.items, p.root)).toContain(line)  // ← fails today
  })
})
```

**Breadth.** Every unknown key in every file — the whole `extra` mechanism runs
through it. Search run: 39 adversarial scalar shapes through parse → serialize.
**7 of 39 are changed**, of which 3 are unrecoverable value corruption and 1 is
an interop break. Two shapes fail *loudly* and correctly and are worth recording
as the good outcome: duplicate keys throw (`Map keys must be unique`) and route
the file to `unreadableFiles`, and `duration: 90` is the one case
`roundTripLoss` does report.

**Evidence.** The pipeline is plain-object throughout: `fileIO.ts:13-18` parses
to JS values and discards the document —

```ts
function yamlParse(text: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(text)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}
```

— and `src/model/inheritance.ts:216-221` re-derives the text from those values,
with `PLAIN` as the preferred string style, which is what drops the quotes
around `"yes"`:

```ts
  return stringify(prune(ordered), {
    lineWidth: 0,            // never wrap long scalars (e.g. titles, intervals)
    nullStr: 'null',
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trimEnd()
```

**Problem.** Every frontmatter value the user wrote is destroyed and rebuilt from
a JavaScript primitive on each save, so an ID longer than 15 digits, a
`+`-prefixed number and a leading zero come back as different values, and an
explicitly-quoted string comes back unquoted.

**Fix.** Keep the `yaml` document's `Scalar` nodes for unknown keys — parse with
`parseDocument`, carry the nodes (not their JS values) in the `extra` bag, and
re-emit them, so their `source` is reproduced verbatim; afterwards all four rows
of the test above pass.

**Task context**

- **Why this stays at Opus 5, and why the context does not reduce it.** The
  narrow fixes each solve part of the problem and none solves it:
  `parse(text, { intAsBigInt: true })` fixes the 2⁵³ case but not `01234`, `+49`
  or `1.0`; `defaultStringType: 'QUOTE_DOUBLE'` fixes `"yes"` but reformats every
  title in every file in the vault on the next save, which is a far larger diff
  than the bug. The real fix changes what flows through the pipeline, and
  *which* keys it should apply to is a product decision: applying it to typed
  fields as well would freeze Meridian's own output formatting, which the project
  has deliberately kept normalised (`AGENTS.md`'s "Deliberate non-goals"). That
  scope call is the expensive part.
- **The seam, verified in both directions.** `extra` values are `unknown` all
  the way through — `OccurrenceMetadata.extra` / `FileMetadata.extra` are
  `Record<string, unknown>` (`types.ts`), `unknownKeys` (`fieldRegistry.ts`)
  never inspects them, and `emitExtra` (`collapse.ts:170-180`) copies them
  through untouched. So a `Scalar` node can ride the whole pipeline without a
  type change. What *does* inspect them: `deepEqual` (`fieldRegistry.ts`), used
  by `computeSharedFields` for hoisting and by `emitExtra` for the baseline diff
  — it would compare node identity rather than value and silently stop hoisting.
  That is the one place that must be taught about the new representation, and
  the reason "just carry the nodes" is not a drop-in.
- **The trap, located.** `prune` (`inheritance.ts`) walks the object graph and
  rebuilds every nested object to strip `undefined`. A `Scalar`/`YAMLMap` node
  reaching it would be shredded into a plain object with `value`/`source`/`type`
  keys and emitted as such — the same character-explosion shape finding #4's
  `defaults: everything` case shows. Anything carrying nodes must bypass `prune`
  or `prune` must learn to pass `yaml` nodes through untouched.
- **The scoping decision, stated so it can be made rather than rediscovered.**
  The minimum that fixes every corruption row above without touching Meridian's
  own formatting is: unknown keys only, `extra` bag only, source preserved
  verbatim; typed fields keep today's normalising behaviour. Whether the
  `"yes"` interop row also deserves fixing for *typed* fields (a `title: "yes"`
  becoming `title: yes`) is the separate question — the README's
  hand-created-files promise argues yes, the "quoting style is a deliberate
  non-goal" note in `AGENTS.md` argues no. Put that to the user.

---

### #7 — A pending editor autosave is never flushed at page teardown

- **Invariant violated:** 6 (durability of accepted writes). Fires when the tab
  is closed, the browser crashes, or the OS evicts a backgrounded PWA within the
  1500 ms after the last keystroke.
- **Category:** `durability`
- **Failure mode:** **Silent.** The editor showed the text; nothing said it was
  not saved; on reload it is not there.
- **Impact:** **4** — bounded to one debounce window of typing, and only the
  body, but it is content the UI presented as present and nothing anywhere holds
  a copy of it: it never reached the store, so it never reached Dexie.

**Repro.** Starting state: an entry open in the editor. Operation: type; within
1.5 s of the last keystroke, close the tab (or background the PWA on iOS and let
the OS reclaim it).

**Observed:** the typing since the last committed autosave is gone on reload.
**Expected:** it is committed, exactly as it is on `goBack` and on unmount.

Failing test (`src/editor/`, jsdom):

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useAutoSave } from '@/editor/useAutoSave'
import type { EntryState } from '@/editor/state'

describe('autosave durability at teardown', () => {
  it('a pending autosave is committed when the page goes away', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const { result } = renderHook(() => {
      const entryRef = useRef({ editScope: 'all', body: '' } as unknown as EntryState)
      return useAutoSave(commit, entryRef, '')
    })
    act(() => { result.current.scheduleAutoSave('the user just typed this') })
    expect(commit).not.toHaveBeenCalled()

    // The only two signals the app gets. React unmount effects do NOT run here.
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(commit).toHaveBeenCalled()   // ← fails today
    vi.useRealTimers()
  })
})
```

**Breadth.** One file to change; every editor session in the app is exposed.
Search run: `grep -rn "flushAutoSave\|cancelAutoSave" src/` — three call sites,
all of them in-app navigation (`useEntryEditor.ts:260` `goBack`,
`useEntryEditor.ts:173` → `useVaultTarget.ts:110` on a vault-target change, and
the unmount cleanup at `useAutoSave.ts:44`). None of them is a teardown signal.

**Evidence.** `src/editor/useAutoSave.ts:46-55` — a 1500 ms debounce with no
teardown escape:

```ts
  const scheduleAutoSave = (body: string) => {
    if (entryRef.current.editScope === 'add') return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    bodyRef.current = body
    autosaveTimerRef.current = setTimeout(() => {
      commitEntry({ ...entryRef.current, body })
      autosaveTimerRef.current = null
    }, 1500)
  }
```

and `src/routes/__root.tsx:170-197`, where the two teardown signals *are* handled
— but only for the cache→backend leg, not the editor→store one:

```ts
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        flushPendingPush()
        return
      }
```

```ts
    window.addEventListener('pagehide', flushPendingPush)
```

`flushPendingPush` pushes what is already in Dexie. The pending autosave is not
in Dexie; it is in a `setTimeout`.

**Problem.** The editor's debounced body autosave has no teardown flush, so the
last 1.5 s of typing is lost when the tab closes or a backgrounded PWA is
evicted — while the two lifecycle events that would catch it are already being
listened for, one layer away.

**Fix.** Have `useAutoSave` register its own `pagehide` / `visibilitychange`
listener calling `flushAutoSave`, and ensure it runs before
`flushPendingPush`; afterwards the test above passes.

**Task context**

- **Sites to change.** `src/editor/useAutoSave.ts` — add an effect registering
  `pagehide` and `visibilitychange` (the latter guarded on
  `document.visibilityState !== 'visible'`, matching `__root.tsx:171`) that calls
  `flushAutoSaveRef.current()`. The latest-ref plumbing already exists at
  `useAutoSave.ts:41-43` and is there for exactly this reason; reuse it rather
  than capturing `flushAutoSave` in the listener's closure.
- **The ordering trap, located.** `flushAutoSave` → `commitEntry` →
  `commitNext` → `persistEntries` → `writeEntity`, and `writeEntityToCache`
  (`entityWrites.ts`) reaches its first `await` before `recordLocalEdit` starts.
  During `pagehide` there is no guarantee a later microtask runs, so the editor
  flush must be registered such that it runs **before** `__root.tsx`'s
  `flushPendingPush` — otherwise the push scans a cache that does not yet have
  the row. Listener order for the same event on the same target is registration
  order, and `__root.tsx`'s effect runs at app mount, i.e. *first*. Registering
  from the editor hook therefore puts it second. Two workable answers: register
  the editor's flush on `__root`'s own handler via a ref (the pattern
  `flushEditsRef` at `useEntryEditor.ts:91` already establishes), or accept that
  the next launch's `syncOnActivate` → `pushDirty` rescues the row — which it
  does, since the Dexie write is what matters and the push is best-effort by
  design (`__root.tsx:173-177` says so). Prefer the ref: it makes the ordering
  explicit instead of relying on the rescue.
- **What stays.** Do not touch `cancelAutoSave` (`useAutoSave.ts:31-34`) or its
  call site in `handleDelete` (`useEntryEditor.ts:280`) — it deliberately drops a
  pending save so `goBack`'s flush cannot resurrect an item that is about to be
  deleted. A teardown listener added without checking that `cancelAutoSave` has
  already cleared the timer would reintroduce exactly that resurrection.
- **The `add`-scope guard.** `scheduleAutoSave` returns early for
  `editScope === 'add'` (`useAutoSave.ts:47`), so a brand-new draft never has a
  pending timer and the new listener is a no-op there. That is correct and
  should stay — a teardown flush that created a file from an abandoned draft
  would be a new bug.
- **Why Sonnet 5.** One file, one effect, the latest-ref pattern already
  present, a jsdom repro that fails before and passes after, and the one real
  hazard (listener ordering against `flushPendingPush`) named with both
  acceptable resolutions.

---

## Note on the survey file

`plans/surveys/data-integrity.md` was updated in a separate commit on this run:
the five "Known suspects" verdicts were re-issued against current `main` (two
are now settled and one is newly confirmed with a repro), and a handful of
process improvements this run surfaced were proposed as ordinary diffs on that
file — chiefly that the survey should require probing the **edited** round trip
explicitly, not just the unedited one, since that is where three of this run's
four fidelity findings live and where the repo's own guard does not look.
