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

Yes — Meridian can lose the user's writing. The worst still-open case is a
**malformed structural key**: a hand-written `date:`, `excluded:` or
`instances:` in a shape the parser can't type has no `extra` home and is
silently deleted on the next save, in one case reviving an occurrence the user
had deliberately hidden (finding #4).

(Two of the run's worst findings are now fixed: an editor save deleting
unrelated hand-authored frontmatter — `tags`/`done`/`priority` the model can't
type — on every save regardless of what was actually edited (finding #1); and
a second view of the same vault silently overwriting the first with its
compare-and-swap intact (finding #2) — cache writes are now announced across
views and folded back into each one's store, and an open editor adopts what it
did not touch and reports what both sides moved.)

The single biggest structural theme is that **the round-trip guard checks the
wrong round trip**. `roundTripLoss` is sound only on an *unedited* file (its own
doc comment says so), so an edit's own losses stay invisible to the one runtime
check that exists to find the next one. Its other half — comparing parsed values
rather than bytes — is fixed: unknown keys are now compared by source text, and
finding #6's re-derived scalars, which that change made visible, are now
preserved rather than merely reported.

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
| 1 | Round-trip fidelity & edit locality | **findings: #4** |
| 2 | Lost updates & conflict handling | **clean** |
| 3 | Cache coherence & durability | **clean** |
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
| **#3** | A DST spring-forward truncates bounded series and rewrites clock times | 8 | **silent** | 6 | 2 defects in 1 file; every bounded or `after_completion` series timed inside the gap | Sonnet 5 |
| **#4** | A malformed *structural* key has nowhere to live and is deleted on save | 1, 7 | **silent** | 7 | all 6 `STRUCTURAL_KEYS`, every node of every file; 6 of 14 probed shapes lose bytes | Opus 5 |

Numbers are identity **and** rank for this run — the two coincided, so there is
no separate rank column to read.

**Sequencing note.** #4 lands in the parse/emit pipeline. The guard over that
pipeline (formerly tracked as finding #5 — it compared parsed values rather
than source text and skipped `date`/`time`/`repeat`/`excluded` outright) is now
fixed, so `roundTripLoss` will surface it as soon as its own fix lands. #4's own
widening of `collectKeyValues`' `STRUCTURAL_KEYS` skip is already done as part
of the guard fix, so #4 only has the deletion itself left to fix. #3 is
independent of it.

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
- **The guard half is done.** It shipped as part of finding #5's fix:
  `roundTripCheck.ts`'s skip now only special-cases `instances`/`defaults`
  (which legitimately restructure); `date`/`time`/`repeat`/`excluded` are
  compared by parsed value like any other registry field, so a save that
  drops one is no longer invisible to `roundTripLoss` — only unfixed. What is
  left for this finding is the deletion itself.
- **Precedent.** `malformedKnownFields` (`fieldRegistry.ts`) is exactly this
  problem already solved once, for inline fields — including the "the raw value
  wins over the typed fallback on emission" rule that `fileMetaToYaml` /
  `occMetaToYaml` implement. Read it before designing the structural equivalent;
  the asymmetry is deliberate today only in the sense that nobody has needed the
  other half yet.

---

## Note on the survey file

`plans/surveys/data-integrity.md` was updated in a separate commit on this run:
the five "Known suspects" verdicts were re-issued against current `main` (two
are now settled and one is newly confirmed with a repro), and a handful of
process improvements this run surfaced were proposed as ordinary diffs on that
file — chiefly that the survey should require probing the **edited** round trip
explicitly, not just the unedited one, since that is where most of this run's
fidelity findings live and where the repo's own guard does not look.
