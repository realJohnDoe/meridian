# Vault-scaling stress test — results

Run: 2026-08-28, against `54ab5cb`, with `scripts/perf/stress.mjs` (see
`scripts/perf/README.md` for how to re-run). Sizes 300 / 1 000 / 3 000 /
10 000 / 30 000 files in two vault shapes, plus 60 000 and 100 000 to find the
ceiling. Raw numbers in `scripts/perf/results/`.

## 1. Verdict

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

## 2. Coverage statement

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
memory extrapolation in §5 is stated as arithmetic, not measurement.

**Two gaps in the harness itself**, recorded rather than papered over:
`toDay` timed out on `flat/300` and `flat/1000` (its readiness marker,
`.now-line`, did not appear; every larger flat size measured fine and flat, so
no conclusion depends on the two missing cells), and `search.resultRows` read
0 at 60 000 and 100 000 where the results panel's spacer selector missed. The
long-task columns are best-effort: React 19's concurrent renderer yields every
few ms, so a 7-second interaction can legitimately contain no >50 ms task.

## 3. The measured curves

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

## 4. Files or occurrences?

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

## 5. Does Dexie run out of memory?

No — and the premise is worth separating into its two halves, because they
have opposite answers.

**IndexedDB (the on-disk half) is nowhere near a limit.** 30 000 files is
8.5 MB of Markdown, 42.1 MB of IndexedDB (indexes and per-row overhead), and
`navigator.storage.estimate()` reported a 0.85–1.1 GB quota in this
environment. Reads are fast and stay file-linear: `cacheLoadAll` is 489 ms for
30 000 rows and the `dirty` scan 909 ms. Dexie is not the problem at any size
tested. Its one weak spot is the **write**: `applyRemoteBatch` takes 21.3 s for
30 000 rows in a single transaction — see finding #6.

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
app becomes unusable (§3) roughly an order of magnitude before it runs out of
memory, and on a phone — where a tab is typically capped around 0.5–1.5 GB —
the *memory* wall arrives first, at an estimated 15 000–35 000 files at the
default mix. That estimate is arithmetic from the per-occurrence figure above,
not a measurement; it wants confirming on a real device before anyone designs
against it.

## 6. Findings

Ranked by `(impact × breadth) ÷ effort`. `#` is a stable identity, not a
priority. Each carries the measurement recipe that produced its baseline, so a
fix can be verified by re-running the same command.

| Rank | # | Finding | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 1 | 1 | The agenda expands its whole ±455-day window before first paint | 9 | 3 | **Opus 5 in plan mode** — needs a product decision |
| 2 | 3 | One toggle re-allocates every occurrence in the window | 8 | 2 | **Sonnet 5** with the context below |
| 3 | 2 | `fileOccurrenceMap` expands ±3 years to pick one occurrence per file | 8 | 2 | **Opus 5** |
| 4 | 6 | `applyRemoteBatch` writes 30 000 rows in one transaction (21 s) | 6 | 1 | **Sonnet 5** |
| 5 | 5 | `parseFiles` is a synchronous loop on the first-paint path | 5 | 2 | **Sonnet 5** |
| 6 | 4 | Scroll cost grows with row count although mounted rows stay constant | 7 | 2 | **Opus 5** — unverified cause |

---

### 1. The agenda expands its whole ±455-day window before first paint

- **Flows** — cold start (every launch), every agenda↔month↔day switch.
- **Category** — `critical-path-work`, `data-and-persistence`
- **Impact** — 9
- **Baseline** — `computeExpansionCache` over the agenda window: 47 ms at
  300 files, 389 ms at 3 000, 1 721 ms at 10 000, 7 110 ms at 30 000,
  34 750 ms at 100 000 (mixed). The same call on flat/30 000 is 72 ms, so this
  is occurrence-bound, not file-bound. It is the largest single contributor to
  `vaultPaintMs` (13 007 ms at mixed/30 000).
- **Measurement recipe** —
  `node scripts/perf/stress.mjs --shapes mixed,flat --sizes 3000,30000 --skip-ui --skip-dexie`;
  read `pipeline.result.expandAgendaWindow.median` and
  `pipeline.result.occurrencesInAgendaWindow`.
