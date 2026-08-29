# Vault-scaling stress test — findings

Open findings from the vault-scaling stress test run on 2026-08-28 against
`54ab5cb`. **The report they came from is `plans/surveys/vault-scaling.md`** —
the method, the full curves, and the two structural answers (occurrences are
the scaling unit; the JS heap, not Dexie, is the ceiling) live there and stay
there. This file is the to-do half: remove a finding's entry, and its row in
the table, in the PR that fixes it, and delete this file entirely once the
last one closes — see `plans/CLAUDE.md`.

**`scripts/perf/` retires with this file.** The harness exists to verify these
fixes by re-measurement; once the last finding closes it has no remaining
caller, and nothing in CI runs it, so it would rot silently. Delete
`scripts/perf/`, its two `knip.json` allowances and the
`scripts/perf/results/` line in `.gitignore` in the same PR that deletes this
file. The report stays: it is a record of what was measured, not a tool.

Every finding carries the baseline that measures it and the exact command that
produced that baseline, so a fix is verified by re-running the same command and
comparing. `scripts/perf/README.md` explains the harness and its caveats; the
short version is that it runs against the **dev server** (the large-vault
generator is dev-only), so the pipeline numbers are close to production but the
UI numbers carry dev-React overhead — read them as a curve and as a
before/after comparison, not as shipped latency.

## Findings

Ranked by `(impact × breadth) ÷ effort`. `#` is a stable identity, not a
priority — the numbers do not move as findings get closed out.

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
