# Vault-scaling stress test

_How Meridian's hot paths scale with vault size, measured 2026-08-28 against
`54ab5cb`: 300 / 1 000 / 3 000 / 10 000 / 30 000 files in two vault shapes,
plus 60 000 and 100 000 to find the ceiling. The question: which flows degrade
first, whether files or expanded occurrences are the unit, and where memory
runs out._

This is a finished measurement report, like `storage-backend.md` — not a
runnable survey template, and not a to-do list. The **findings it produced**
lived in `plans/vault-scaling-results.md`, a checklist that was deleted as
they closed out; now that it is gone, "Where the findings went" at the end of
this file records what happened to each of the six. What stays here otherwise
is the method, the curves, and the two structural answers, which remain true
of the architecture until someone changes it.

**Keeping this current.** Fixing any finding invalidates specific rows, not
the report: re-run the harness (see the end) and replace the affected numbers,
keeping the commit the run was taken against in the line above. The
files-versus-occurrences answer and the memory attribution are properties of
the eager-expansion design; if a fix changes that design, they need re-deriving
rather than editing.

## Verdict

**Meridian scales with occurrences, not with files, and nothing else comes
close.** Thirty thousand files is a non-event when they are one-shot entries —
1.9 s to first paint, a 167 ms toggle, a 140 MB heap. The same thirty thousand
files at the generator's default mix (15% weekly series → 836 000 occurrences
in the agenda's ±455-day window) takes 13 s to paint, 7.3 s to toggle a
checkbox, and 1.3 GB of heap. Same file count, same bytes on disk, 36× the
occurrences, and every derived-data flow degrades in proportion. The single
structural cause is that **three separate passes expand the whole window
eagerly and materialise every occurrence in it** — the agenda's own expansion
(±455 days), `fileOccurrenceMap`'s (±3 years, 4.8× wider, for one
representative per file), and `computeExpansionCache`'s overlay, which
re-allocates the entire occurrence array on every metadata edit. The flows
that *don't* touch expanded occurrences — search, CodeMirror keystrokes,
backlinks, the Dexie cache — are flat or near-flat all the way to 30 000
files. **Dexie never runs out of anything**: 30 000 files is 42 MB of
IndexedDB against a ~0.85–1.1 GB quota. The ceiling is the JS heap, and 90% of
it is expansion product, not vault content.

## What was measured, and how to read it

**Measured end to end** (real browser, real DOM, real modules): cold start,
toggling a task, agenda scrolling, agenda↔month↔day switches, search, opening
an entry, CodeMirror keystroke latency; and stage by stage, `parseToStoreItems`
→ `deriveViews` → `buildBacklinkIndex` → `computeExpansionCache` →
`computeAgendaSections` → `rankByQuery` → `updateFileOccurrenceMap`. Dexie
measured directly through `applyRemoteBatch` / `cacheLoadAll` /
`cacheGetDirty`.

**Vault shapes.** `mixed` is the historical generator mix — 15% of files carry
a `weekly / [mo,we,fr]` repeat, giving ~28 occurrences per file over the
agenda window. `flat` (`recurringShare: 0`) has no recurrence at all, so
occurrences ≈ files. Both shapes were run at every size; that pairing is what
separates the two units. The generator grew the option for this run
(`src/storage/devFixtures/testVaultGen.ts`); its default is unchanged, so
every earlier measurement remains comparable.

**Read as a scaling curve, not as shipped latency.** The large-vault generator
is dev-only (`import.meta.env.DEV`), so this runs against the dev server:
unminified dev React, the React Compiler's dev output, and one HTTP request
per module. The *pipeline* numbers are close to production — they are plain JS
over `date-fns`/`yaml` with no React in them — but the *UI* numbers carry
dev-React's render overhead and should be treated as an upper bound, probably
by around 2×. The shape of every curve is unaffected.

**`coldStart.vaultPaintMs`, not `firstAgendaRowMs`.** A fresh browser context
in dev spends ~12.6 s fetching modules whatever the vault holds; that constant
is excluded, and the reported figure is DOMContentLoaded → first agenda row.

**Not measured.** The local-FS and GitHub backends (the automated browser
cannot grant File System Access or complete OAuth — traced statically only,
though both funnel into the same `parseFiles` → `setVaultLayer` path that was
measured through the example backend). Production-build absolutes, for the
generator reason above. Mobile-class hardware and mobile memory caps — the
memory extrapolation below is stated as arithmetic, not measurement.

