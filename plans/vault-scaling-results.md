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

## The planned move to infinite scroll

A move to a standard infinite-scroll agenda is planned. It changes what to do
about two of these findings and nothing about the other four — and it inherits
one constraint from finding #1 that is worth knowing before the design is
settled.

| # | Under infinite scroll |
|---|---|
| 1 | **Fold into that work, do not fix separately.** #1's fix *is* incremental expansion, and the product decision it was blocked on is now made. |
| 4 | **Defer and re-measure after.** Row count at first paint drops from 185 882 to whatever one screen plus a chunk needs, so the symptom may go with it; profiling the current architecture measures code about to be replaced. |
| 2, 5, 6 | Unaffected — none of them touches the agenda window. |
| — | The overdue section is being **grouped** (one row per series) as part of this work; see constraint 3 below. |
| 3 | Still valid, but its character changes: the array it re-allocates starts smaller and **grows as the user scrolls**, so the cost arrives later in the session rather than at first paint. |

### Three things in the current code that a naive implementation will hit

Each is a fact about code as it stands today, not a prediction:

1. **Widening one window re-expands all of it.** `computeExpansionCache` takes
   its fast path only when the window matches exactly:
   ```ts
   if (prev && prev.fromMs === fromMs && prev.toMs === toMs && hasSameStructure(prev.items, items)) {
   ```
   and `useExpandWithMultiday` keys its cache by `` `${fromMs}:${toMs}` ``. So a
   "load more" that grows one window is a cache miss that re-expands the whole
   widened range from scratch. Scrolling back a year in 30-day steps that way is
   twelve full re-expansions of a growing window — quadratic in the occurrence
   count, against a stage already measured at 7 110 ms for a single pass at
   mixed/30 000.
   **Do instead:** expand fixed, disjoint chunks — each its own stable
   `(from, to)` key that is expanded once and stays eligible for the
   metadata-overlay fast path — and concatenate. Note `MAX_CACHED_WINDOWS = 16`
   in `useExpandWithMultiday`; chunked scrolling will evict live chunks well
   before then and that cap needs revisiting with the chunk size.

2. **Any length change drops the whole section cache.** `changedIndices`
   (`calendar/agendaSections.ts`) returns `null` — meaning "rebuild every
   section" — the moment `prev.length !== next.length`. Appending a chunk is a
   length change, so each load-more currently costs a full regroup
   (3 631 ms at mixed/30 000, though far less on a chunked window). Appending at
   the end keeps existing indices valid; **prepending past days shifts every
   index** and is the case to design around, since `keyByIndex` and
   `changedIndices` both assume positional alignment.

3. **The overdue section needs the whole past window — and the product
   decision here has been made: group it.** `computeAgendaSections` pools every
   past day, and `overdueHeaderRow(todayKey, collapsed, items.length)` renders
   an exact count — the "Overdue 6789" chip. Neither the pool nor the count can
   be known without expanding all 365 past days, which is most of the
   occurrences at any size. **Decision: the overdue section shows one row per
   series rather than one per occurrence.** See "Grouped overdue" below.

### Grouped overdue — the decision, and what it takes

**What makes this the collision.** `agendaSections.ts:8` defines overdue as
```ts
const isOverdue = (o: Occurrence) => occKind(o) === 'task' && !o.metadata.done
```
so the pool is every past-dated undone *task occurrence*. A single
`weekly / [mo,we,fr]` task left unfinished for a year contributes **156 rows on
its own** (365 ÷ 7 × 3), and that is what the measured "Overdue 6789" chip is
mostly made of. Grouping to one row per series turns the pool from
O(past occurrences) into O(undone task items) and makes the count the number of
groups — cheap, exact, and needing no past-window expansion. Constraint #3 then
stops existing rather than being worked around.

**Group key: `occ.ownerId ?? occ.id`.** `Occurrence.ownerId` is "UUID of parent
RepeatPattern (undefined for standalone)" (`types.ts:133`), so every generated
occurrence of one series shares it and a standalone dated task groups alone —
no special case needed. A file holding two series stays two groups, which is
right.

**The part that is not yet true, and must change with it.** The plan is that
individual occurrences stay reachable by scrolling up to their day sections.
They are not there today — `buildBucket` *hoists them out*:
```ts
if (b.isPast) {
    const overdue = filtered.filter(isOverdue)
    const items = sortOccs(filtered.filter(o => !isOverdue(o)), ctx.now)
```
An undone past task appears **only** in the overdue block, and a past day
holding nothing else gets `section: null` and drops out of the agenda
entirely. So grouping the overdue section must be paired with dropping that
hoist — a past day's `items` becomes `sortOccs(filtered, ctx.now)` — or the
grouped row becomes the only place those occurrences exist and they can no
longer be checked or deleted individually. Note the knock-on: past days that
currently vanish will start rendering, which adds rows going backwards. Under
infinite scroll that is paid only as far back as the user scrolls.