- **Breadth** — `calendar/useAgendaSections.ts`, `calendar/agendaSections.ts`,
  `model/expansionCache.ts` (plus month/day, which have their own windows).
- **Evidence** — `src/calendar/agendaSections.ts`:
  ```ts
  export const PAST_WINDOW_DAYS = 365
  export const FUTURE_WINDOW_DAYS = 90
  ```
  and `src/calendar/useAgendaSections.ts`:
  ```ts
  const from = addDays(anchor, -PAST_WINDOW_DAYS)
  const to = addDays(anchor, FUTURE_WINDOW_DAYS)
  const allOccs = useExpandWithMultiday(items, roots, from, to)
  ```
- **Problem** — the window is a constant, so the work to reach first paint is
  proportional to every occurrence in 455 days regardless of how many the user
  can see; the virtualizer then mounts ~26 rows out of 185 882. The user waits
  13 s to look at one screenful.
- **Fix** — expand a window around the anchor (say ±30 days) for first paint
  and widen it incrementally as the virtualizer approaches an edge, keeping the
  full window only for the overdue pool that genuinely needs it. Expected
  effect: `vaultPaintMs` at mixed/30 000 from ~13 000 ms to under 1 000 ms,
  with `expandAgendaWindow` dropping roughly in proportion to the narrower
  window (455 days → 60 days ≈ 7.5×).
- **Why plan mode** — the honest options differ in product behaviour, not just
  in code: incremental widening keeps today's scroll-anywhere agenda but makes
  row counts change under the scrollbar; a hard cap on the past window changes
  what "overdue" can reach. That is a decision to put to the user, and it
  touches the month and day panes' own windows too.

---

### 2. `fileOccurrenceMap` expands a ±3-year window to pick one occurrence per file

- **Flows** — opening search, opening the editor, the entry route; indirectly
  every load, via the idle warm-up.
- **Category** — `critical-path-work`, `memory-and-leak`
- **Impact** — 8
- **Baseline** — 133 ms at 300 files, 1 111 ms at 3 000, 4 227 ms at 10 000,
  10 448 ms at 30 000, 62 701 ms at 100 000 (mixed); 65 ms at flat/30 000. It
  is the single largest heap consumer: +504 MB over baseline at mixed/30 000,
  where the agenda's own expansion accounts for +269 MB.
- **Measurement recipe** — as #1; read
  `pipeline.result.fileOccurrenceMap.cold` and `pipeline.result.heapMB`.
- **Breadth** — `src/fileOccurrence.ts` and its two consumers
  (`hooks/useFileOccurrenceMap.ts`, `search/FileResultsList.tsx`).
- **Evidence** — `src/fileOccurrence.ts`:
  ```ts
  const _3YR_MS = 365 * 3 * 86_400_000
  ```
  ```ts
  const inWindow = expandRange(keyItems, roots, BACK, AHEAD) // ascending by time
  ```
  — run once per entry key, over a window 4.8× wider than the agenda's, to
  select a single representative.
- **Problem** — the map materialises ~4 M occurrences at 30 000 files to keep
  30 000 of them. It is already off the first-paint path (`warmFileOccurrenceMap`
  → `onIdle`), so the cost lands either in an idle slice or, if the user opens
  search before idle runs, inline in that interaction — and the peak allocation
  is paid either way.
- **Fix** — resolve against a much narrower window and fall back to the
  existing rule 6 anchor synthesis outside it: the six fill rules only ever
  want the nearest upcoming event, the earliest undone task, the most recent
  past event, or the latest done one, and a ±1-year window serves all four for
  any series that recurs at all. Expected effect: at mixed/30 000, from
  ~10 400 ms and +504 MB to roughly a third of each. A larger version of the
  same fix resolves lazily per key — search only needs the ranked top ~50.
- **Hazard that sets the tier** — the fill order in `resolveOneKey` is
  load-bearing and its "series entirely outside the window" fallback exists
  precisely for keys the window misses; narrowing the window widens that
  fallback's traffic, and getting it wrong shows up as the wrong row in search
  results rather than as a failing test.

---

### 3. One toggle re-allocates every occurrence in the window

