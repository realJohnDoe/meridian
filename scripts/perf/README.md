# Vault-scaling stress harness

Measures how Meridian's hot paths scale with vault size, and answers three
questions the unit tests cannot:

1. **Which flows degrade first**, and at what vault size.
2. **Whether files or expanded occurrences are the unit** a given cost tracks —
   the two move together in a realistic vault (one weekly series is ~200
   occurrences over the agenda window), so they are separated by generating the
   same file count with and without recurrence.
3. **Where memory runs out** — JS heap, not IndexedDB: Dexie stores bytes on
   disk, but every load materialises the whole vault in the heap twice over
   (raw content, then parsed items).

```bash
node scripts/perf/stress.mjs                              # 300 … 30 000, default mix
node scripts/perf/stress.mjs --sizes 300,1000             # a subset
node scripts/perf/stress.mjs --flat                       # also recurringShare=0
node scripts/perf/stress.mjs --skip-ui                    # pipeline + Dexie only
node scripts/perf/stress.mjs --skip-pipeline --skip-dexie # UI flows only
```

Results are printed per size and written to `scripts/perf/results/<iso>.json`.

## What it measures

| Phase | What runs | Why separately |
|---|---|---|
| `pipeline` | The real modules (`parseToStoreItems`, `deriveViews`, `buildBacklinkIndex`, `computeExpansionCache`, `computeAgendaSections`, `rankByQuery`, `updateFileOccurrenceMap`), imported into the page over the dev server | Attributes cost to a stage instead of lumping it into "cold start" |
| `ui` | Cold start, toggle, agenda scroll, view switches, search, opening an entry, CodeMirror keystrokes — driven through the real DOM | The user-visible half, including render and paint |
| `dexie` | `applyRemoteBatch` → `cacheLoadAll` → `cacheGetDirty` over the same vault, plus `navigator.storage.estimate()` | The Tutorial backend is cache-free by design, so the app's own cold start never touches Dexie; every real backend does |

Each size gets a fresh browser context, so one size's IndexedDB, localStorage
and heap can never leak into the next one's numbers.

## Reading the numbers

- **Dev server, not a production build.** The large-vault generator is dev-only
  (`import.meta.env.DEV`, see `src/storage/devFixtures/testVaultGen.ts`), so
  absolute milliseconds carry unminified dev React and per-module HTTP. Read
  the **scaling curve** and use the numbers for before/after comparison, not as
  shipped latency.
- **`coldStart.vaultPaintMs`, not `firstAgendaRowMs`.** In dev every module is
  its own request and a context pays ~12 s of them whatever the vault holds.
  `vaultPaintMs` (DOMContentLoaded → first agenda row) is the vault-dependent
  half.
- **`search.ms` contains FileResultsList's own 150 ms debounce**, by design —
  it is time the user waits. Subtract it for the compute half.
- `long` on an interaction is the long-task total/max inside it: the part that
  blocked the main thread rather than merely elapsed.

## Timing conventions

Everything timed precisely runs inside the page (`scripts/perf/probe.js`); a
Playwright round-trip costs 1–5 ms, which is the whole budget of the
interactions being measured. Node only ever reads back a number the page
already recorded. Two traps this cost a day each:

- **Hold your MutationObserver.** An observer nothing references is
  collectable, and under the GC pressure of a scrolled 10k-row agenda it does
  get collected — which reads as "the flow never happened".
- **`keyboard.insertText`, not `keyboard.type`, for the search query.** Each
  `type()` key is its own CDP round-trip and the gaps exceed the 150 ms
  debounce, so an earlier prefix's results land first and the measured latency
  comes out *shorter* than the debounce.