**`AgendaRow` needs a new variant.** The union (`agendaSections.ts`) has
`header | month | week | occ | day-empty`; `overdueRows` maps occurrences 1:1
into `kind: 'occ'`. A grouped row carries a representative occurrence plus a
count and an oldest-date — closest existing precedent is the `header` variant,
which already carries `count`.

**Alternatives considered, and why not.** A lazy k-way merge — take the most
recent N occurrences per source, merge date-descending, page more when a
source's buffer runs low — is correct for rendering any prefix and would cut
the pool cost to O(sources × N). It was not chosen because it makes 156 copies
of one task cheap to render rather than making them not exist, and it still
cannot produce the total (a prefix does not know it). Pairing it with a
closed-form count per series (the dates a `schedule` rule yields between anchor
and today is arithmetic, corrected by *stored* exclusions and done-overrides,
which are few) does produce an exact total in O(items) — but it puts "which
dates does this rule produce" in a second place that must agree with
`expansion.ts` forever, and that file is 889 lines because `bysetpos` ×
`bymonthday` × `bymonth` × `interval` is genuinely fiddly. A counter that
drifts from the generator shows a wrong number beside a right list, silently.
Grouping avoids both.

## Findings

Ranked by `(impact × breadth) ÷ effort`. `#` is a stable identity, not a
priority — the numbers do not move as findings get closed out.

| Rank | # | Finding | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 2 | 2 | `fileOccurrenceMap` expands ±3 years to pick one occurrence per file | 8 | 2 | **Sonnet 5** (window narrowing); Opus 5 for the lazy variant |
| 3 | 6 | `applyRemoteBatch` writes 30 000 rows in one transaction (21 s) | 6 | 1 | **Sonnet 5** |
| 4 | 5 | `parseFiles` is a synchronous loop on the first-paint path | 5 | 2 | **Sonnet 5** |
| 5 | 1 | The agenda expands its whole ±455-day window before first paint | 9 | 3 | **Opus 5**, folded into the infinite-scroll work |
| 6 | 4 | Scroll cost grows with row count although mounted rows stay constant | 7 | 2 | **Opus 5**, deferred until after infinite scroll |

Four of the six are Sonnet-5 work as written — each carries a **Task context**
block naming the constant to change, the invariant that must survive, and the
tests that guard it. Strip those blocks and most revert to Opus 5. The two
Opus rows are the ones the infinite-scroll change owns; see the section above.
#1 outranks everything on impact and is listed fifth for that reason alone —
it is not lower-value, it is not separately actionable.

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
- **Recommended model** — **Opus 5, as part of the infinite-scroll work, not
  as a standalone fix.** This finding *is* the case for incremental expansion,
  so implementing it separately would build a windowing scheme that the
  infinite-scroll change then replaces. What was blocking it — whether the
  agenda stays scroll-anywhere or gains a load-more edge — is a product
  decision that the move to infinite scroll settles.
- **Task context** — the three constraints that shape the design are written
  up under "The planned move to infinite scroll" above: the exact-window gate
  in `computeExpansionCache`, `changedIndices` returning `null` on any length
  change, and the overdue section's need for the whole past window — the last
  of which is settled by the grouped-overdue decision recorded there, and
  which carries its own paired change to `buildBucket`'s hoist. Treat this finding's expected
  effect (`vaultPaintMs` at mixed/30 000 from ~13 000 ms to under 1 000 ms) as
  the acceptance target for that work, measured with the recipe above.

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
- **Recommended model** — **Sonnet 5** for the window narrowing, given the
  context block below. Opus 5 only for the larger lazy-per-key variant, which
  changes `fileOccurrenceMap`'s totality contract and therefore what every
  consumer may assume.
- **Hazard that sets the tier** — the fill order in `resolveOneKey` is
  load-bearing and its "series entirely outside the window" fallback exists
  precisely for keys the window misses; narrowing the window widens that
  fallback's traffic, and getting it wrong shows up as the wrong row in search
  results rather than as a failing test. That is why the context below names
  the rules and the tests rather than leaving them to be re-derived.