**Two gaps in the harness itself**, recorded rather than papered over:
`toDay` timed out on `flat/300` and `flat/1000` (its readiness marker,
`.now-line`, did not appear; every larger flat size measured fine and flat, so
no conclusion depends on the two missing cells), and `search.resultRows` read
0 at 60 000 and 100 000 where the results panel's spacer selector missed. The
long-task columns are best-effort: React 19's concurrent renderer yields every
few ms, so a 7-second interaction can legitimately contain no >50 ms task.

**Four columns below are no longer reproducible.** Those two gaps were the
visible half of a fragility the whole UI phase shared, so the view switches
(`→ month`, `→ day`, `→ agenda`), search, opening an entry and the CodeMirror
keystroke measurement were removed from the harness after this run — they
carried nine of its eleven DOM selectors and measured, between them, one
finding that is corroborated elsewhere and three flows that came out flat. The
numbers in those columns were measured and stand as a record; re-running the
harness reproduces everything else. See the comment on `measureUI` in
`scripts/perf/stress.mjs`.

## The measured curves

Occurrence counts are for the agenda's own window (`-PAST_WINDOW_DAYS` /
`+FUTURE_WINDOW_DAYS`, i.e. −365/+90 days).

| vault | files | occurrences | agenda rows | bytes |
|---|---|---|---|---|
| mixed/300 | 300 | 8 713 | 2 007 | 0.08 MB |
| mixed/1 000 | 1 000 | 24 601 | 5 583 | 0.27 MB |
| mixed/3 000 | 3 000 | 80 614 | 18 038 | 0.83 MB |
| mixed/10 000 | 10 000 | 291 475 | 64 763 | 2.80 MB |
| mixed/30 000 | 30 000 | 836 028 | 185 882 | 8.52 MB |
| mixed/60 000 | 60 000 | 1 675 967 | 372 475 | 17.13 MB |
| mixed/100 000 | 100 000 | 2 811 025 | 624 349 | 28.59 MB |
| flat/30 000 | 30 000 | 23 075 | 16 626 | 8.08 MB |

### Pipeline stages (ms, median)

| vault | parse | deriveViews | backlinks | expand (agenda) | agendaSections | rankByQuery | toggle recompute | fileOccurrenceMap |
|---|---|---|---|---|---|---|---|---|
| mixed/300 | 23.5 | 0.2 | 0.9 | 47.4 | 34.4 | 0.8 | 1.0 | 133.3 |
| mixed/1 000 | 54.9 | 0.3 | 1.8 | 114.5 | 66.7 | 1.4 | 2.4 | 358.7 |
| mixed/3 000 | 155.8 | 0.3 | 5.9 | 389.4 | 239.4 | 4.9 | 7.2 | 1 110.9 |
| mixed/10 000 | 609.5 | 2.6 | 32.1 | 1 720.5 | 1 030.1 | 15.3 | 226.7 | 4 227.2 |
| mixed/30 000 | 1 987.3 | 10.3 | 137.8 | 7 109.6 | 3 631.4 | 45.2 | 744.8 | 10 448.2 |
| mixed/60 000 | 3 196.9 | 10.3 | 223.6 | 16 687.8 | 7 176.1 | 77.1 | 1 555.2 | 33 848.8 |
| mixed/100 000 | 5 060.7 | 20.7 | 443.6 | 34 749.6 | 12 527.6 | 123.8 | 2 586.4 | 62 701.3 |
| flat/300 | 20.2 | 0.2 | 0.7 | 0.8 | 9.6 | 0.4 | 0.3 | 0.8 |
| flat/1 000 | 55.5 | 0.3 | 1.7 | 2.3 | 10.8 | 1.7 | 0.7 | 2.7 |
| flat/3 000 | 153.8 | 0.2 | 5.7 | 8.5 | 16.9 | 4.0 | 1.9 | 7.7 |
| flat/10 000 | 464.5 | 1.2 | 27.7 | 20.1 | 32.9 | 12.2 | 6.3 | 19.3 |
| flat/30 000 | 1 466.8 | 6.3 | 120.5 | 72.2 | 87.2 | 40.4 | 23.5 | 65.0 |

### UI flows (ms from event to painted effect)