- **Flows** — toggling a task (agenda and editor), every metadata edit.
- **Category** — `render-amplification`, `critical-path-work`
- **Impact** — 8
- **Baseline** — the incremental recompute (`deriveViews` +
  `computeExpansionCache` fast path) costs 1.0 ms at 300 files, 7.2 ms at
  3 000, 226.7 ms at 10 000, 744.8 ms at 30 000 — against 23.5 ms at
  flat/30 000. End to end the toggle takes 63 / 426 / 2 021 / 7 310 ms at
  300 / 3 000 / 10 000 / 30 000; the remaining ~6.5 s at 30 000 is React
  re-render and the store's own commit passes, which this harness does not
  break down further (**unverified**).
- **Measurement recipe** — `node scripts/perf/stress.mjs --sizes 3000,30000`;
  read `pipeline.result.toggleRecompute.median` and `ui.toggle.ms`.
- **Breadth** — `src/model/expansionCache.ts`, `src/store.ts` (`deriveViews`).
- **Evidence** — `src/model/expansionCache.ts`, on the "nothing structural
  changed" fast path:
  ```ts
  const allOccs = prev.allOccs.map(occ => {
    const changedItem = changedById.get(occ.id)
    const changedFile = changedFileMeta.get(occ.entryKey)
    const changedSeries = occ.ownerId ? changedSeriesById.get(occ.ownerId) : undefined
    if (!changedItem && !changedFile && !changedSeries) return occ
  ```
- **Problem** — the fast path is correct and returns untouched occurrences by
  reference, but `.map()` still walks and re-allocates an array of all 836 028
  of them (plus three Map lookups each) to change one. `deriveViews`'
  `sameItems` walk and `changedIndices` in `computeAgendaSections` each add
  another full pass. The user checks a box and the checkmark appears 7 s later.
- **Fix** — copy the array and overwrite only the affected indices, using an
  id→index map built once per expansion, instead of `.map()` over everything;
  when the change set is empty the existing `{ ...prev, items, roots }`
  shortcut already avoids the walk, so this is the same idea extended to the
  non-empty case. Expected effect: `toggleRecompute` at mixed/30 000 from
  ~745 ms to single-digit ms, and `ui.toggle.ms` down by at least that much.
- **Task context** — the three lookup maps (`changedById`, `changedSeriesById`,
  `changedFileMeta`) are already built before the `.map()`; what is missing is
  a reverse index from those keys to positions in `prev.allOccs`. Note that
  `changedFileMeta` is keyed by `EntryKey` and can match many occurrences,
  so the reverse index needs both an id→index and an entryKey→indices side.
  `hasSameStructure` guarantees positional alignment between `prev.allOccs` and
  the new expansion, which is what makes index-wise overwriting sound;
  `computeAgendaSections`' `changedIndices` relies on that same alignment.

---

### 4. Scroll cost grows with row count although mounted rows stay constant

- **Flows** — scrolling the agenda (continuous).
- **Category** — `render-amplification`, `perceived-latency`
- **Impact** — 7
- **Baseline** — p50 frame interval while scrolling 30 × 900 px: 33.4 ms at
  300 files, 33.3 ms at 3 000, 83.3 ms at 10 000, 200 ms at 30 000, 466.7 ms at
  60 000; janky frames (>50 ms) 2 → 8 → 27 → 30 → 30 out of 30. Mounted rows
  stay at ~26 and DOM node count between 1 400 and 2 900 with no trend in
  vault size, so this is not row mounting. flat/30 000 holds 83.2 ms p95 with 6 janky frames.
- **Measurement recipe** — `node scripts/perf/stress.mjs --sizes 3000,30000`;
  read `ui.scroll` and `ui.mountedRows`.
- **Breadth** — `calendar/AgendaView.tsx`, `calendar/useVirtualFlip.ts`,
  `calendar/computeAgendaScrollRestore.ts` (candidates, not confirmed).
- **Problem** — something per-scroll-event is proportional to the 185 882-row
  list rather than to the ~26 rows on screen. The user drags and the list moves
  at ~5 fps.
- **Fix** — **unverified; needs a profile before a fix.** The prime suspects
  are TanStack Virtual's measurement array over the full row count and
  `AgendaView`'s own scroll listener (the component carries `'use no memo'`, so
  the compiler is not memoizing around it). Attach a Chrome performance profile
  during the harness's scroll flow at mixed/30 000 and attribute the frame time
  before proposing anything.
- **Why it is listed anyway** — it is the second-worst measured flow, and
  ruling out the virtualizer is itself worth the finding.