- **Task context** — the change is `const _3YR_MS = 365 * 3 * 86_400_000` at
  `src/fileOccurrence.ts:52`, which feeds `AHEAD`/`BACK` in
  `updateFileOccurrenceMap` and reaches `resolveOneKey` as its window. The six
  fill rules are enumerated in that function's own doc comment; rules 1–5 all
  select from `inWindow`, and rule 6 is the out-of-window fallback (a
  standalone item as-is, or a synthetic occurrence built from a series' anchor
  date). Narrowing to ±1 year keeps rules 1–5 correct for anything that
  recurs at all — a weekly series has ~156 occurrences inside ±1 year — and
  pushes only never-recurring items far outside the window onto rule 6, which
  already handles them. **Keep the map total over `roots`**: the doc comment
  and `FileResultsList`'s `flatMap` both depend on a `.get()` miss being
  impossible. Tests to run and extend:
  `src/model/__tests__/memo-identity.test.ts`,
  `src/model/__tests__/linking.test.ts`, `src/store.test.ts`,
  `src/search/FileResultsList.test.tsx`, `src/editor/ItemsList.test.tsx`.
  Add a case for a series whose only occurrences fall between 1 and 3 years
  out — that is exactly the band this change moves from rule 1 to rule 6.

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
- **Recommended model** — **Opus 5, but not yet.** Hold this until the
  infinite-scroll change lands, then re-run the recipe above. Row count at
  first paint drops from 185 882 to one chunk's worth, so the symptom may go
  with it; and profiling now attributes frame time in code that is about to be
  replaced. If it survives the change, the profile is the first step and the
  finding gets rewritten around what it shows — at which point a named cause
  may well be Sonnet-able.
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
- **Recommended model** — **Sonnet 5**, given the context block below and the
  constraint that only the parse is batched.
- **Hazard that sets the tier** — a partially-populated layer is visible to
  wikilink resolution and to `applyNew`'s collision check; batching must not
  let a save happen against a half-loaded vault. That stays true only if the
  layer write remains a single atomic `setVaultLayer` — which is the one rule
  the context below turns on.
- **Task context** — `parseFiles` (`src/storage/parseReport.ts:52`) returns
  `{ entries, failures, auditRoundTrip }` to three call sites in
  `src/storage/vaultRegistry.ts`: `hydrateFromCache` (~line 214),
  `mountExampleVault` (~line 236), and the reconcile path. The batching helper
  it should use is already imported in the same file — `runInIdleBatches` from
  `@/lib/idle`, which `auditRoundTrip` uses a few lines above. **Simplest
  correct shape:** make `parseFiles` async, accumulate into the same `entries`
  Map across idle batches, and call `setVaultLayer` once when all batches
  finish — that keeps the layer atomic and still frees the main thread between
  batches, which is what the ~2 s is. Only pursue painting a partial vault if
  the atomic version does not move `vaultPaintMs` enough; that variant needs
  the wikilink/collision question answered first and is not Sonnet work.
  Tests: `src/storage/__tests__/vaultRegistry.test.ts`,
  `src/model/__tests__/round-trip-totality.test.ts`,
  `src/model/__tests__/entry-without-occurrences.test.ts`. Note the callers
  are already `async`, so making the parse async does not ripple outward.

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
- **Recommended model** — **Sonnet 5**, given the context block below. The
  hazard is a silent correctness one rather than a build failure: dropping the
  dirty-check or losing `written` across chunks would overwrite a user's
  in-progress edit with remote content, which `cache.test.ts` and
  `sync-collision.test.ts` are the guards for.
- **Task context** — the `bulkGet` exists to skip rows that are locally dirty,
  and `written` (the returned paths) is what the caller merges into the store,
  so chunking must accumulate `written` across chunks and keep the
  dirty-check-then-put pair inside each chunk's transaction — never hoist the
  `bulkGet` out and share one snapshot across chunks, since a concurrent local
  edit between chunks is exactly what the per-transaction read prevents.
  The progress channel already exists: `vaultLoadProgress` on the store, set
  from `registerAndMount` (`src/storage/vaultRegistry.ts:375`) and read by
  `src/routes/auth.callback.tsx:63`, so reporting per chunk needs no new
  plumbing — the same `{ loaded, total }` shape works. Tests:
  `src/storage/__tests__/cache.test.ts`,
  `src/storage/__tests__/sync-collision.test.ts`,
  `src/storage/__tests__/sync.test.ts`,
  `src/storage/__tests__/vaultRegistry.test.ts`.