| vault | vault paint | toggle | scroll p95 frame | janky /30 | → month | → day | → agenda | search | open entry | keystroke p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| mixed/300 | 349 | 63 | 66.7 | 2 | 468 | 476 | 138 | 292 | 2 601 | 16.7 |
| mixed/1 000 | 561 | 120 | 66.8 | 3 | 489 | 351 | 137 | 288 | 590 | 16.6 |
| mixed/3 000 | 1 388 | 426 | 66.7 | 8 | 559 | 363 | 252 | 267 | 631 | 16.7 |
| mixed/10 000 | 4 352 | 2 021 | 100.0 | 27 | 1 568 | 1 111 | 928 | 232 | 970 | 16.7 |
| mixed/30 000 | 13 007 | 7 310 | 216.7 | 30 | 9 619 | 8 630 | 2 760 | 301 | 2 690 | 16.7 |
| mixed/60 000 | 30 488 | 16 193 | 500.0 | 30 | 36 024 | 32 330 | 5 791 | 347 | 7 289 | 16.7 |
| mixed/100 000 | 58 855 | 24 913 | 35 165 | 30 | 93 413 | 85 226 | 12 775 | 586 | 19 536 | 16.7 |
| flat/300 | 276 | 42 | 50.0 | 1 | 398 | — | 102 | 284 | 579 | 16.7 |
| flat/1 000 | 327 | 37 | 50.1 | 3 | 428 | — | 107 | 292 | 553 | 16.6 |
| flat/3 000 | 493 | 43 | 50.0 | 1 | 429 | 334 | 104 | 294 | 574 | 16.7 |
| flat/10 000 | 890 | 68 | 50.1 | 3 | 508 | 355 | 121 | 264 | 628 | 16.6 |
| flat/30 000 | 1 877 | 167 | 83.2 | 6 | 509 | 354 | 165 | 295 | 657 | 16.6 |

`search` includes `FileResultsList`'s own 150 ms debounce, which is most of
it. `open entry` at mixed/300 (2 601 ms) is an outlier — flat/300 is 579 ms and
mixed/1 000 is 590 ms — and is most likely that context's first fetch of the
lazily-loaded editor route. It is not a vault cost; the vault-dependent growth
in that column starts at 10 000.

### Where it stops being usable

| occurrences | files (default mix) | verdict |
|---|---|---|
| ≤ 25 000 | ~1 000 | Indistinguishable from the tutorial vault. Toggle 120 ms, paint 0.6 s. |
| ~80 000 | ~3 000 | First visible degradation: 1.4 s paint, 426 ms toggle, 8/30 scroll frames janky. |
| ~290 000 | ~10 000 | Broken for daily use: 4.4 s paint, 2 s toggle, 27/30 janky. |
| ~840 000 | ~30 000 | Unusable: 13 s paint, 7.3 s toggle, 9.6 s to open the month view, ~5 fps scrolling. |
| ~2 800 000 | ~100 000 | Still does not crash. 59 s paint, 25 s toggle, 93 s month switch. |

In the flat shape the same table has no rows: at 30 000 files / 23 000
occurrences every flow is still in its "indistinguishable" band.

## Files or occurrences?

**Occurrences, decisively.** Holding files at 30 000 and varying only the
recurrence share:

| cost | flat (23 k occ) | mixed (836 k occ) | ratio |
|---|---|---|---|
| expand (agenda window) | 72 ms | 7 110 ms | **98×** |
| `computeAgendaSections` | 87 ms | 3 631 ms | **42×** |
| `fileOccurrenceMap` | 65 ms | 10 448 ms | **161×** |
| toggle recompute | 23.5 ms | 745 ms | **32×** |
| toggle (UI, to paint) | 167 ms | 7 310 ms | **44×** |
| vault paint | 1 877 ms | 13 007 ms | 6.9× |
| → month | 509 ms | 9 619 ms | 19× |
| JS heap after load | 140 MB | 1 310 MB | 9.3× |
| — | | | |
| parse | 1 467 ms | 1 987 ms | 1.4× |
| `buildBacklinkIndex` | 120 ms | 138 ms | 1.1× |
| `rankByQuery` | 40 ms | 45 ms | 1.1× |
| Dexie `applyRemoteBatch` | 15 863 ms | 21 313 ms | 1.3× |
| Dexie `cacheLoadAll` | 516 ms | 489 ms | 1.0× |
| CodeMirror keystroke | 16.6 ms | 16.7 ms | 1.0× |

