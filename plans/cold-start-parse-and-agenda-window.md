# Cold start: the vault parse and the agenda's 455-day window

Implementation plan for the two remaining items from the scroll-to-today
investigation (2026-08-08). Options A/B/C from that investigation shipped in
PR #645 (`1eda75b`); this covers **D** (the blocking vault parse) and **E**
(the agenda's past/future window). Unlike the other files in `plans/`, this is
an implementation plan rather than a survey prompt.

## Measured baseline

From a production cold-start trace on `realjohndoe.github.io/meridian` (a real
GitHub-backed vault, desktop Chrome, hot Dexie cache). Times are sample-time
attribution — actual `timeDeltas` summed per category, not sample counts —
over the 671 ms between the start of the vault-parse task and the first
correct paint:

| Category | Time | What it is |
|---|---|---|
| `model` chunk (YAML) | **314 ms** | `parseFiles` → `parseToStoreItems` + `roundTripLoss` |
| `calendar` chunk | **173 ms** | expansion, grouping, agenda render — *includes the 66 ms scroll re-render that A removed* |
| browser internals / `(program)` | 134 ms | |
| React (`main` chunk only) | 32 ms | |
| GC | 22 ms | |

Structure of the cold start, for reference:

- `12250` navigation → `12716` FCP (shell + agenda skeleton)
- `12729–13178` **one 449 ms blocking task**: `hydrateFromCache` →
  `cacheLoadAll` (Dexie) → `parseFiles` → `setData`. Within it, ~260 ms is
  inside the YAML parser and ~47 ms is `setData` rebuilding the derived `fom`
  and `backlinks` indexes.
- `13233` first paint of real rows
- `13392` correct content

So after A/B/C, **D is the single largest remaining item** and E is a distant
second. Everything below assumes that ordering.

---

## D — the blocking vault parse

`hydrateFromCache` ([storage/vaultRegistry.ts:53](../src/storage/vaultRegistry.ts))
reads every cached file out of Dexie and hands it to `parseFiles`
([storage/sync.ts:52](../src/storage/sync.ts)), which is a single synchronous
`for` loop over the whole vault. Nothing paints until it returns.

### D1 — Measure the `roundTripLoss` split first (blocking; do not skip)

`parseFiles` calls `roundTripLoss(path, content, parsed)` for **every file on
every load**. That function
([model/roundTripCheck.ts:61](../src/model/roundTripCheck.ts)) does one
`collapseToYaml` + `saveFile` serialize and **two** further `loadFile` calls —
so a load performs *three* YAML frontmatter parses per file where one would
do. Its own doc comment budgets this at ~0.5 ms/file over a 300-file corpus.

The trace **cannot confirm the split**: V8 inlined the frames between the
`parseFiles` loop and the shared YAML entry point, so all three parses
collapse onto one stack. Structurally it should be ~2/3 of the parse time, but
that is an inference, not a measurement. Measure it before acting on it.

**Recipe.** Patch `performance.mark`/`measure` pairs around the
`parseToStoreItems` call and the `roundTripLoss` call inside the `parseFiles`
loop; load the Tutorial vault with `localStorage.setItem('meridian_bigvault',
'300')` (the generator at `src/storage/devFixtures/testVaultGen.ts`); read the
totals back with `performance.getEntriesByType('measure')`. Measure against
the **production build** (`pnpm run build` + `vite preview`) — dev-mode React
does not affect this loop much, but the YAML path is hot enough that
minification matters. Revert the instrumentation afterwards.

This number decides whether D2 is the whole fix or a footnote.

### D2 — Stop paying the round-trip guard on the load path

The guard is a runtime canary for the Root-A totality invariant. Its own
header says every known leak is fixed and pinned by
`__tests__/round-trip-totality.test.ts`, and that it is *expected never to
fire*. Paying a 3× parse amplification on every cold start for that is the
wrong trade. Options, cheapest first:

1. **Sample it.** Run it on a bounded random subset per load (say 20 files, or
   5%). A systematic parser regression shows up on the first load either way;
   only a single-file oddity could hide, and it will surface on a later load.
2. **Defer it.** Run the full sweep in `requestIdleCallback` batches *after*
   first paint, off the critical path entirely. Keeps 100% coverage, costs
   nothing user-visible. Preferred if D1 says the guard is the dominant cost.
3. **Dev-only.** Gate on `import.meta.env.DEV`. Cheapest, but throws away the
   whole point — the guard exists to catch the next leak on a *real* vault,
   which is exactly the case a dev build never sees. Only take this if 1 and 2
   both prove awkward.

Recommendation: **(2), falling back to (1)** if the idle-batch bookkeeping
turns out to be more machinery than it is worth. Either way, keep
`reportRoundTripLosses` and its toast — only the *timing* changes.

Note the other two `parseFiles` callers — `activateExampleVault`
([vaultRegistry.ts:104](../src/storage/vaultRegistry.ts)) and
`mergeChangedIntoStore` ([sync.ts:342](../src/storage/sync.ts)) — get the same
change for free. The reconcile path in particular re-parses every changed file
on every sync, so this is not only a cold-start win.

### D3 — Take the remaining parse off the main thread

Whatever D2 leaves (structurally ~100 ms of genuine parse on this vault, more
on bigger ones and on mobile) is still a synchronous block before first paint.

`parseFiles` is a **pure function of `files`** — no DOM, no store, no
`activeBackend`. That makes it directly worker-eligible, which is the main
reason to prefer this over restructuring the call site.

- **Transfer shape:** in `{path, content}[]` (strings), out `StoreItem[]` +
  `Roots` (a `Map`) — `StoreItem.metadata.jsTime` is a `Date`. All
  structured-cloneable, so no manual serialization is needed.
- **The risk is the clone, not the parse.** A vault's worth of strings in and
  a large object graph out could plausibly cost 30–80 ms of clone on each
  side, eating much of the win. **Measure the clone cost with a stub worker
  that echoes the input back before writing any real parsing logic.** If the
  round-trip clone is more than ~30% of the parse it replaces, stop and take
  D4 instead.
- Console warnings inside the loop (`[vault] parse failed…`) need to become
  part of the returned payload rather than direct `console.warn` calls.

**Explicitly rejected: chunking the parse across frames.** It would keep the
main thread responsive but would *not* make first-correct-paint sooner, and a
partially-parsed vault yields a wrong overdue list and a wrong today section —
so the agenda cannot paint progressively anyway. It trades a visible 450 ms
block for the same 450 ms of jank with no benefit.

### D4 — Cache the derived items, not just the raw markdown

The structural fix, and the one that makes cold start not parse *at all*. Also
the fallback if D3's clone cost sinks the worker.

Today the Dexie `files` table stores raw `content`
([storage/cache.ts:43](../src/storage/cache.ts)), and it is simultaneously the
sync source of truth (dirty flags, base versions, tombstones) — so it **cannot
be replaced** with parsed output. Add a *second*, derived table instead:

```
derived: 'vaultId'   // { vaultId, parserVersion, contentStamp, items, roots }
```

- `parserVersion` is a hand-bumped constant in `model/`. Any change to parsing
  or collapse semantics bumps it, invalidating every cached derivation. This
  is the part that is easy to get wrong and expensive to get wrong — a stale
  derivation is silent data corruption from the user's point of view.
- `contentStamp` guards against the `files` table moving underneath it. Cheap
  and sound: `files.where('vaultId').equals(id)` already scans the rows, so
  fold `updatedAt` and row count into a stamp during that scan rather than
  hashing content.
- Write it after every `setData` that came from a full parse; drop it on any
  write to `files` for that vault.

Cold start then becomes one Dexie read plus a structured clone, with the
existing parse path as the fallback whenever the stamp or parser version
misses. `setData`'s ~47 ms of `fom`/`backlinks` rebuilding stays — deriving
*those* into the cache too is possible but should be a separate step, only if
measurement says they still matter.

**Sequencing:** D1 → D2 → measure again. Only then decide between D3 and D4;
they are alternatives, not a sequence, and D4 subsumes D3 if it lands.

---

## E — the agenda's 455-day window

`useAgendaSections` ([calendar/useAgendaSections.ts:14](../src/calendar/useAgendaSections.ts))
expands, groups and sorts `PAST_WINDOW_DAYS = 365` + `FUTURE_WINDOW_DAYS = 90`
days on every cold start.

### E has shrunk — re-scope it before building anything

The original argument for E was "put today near offset 0 so `scrollToIndex`
has nothing to correct". **A delivered that**: the virtualizer is now seeded at
today's offset directly and never scrolls on mount. The 66 ms synchronous
re-render inside the scroll event is gone, which is most of what made the
window size hurt.

What is left is ~107 ms of expansion + grouping + agenda render (173 ms
measured, minus the 66 ms that A removed) on cold start only — cached
thereafter by `sectionsCacheSlot` and `cacheByWindow`. That is worth having
but it is **an order of magnitude less than D**, and it competes with the
best-tested logic in the calendar layer. Do D first and re-measure; if the
agenda's share has not moved, E may not be worth its risk at all.

### The constraint that makes the obvious version wrong

"Only build rows from today forward, prepend past days on scroll-up" **does
not work as stated**. The overdue section pools every undone task from every
past day — that is why `PAST_WINDOW_DAYS` was widened from 7 to 365 in the
first place (see the comment at the top of `useAgendaSections.ts`). Skipping
past days means an incomplete overdue list, which is a correctness regression,
not a perf trade.

The two halves must be separated:

- **Scanning** the past is required, for overdue. It is a filter + pool over
  already-expanded occurrences.
- **Materializing rows** for past *day-sections* is not. Only past days with
  non-overdue leftovers produce a section at all (`buildBucket` returns
  `section: null` otherwise), and on a typical vault most past days are either
  empty or fully drained into overdue.

So the shape of E, if it is taken:

1. Keep the expansion window as-is; keep pooling overdue across all of it.
2. Build `rows` for past day-sections **lazily** — materialize today-forward
   plus overdue eagerly, and past day-sections only when the user scrolls
   above the overdue header.
3. That requires a stable total size for the un-materialized region so the
   scrollbar and the seeded offset stay honest — a per-day row *count* and
   estimated height, which `buildBucket` can produce without building the
   rows.

Note that `offsetOfRow` in `useAgendaScrollRestore` sums every row above the
target on mount; step 2 makes that loop trivially short, which is a small
bonus rather than the point.

### Cheaper alternatives to consider first

- **Shrink `FUTURE_WINDOW_DAYS`.** 90 days of future rows are materialized on
  every cold start and are almost never scrolled to. Cutting it to ~30 is a
  one-line change with no correctness implications and should be measured
  before any of the above is attempted.
- **Split expansion from grouping across a paint.** Expand + pool overdue and
  today eagerly; do the rest of the grouping in an idle callback. Smaller
  change than lazy rows, most of the benefit.

---

## Acceptance

Re-run the same cold-start trace (production build, hot Dexie cache, the
300-file generated vault) and compare against the baseline table above:

- **D2 alone:** the 449 ms task shrinks by the share D1 measured for
  `roundTripLoss`.
- **D3 or D4:** no single main-thread task over ~100 ms between navigation and
  first correct paint.
- **E:** `calendar`-chunk attribution over the load window drops below ~60 ms.

Correctness gates that must not regress: `round-trip-totality.test.ts` still
passes and `reportRoundTripLosses` still surfaces a real loss (D2); a parser
change invalidates every derived cache entry (D4); the overdue section
contains exactly the same occurrences before and after (E).