---

### 5. `parseFiles` is a synchronous loop on the first-paint path

- **Flows** — cold start, and every reconcile that touches many files.
- **Category** — `critical-path-work`
- **Impact** — 5
- **Baseline** — 23.5 ms at 300 files, 155.8 ms at 3 000, 609.5 ms at 10 000,
  1 987 ms at 30 000, 5 061 ms at 100 000. Essentially identical in both shapes
  (1 467 ms at flat/30 000), confirming it as the one large *file*-linear cost.
- **Measurement recipe** — as #1; read `pipeline.result.parse.median`.
- **Breadth** — `src/storage/parseReport.ts`, `src/storage/vaultRegistry.ts`.
- **Evidence** — `src/storage/parseReport.ts`:
  ```ts
  for (const { path, content } of files) {
    try {
      const result = parseToStoreItems(path, content, vaultId)
      entries.set(result.key, result)
  ```
- **Problem** — the round-trip *audit* was already moved off this loop into
  `runInIdleBatches`, but the parse itself still runs as one unbroken loop
  before `setVaultLayer`, so nothing paints for its whole duration.
- **Fix** — parse in idle batches like the audit already does, writing the
  layer incrementally (or once, after the first batch, then again at the end)
  so the agenda paints against a partial vault and fills in. Expected effect:
  removes ~2 s from `vaultPaintMs` at 30 000 files; on its own it does not fix
  #1, which is the larger half.
- **Hazard that sets the tier** — a partially-populated layer is visible to
  wikilink resolution and to `applyNew`'s collision check; batching must not let
  a save happen against a half-loaded vault. Straightforward if the layer write
  stays atomic and only the *parse* is batched.

---

### 6. `applyRemoteBatch` writes a whole vault in one transaction

- **Flows** — first connect of a real (local-FS or GitHub) vault; large syncs.
- **Category** — `data-and-persistence`
- **Impact** — 6
- **Baseline** — `applyRemoteBatch` for 30 000 rows: 21 313 ms (mixed) /
  15 863 ms (flat). By contrast `cacheLoadAll` for the same rows is 489 ms and
  the dirty scan 909 ms — the write is ~40× the read. 10 000 rows: 2 948 ms.
  3 000 rows: 417 ms. Growth is markedly super-linear between 10 k and 30 k.
- **Measurement recipe** —
  `node scripts/perf/stress.mjs --sizes 3000,10000,30000 --skip-ui --skip-pipeline`;
  read `dexie.result.writeMs` against `readAllMs`.
- **Breadth** — `src/storage/cache/files.ts`.
- **Evidence** — `src/storage/cache/files.ts`:
  ```ts
  await d.transaction('rw', d.files, async () => {
    const keys = records.map(r => vp(vaultId, r.path))
    const existingRecords = await d.files.bulkGet(keys)
  ```
  — one `bulkGet` of every key plus one `bulkPut` of every row, in a single
  transaction, over a table carrying four indexes.
- **Problem** — connecting a large vault blocks on a 21-second IndexedDB
  transaction with no progress and no yield point. `readAll`'s `onProgress`
  already reports the fetch; the write that follows it is silent.
- **Fix** — chunk into batches of ~1 000 records, each its own transaction, and
  report progress per chunk through the existing `vaultLoadProgress` channel.
  Expected effect: the same total work becomes interruptible and observable;
  based on the sub-linear per-row cost at 3 000 (0.14 ms/row) versus 30 000
  (0.71 ms/row), chunking should also cut the total by roughly half.
- **Task context** — the `bulkGet` exists to skip rows that are locally dirty,
  and `written` (the returned paths) is what the caller merges into the store,
  so chunking must accumulate `written` across chunks and keep the
  dirty-check-then-put pair inside each chunk's transaction.

## 7. What scales fine — do not "fix" these

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

## 8. Re-running

```bash
node scripts/perf/stress.mjs --shapes mixed,flat --sizes 300,1000,3000,10000,30000
node scripts/perf/table.mjs scripts/perf/results/<file>.json
```

`scripts/perf/README.md` documents the phases, the dev-server caveats, and two
timing traps that cost a day each (a garbage-collected `MutationObserver`, and
`keyboard.type` outrunning the search debounce).