The line through the middle is the whole answer. Everything above it is a
derived-occurrence cost and scales with occurrences; everything below it
touches files and scales with files. **Only `parse` and the Dexie write are
both file-linear and large**, and both are once-per-load. Every
per-interaction cost that matters is on the occurrence side.

Practically: budget for occurrences in the agenda window, and remember the
exchange rate. One `weekly / [mo,we,fr]` series is ~195 occurrences over
−365/+90 days; one daily series is ~455. A vault of 500 files where 50 are
daily habits has more occurrences (~23 000) than a vault of 20 000 one-shot
notes.

## Does Dexie run out of memory?

No — and the premise is worth separating into its two halves, because they
have opposite answers.

**IndexedDB (the on-disk half) is nowhere near a limit.** 30 000 files is
8.5 MB of Markdown, 42.1 MB of IndexedDB (indexes and per-row overhead), and
`navigator.storage.estimate()` reported a 0.85–1.1 GB quota in this
environment. Reads are fast and stay file-linear: `cacheLoadAll` is 489 ms for
30 000 rows and the `dirty` scan 909 ms. Dexie is not the problem at any size
tested. Its one weak spot is the **write**: `applyRemoteBatch` takes 21.3 s for
30 000 rows in a single transaction — finding #6, deferred rather than fixed
(see "Where the findings went").

**The JS heap is the real ceiling, and it is not holding vault content.**
Per-stage heap, taken after a forced GC (`--js-flags=--expose-gc`), as a delta
over the page's own baseline:

| stage | flat/30 000 | mixed/30 000 | mixed/100 000 |
|---|---|---|---|
| raw file strings | +18.9 MB | +19.0 MB | +66 MB |
| parsed `Entries` | +50.1 MB | +51.6 MB | +175 MB |
| `deriveViews` | +34.0 MB | +35.5 MB | +121 MB |
| after agenda expansion | +37.9 MB | **+269.2 MB** | **+907 MB** |
| after `fileOccurrenceMap` | +43.1 MB | **+503.9 MB** | **+1 696 MB** |

At mixed/30 000, 8.5 MB of Markdown becomes ~504 MB of live objects, of which
~90% (≈453 MB) is expanded occurrences — roughly **320 bytes per occurrence** in the
agenda window, and about the same again for `fileOccurrenceMap`'s wider one.
The peak the tab actually holds (CDP `JSHeapUsedSize`, garbage included) was
1 310 MB at 30 000 files, 2 043 MB at 60 000, and 3 249 MB in the pipeline page
at 100 000.

**Nothing crashed, at any size tested, up to 100 000 files / 2.8 M
occurrences.** Desktop Chrome's ~4 GB per-renderer cap was approached but not
reached. The practical conclusion is not "it OOMs at N" but: on a desktop the
app becomes unusable (see "Where it stops being usable" above) roughly an
order of magnitude before it runs out of
memory, and on a phone — where a tab is typically capped around 0.5–1.5 GB —
the *memory* wall arrives first, at an estimated 15 000–35 000 files at the
default mix. That estimate is arithmetic from the per-occurrence figure above,
not a measurement; it wants confirming on a real device before anyone designs
against it.
## What scales fine — do not "fix" these

- **CodeMirror keystroke latency** is 16.6–16.7 ms (one frame) at *every* size
  from 300 to 100 000 files. The editor is completely insulated from vault size.
- **Search** is 232–586 ms at every size, of which 150 ms is
  `FileResultsList`'s deliberate debounce; `rankByQuery` itself is 0.8 ms at
  300 files and 45 ms at 30 000. The debounce, the file-granular dedupe and the
  virtualized result list are all doing their job.
- **Virtualization** holds: ~26 mounted rows and ~1 400 DOM nodes at every
  size, against 185 882 agenda rows at 30 000 files.
- **`buildBacklinkIndex`** is 138 ms at 30 000 files — the O(roots · items)
  rewrite noted in `fileOccurrence.ts` is holding up.
- **IndexedDB reads** stay file-linear and cheap (`cacheLoadAll` 489 ms for
  30 000 rows).
- **`deriveViews`' container reuse** works: 10.3 ms at 30 000 files, and the
  `sameItems`/`sameRoots` identity checks are what let #3's fast path exist at
  all.

## Re-running

```bash
node scripts/perf/stress.mjs --shapes mixed,flat --sizes 300,1000,3000,10000,30000
node scripts/perf/table.mjs scripts/perf/results/<file>.json
```

This reproduces every column except the four noted above.

