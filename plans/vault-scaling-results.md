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
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | Unverified; needs a fresh profile — see below |

Finding 2 is Sonnet-5 work as written — it carries a **Task context** block
naming the constant to change, the invariant that must survive, and the tests
that guard it. Strip that block and it reverts to Opus 5. Finding 4 has no
such block because it has no diagnosis yet: profile first.

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
