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
| 2 | 2 | `fileOccurrenceMap` expands ±3 years to pick one occurrence per file | 8 | 2 | **Sonnet 5** (window narrowing); Opus 5 for the lazy variant |
| 3 | 6 | `applyRemoteBatch` writes 30 000 rows in one transaction (21 s) | 6 | 1 | **Sonnet 5** |
| 4 | 5 | `parseFiles` is a synchronous loop on the first-paint path | 5 | 2 | **Sonnet 5** |
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | Unverified; needs a fresh profile — see below |

Three of the four are Sonnet-5 work as written — each carries a **Task
context** block naming the constant to change, the invariant that must
survive, and the tests that guard it. Strip those blocks and most revert to
Opus 5.

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
- **Measurement recipe** —
  `node scripts/perf/stress.mjs --shapes mixed,flat --sizes 3000,30000 --skip-ui --skip-dexie`;
  read `pipeline.result.fileOccurrenceMap.cold` and `pipeline.result.heapMB`.
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

### 4. Scroll cost grows with vault size although mounted rows stay constant

- **Flows** — scrolling the agenda (continuous).
- **Category** — `render-amplification`, `perceived-latency`
- **Impact** — 7
- **Baseline (remeasured after the agenda moved to incremental loading)** —
  p50 frame interval while scrolling 30 × 900 px: 49.9 ms at mixed/3 000,
  133.3 ms at mixed/30 000 (worst 66.7 / 183.3 ms; janky frames 10/30 →
  30/30). Both smaller in absolute terms and a flatter curve than the old
  fixed-window baseline (33.4 → 200 ms, a 6× jump for the same 10× file-count
  move; now 2.7×) — but not gone. Mounted rows hold at 26 for both sizes,
  confirming (again, on the new architecture) that this is not row mounting.
- **Measurement recipe** — `node scripts/perf/stress.mjs --sizes 3000,30000`;
  read `ui.scroll` and `ui.mountedRows`.
- **Breadth** — `calendar/AgendaView.tsx`, `calendar/useVirtualFlip.ts`,
  `calendar/computeAgendaScrollRestore.ts` (candidates, not confirmed).
- **Problem** — the *loaded* row list is now a handful of chunks, not the old
  185 882-row window, and the 30-scroll flow only ever widens it by a few more
  — so it is no longer plausible that something is proportional to the full
  window the way it was. Something per-scroll-event is still proportional to
  vault size regardless, just at a smaller constant. `items`/`roots` — the
  whole vault's flat arrays, read by every store-subscribed component on every
  render, agenda or not — are the prime remaining suspect now that the
  agenda's own row list is bounded.
- **Fix** — **unverified; needs a profile before a fix.** Attach a Chrome
  performance profile during the harness's scroll flow at mixed/30 000 and
  attribute the frame time before proposing anything — the suspects above are
  candidates, not a diagnosis.
- **Recommended model** — **Opus 5.** The profile is the first step; if it
  points at a single named cause the fix itself may well be Sonnet-able.
- **Why it is listed anyway** — it is still a measurably bad flow at scale
  (133 ms p50, every frame janky), and ruling out the virtualizer a second
  time — on the architecture that actually ships — is itself worth doing.

---

### 5. `parseFiles` is a synchronous loop on the first-paint path

- **Flows** — cold start, and every reconcile that touches many files.
- **Category** — `critical-path-work`
- **Impact** — 5
- **Baseline** — 23.5 ms at 300 files, 155.8 ms at 3 000, 609.5 ms at 10 000,
  1 987 ms at 30 000, 5 061 ms at 100 000. Essentially identical in both shapes
  (1 467 ms at flat/30 000), confirming it as the one large *file*-linear cost.
- **Measurement recipe** —
  `node scripts/perf/stress.mjs --shapes mixed,flat --sizes 3000,30000 --skip-ui --skip-dexie`;
  read `pipeline.result.parse.median`.
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
  removes ~2 s from `vaultPaintMs` at 30 000 files.
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