**The harness stays, even though the checklist is gone.** Its retirement was
scoped to close with the last finding, on the assumption every finding would
be fixed; three were deferred instead (#4, #5, #6 below), and the "pick it up
if the symptom shows" plan for each of them *is* a `stress.mjs` invocation.
Deleting `scripts/perf/` would strand all three. Nothing in CI runs it, so it
can still rot — treat a re-run that fails to launch as expected maintenance,
not as a reason to distrust the numbers above. Its build-tooling footprint
stays where it is: the `scripts/perf/results/` line in `.gitignore`, plus the
two `knip.json` allowances documented in `scripts/perf/README.md`.

`scripts/perf/README.md` documents the phases, the dev-server caveats, and two
timing traps that cost a day each (a garbage-collected `MutationObserver`, and
`keyboard.type` outrunning the search debounce).

## The infinite-scroll change has landed

Every number above predates it. The agenda no longer expands its whole
±455-day window before first paint: it loads in chunks and grows the loaded
run forward as the user scrolls (`useAgendaChunks`,
`growAgendaLoadedChunksForward` in `calendar/viewState.ts`). That was
finding #1's fix; finding #2's landed shortly after it.

The curves above still describe the architecture as measured on 2026-08-28
against `54ab5cb`, which is what makes them a usable *baseline* — but they are
now pre-fix for the three rows those two fixes touch. **Only the scroll row
has been re-measured against both** (see finding #4 below, which is where the
newer numbers live). `coldStart.vaultPaintMs` was re-measured after #1 alone
and had not moved — 13 521 ms at mixed/30 000, because the bottleneck had
shifted to #2's warm-up — and `toggle` has not been re-measured at all, so the
13 s paint / 7.3 s toggle there are upper bounds of unknown tightness. Both come out of the same `stress.mjs` run as the scroll
figures, so one command produces all three:

```bash
node scripts/perf/stress.mjs --sizes 3000,10000,30000 --skip-pipeline --skip-dexie
```

That re-measurement is also the gate on finding #4's deferral — see below.

## Where the findings went

Six findings came out of this run, ranked, each with the baseline and the
re-runnable recipe that produced it. They lived in
`plans/vault-scaling-results.md`, a checklist per `plans/CLAUDE.md`;
**that file was deleted on 2026-09-03** when the last of them left it, so this
section is now the only record of what happened to each.

| # | Finding | Outcome |
|---|---|---|
| 1 | The agenda expands its whole ±455-day window before first paint | **Fixed** — incremental chunk loading, see "The infinite-scroll change has landed" |
| 2 | `fileOccurrenceMap` expands ±3 years to pick one occurrence per file | **Fixed** — `firstOccurrenceFrom`'s lazy per-key seek, plus two follow-ups found while profiling #4 |
| 3 | `computeExpansionCache` re-allocates the whole occurrence array on every metadata edit | **Fixed** — the structural-reuse fast path and metadata overlay in `model/expansionCache.ts` |
| 4 | Scroll cost grows with vault size although mounted rows stay constant | **Deferred 2026-09-03, diagnosis complete** — see below |
| 5 | `parseFiles` is a synchronous loop on the first-paint path | **Deferred 2026-09-03** |
| 6 | `applyRemoteBatch` writes 30 000 rows in one transaction (21 s) | **Deferred 2026-09-03** |

**Deferred is not closed, and not invalid.** All three deferrals apply the same
criterion: the symptom is visible and self-attributing at the sizes where it
bites — a slow cold start (#5), a hang on first connect (#6), visible scroll
jank (#4) — so each can be picked up if and when that happens rather than held
open indefinitely. Every baseline above is the pre-fix measurement, and the
recipes are `stress.mjs` invocations, which is why the harness outlives the
checklist (see "Re-running"). #5 and #6 want the `parse` and `applyRemoteBatch`
rows; #4 has its own numbers below.

### Finding #4 — deferred with the diagnosis complete

Kept in full because the expensive half is done. Four profile passes, two
harness confounds and two incidental `fileOccurrenceMap` bugs stand between
the original suspicion and the confirmed cause below; what remains is
implementation, against a component with a history of being got wrong. Anyone
picking this up should not need to re-derive any of it.

**Symptom.** Scroll frame cost grows with vault size while mounted rows hold
at 26. Latest baseline, at `--sizes 3000,30000`: p50 frame interval while
scrolling 30 × 900 px is **33.3 ms at mixed/3 000 and 99.9 ms at mixed/30 000**
(worst 50.1 / 116.7–133.4 ms; janky frames 1/30 → 30/30). Two runs agreed to
0.1 ms at p50, so this is stable rather than a one-off. At mixed/3 000 the
settled reading is **0 LoAF frames and 0 ms blocking** on one run and
4 frames / 17.6 ms on the other — scrolling 3 000 files barely registers.
For scale, the original pre-incremental-loading baseline was 33.4 → 200 ms, a
6× jump for the same 10× file-count move; it is now 2.7×, smaller in absolute
terms and a flatter curve, but not gone.

**Recipe.**

```bash
node scripts/perf/stress.mjs --sizes 3000,30000 --skip-pipeline --skip-dexie
```

Read `ui.scroll` (which carries a `loaf` attribution and a `settled` field —
`scripts/perf/table.mjs` renders both under "Long animation frames (scroll)")
and `ui.mountedRows`.

**Confirmed cause: TanStack Virtual's measurement rebuild.** Rows are
dynamically measured (`ref={virtualizer.measureElement}`,
`src/components/primitives/virtual-rows.tsx:41`). The virtualizer rebuilds its
`measurements` array from the lowest pending measured index through `count`
whenever a row measures differently from its `estimateSize` — which
`useVirtualFlip`'s own doc comment says "happens constantly while scrolling
through not-yet-measured rows". `count` is `rows.length`
(`calendar/AgendaView.tsx:106`), i.e. the *loaded run*, not the vault.

The evidence is direct measurement, not inference. In the settled profile at
mixed/30 000, `DIV.onscroll` (the virtualizer's own scroll handler) is the
single largest attributed script at ~1.6 s across 30 steps, with React commit
(`MessagePort.onmessage`) adding ~0.7 s; together ~77–80 ms/step against an
observed 99.9 ms p50. It effectively vanishes at mixed/3 000, where row count —
not mounted rows, not file count — drops by an order of magnitude.
Style and layout recalc stayed negligible (15–19 ms summed across all LoAF
entries) at every size in every pass, so the "measurement rebuild is a layout
cost" half of the original theory never held; the "it is a *script* cost
proportional to row count" half does.

That per-row constant is the useful number: ~1.6 s over 30 steps at ~163 k
loaded rows is roughly **0.33 µs/row/scroll-event in dev**, which puts a
fully-loaded mixed/3 000 run (~18 k rows) near 6 ms/event and mixed/10 000
(~65 k) near 21 ms. Dev-React overhead is perhaps 2×, per "What was measured".

**Why deferred.** Not because it is small — 99.9 ms p50 with 30/30 janky
frames is ~10 fps. Because the arithmetic above puts the first size where
scroll *alone* breaks a frame budget at ~30 000 files at the default mix, and
at that size "Where it stops being usable" already has 13 s to paint and 7.3 s
to toggle a checkbox. Smooth scrolling in an app that takes seconds to tick a
task is not a user-visible win, and the structural cause of the rest (eager
full-window expansion) is not a finding anyone can pick up any more.

**The gate on that reasoning**, and the first thing to re-check before
accepting it: those paint and toggle figures are the 2026-08-28 baselines, and
findings #1 and #2 have landed since. `vaultPaintMs` was re-measured once
after #1 alone (13 521 ms at mixed/30 000 — unchanged, because the bottleneck
had moved to #2's warm-up) but neither it nor `toggle` has been measured since
#2 was fixed. The recipe above produces `ui.coldStart` and `ui.toggle` in the
same run. **If toggle at mixed/10 000 is now a few hundred ms rather than
seconds, scroll becomes the first flow to break and this finding should be
re-tiered upward immediately.**

**Ruled out by inspection — do not re-investigate without new evidence.**

- *Row mounting* — 26 mounted rows at both sizes, measured.
- *`computeOverduePool`* (`calendar/overduePool.ts:128`) — identity-cached on
  `items`/`roots`/`todayMs`/`filterOccs`, and `filterOccs` is a `useCallback`
  over three store values that do not change while scrolling. Hits its cache.
- *`hasSameStructure`* (`model/expansionCache.ts:82`) — opens with
  `if (a === b) return true`, so it is O(1) during scroll.
- *`useAgendaChunks`'s run memo* — works; it compares each chunk's `allOccs`
  rather than the `ExpansionCache` wrapper, deliberately, because the wrapper
  is reallocated even on a no-op.
- *Store-write fan-out from `setAgendaTopDate`* — it does reach `_app.tsx`,
  `Sidebar` and `SearchBar`, but only on a **day-boundary crossing**, and
  crossings get *rarer* as the vault grows (~408 agenda rows per day at
  mixed/30 000 against ~40 at mixed/3 000, so 900 px crosses a boundary
  constantly at 3 000 and almost never at 30 000). It cannot produce a cost
  that grows with vault size. This disconfirmed the `items`/`roots` "prime
  suspect" the finding originally named.

**Already landed, and not to be redone.** Four things shipped while
diagnosing this, all still in the tree:

1. `stress.mjs`'s scroll flow brackets its loop with a Long Animation Frames
   observer, reporting top attributed scripts plus `blockingMs` and
   `styleAndLayoutMs` as `ui.scroll.loaf`.
2. `computeExpansionCache` returns `prev` by reference when `items` and
   `roots` are both unchanged (`model/expansionCache.ts:139`), immediately
   after the `hasSameStructure` gate. Its fast path previously did an
   unguarded O(items) walk even on a true no-op, while the very next block
   already guarded its `roots` equivalent — and AgendaView re-renders on every
   scroll event by design (its comment at `calendar/AgendaView.tsx:280`), so
   that walk ran once per loaded chunk per scroll event.
3. Two real `fileOccurrenceMap` bugs, found by profiling this finding rather
   than from the original plan: `resolveOneKey` computed its 365-day back
   window eagerly even when rule 1 resolved first and never touched it, and
   `expandRange`/`firstOccurrenceFrom` each built their own `ItemIndex` over
   the same `keyItems`. Both fixed. The larger of the two was
   `firstOccurrenceFrom`'s contract: an unmatched predicate walks every
   occurrence to its 3-year horizon before giving up, and rule 1's predicate
   (`occKind(o) === 'event'`) can never match a task-only series, so every
   weekly task series — ~7.5% of files at the `mixed` shape — paid ~470 wasted
   pulls. Both seeks now skip outright when `keyItems` structurally cannot
   produce a matching kind, checked via `isTracked`, the same primitive
   `occKind` is built from.
4. `probe.mjs` keeps one page-lifetime LoAF observer and exposes
   `__perf.settle(quietMs, timeoutMs)` (default 500 ms quiet, 45 s cap) plus
   `__perf.loafsIn(t0, t1)`. The scroll flow settles cold-start background
   work out of the way, then reads only entries inside its own timed window.
   Reading from the one already-running observer, rather than registering a
   second one mid-run, is what stops the wait's own work being replayed into
   the attribution via `{ buffered: true }`.

Items 1 and 4 are why the numbers above are trustworthy and the three earlier
profile passes were not: those passes were dominated by an
`IdleRequestCallback` (`fileOccurrenceMap`'s warm-up, 12.8 s) and an
`IDBRequest.onsuccess` (Dexie's cold-start cache write, 10.9 s) that were
never part of scrolling at all. With the window right, both are simply absent
(`settled.waitedMs: 0` — each had already finished) and total attributed time
fell ~30× while **the frame interval itself did not move** across all four
passes (83.4–100.1 ms p50). That is the tell that this was never about total
LoAF time.

**What is actually left.** Two standard mitigations, either of which needs
designing before it is written:

- **Bound `count`.** The loaded run only ever grows forward within its
  ±365/+90-day cap (`growAgendaLoadedChunksForward`, `calendar/viewState.ts`),
  so a sliding window that also drops chunks far behind the viewport is the
  usual answer. `useAgendaChunks` already has the eviction machinery — its
  commit-phase `useEffect` drops chunks outside the requested run — so only
  the run itself needs to shrink.
- **Make each measurement cheaper**, via `content-visibility: auto` plus
  `contain: layout style paint` on rows.

**Both are behaviour-visible on a scroll-restore path that has been got wrong
twice before** (see `computeAgendaScrollRestore`'s own notes). Scope carefully;
this is not a mechanical follow-up. Worth pricing first, though: `estimateRow`
(`calendar/agendaSections.ts:94`) is already exact per row kind, so the
mismatch that triggers the rebuild at all is probably just title wrapping to a
second line. If that is confirmed, a wrap-aware estimate would be far cheaper
than either mitigation and touches neither `count` nor scroll restore.

If this is picked up, budget Opus 5 and design the scroll-restore interaction
before writing the fix.
