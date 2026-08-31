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
node scripts/perf/stress.mjs --shapes mixed,flat          # both vault shapes
node scripts/perf/stress.mjs --skip-ui                    # pipeline + Dexie only
node scripts/perf/stress.mjs --skip-pipeline --skip-dexie # UI flows only
```

Results are printed per size and written to `scripts/perf/results/<iso>.json`,
which is gitignored: a run is a point-in-time artefact of one machine, and the
numbers worth keeping live in `plans/surveys/vault-scaling.md`.

## What it measures

| Phase | What runs | Why separately |
|---|---|---|
| `pipeline` | The real modules (`parseToStoreItems`, `deriveViews`, `buildBacklinkIndex`, `computeExpansionCache`, `computeAgendaSections`, `rankByQuery`, `updateFileOccurrenceMap`), imported into the page over the dev server | Attributes cost to a stage instead of lumping it into "cold start" |
| `ui` | Cold start, toggling a task, agenda scroll — driven through the real DOM | The user-visible half, including render and paint |
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
- `long` on an interaction is the long-task total/max inside it: the part that
  blocked the main thread rather than merely elapsed. Best-effort: React 19's
  concurrent renderer yields every few ms, so a multi-second interaction can
  legitimately contain no single >50 ms task.

## Scope

Three UI flows, deliberately: cold start, toggling a task, and scrolling the
agenda. The view switches, search, opening an entry and the CodeMirror
keystroke measurement were removed — the reasoning is on `measureUI` in
`stress.mjs`. The `pipeline` and `dexie` phases are untouched and are what
verify five of the six findings in `plans/vault-scaling-results.md`.

**This directory has an expiry.** It exists to verify those findings by
re-measurement; nothing in CI runs it, so once the last finding closes it
would rot unnoticed. `plans/vault-scaling-results.md` says to delete it in the
same PR that deletes that file.

## Two things `knip.json` carries for this directory

`knip` runs in CI and sees `scripts/` as project code, so the harness needs two
allowances there — both narrow, and neither weakens the check over `src/`:

- **`entry` is `scripts/**/*.mjs`, not `scripts/*.mjs`.** The old glob was
  non-recursive, so anything one directory down was in `project` but reachable
  from no entry, which knip reports as an unused file. That is also why
  `probe.mjs` carries the repo's `.mjs` extension rather than `.js`.
- **`ignoreUnresolved: ["^/meridian/src/"]`.** `stress.mjs` imports the app's
  own modules by their *dev-server URL* (`/meridian/src/model/index.ts`) so
  they run inside the page against the real Vite graph. Those are browser
  paths, not filesystem paths, and knip cannot resolve them. The pattern is
  anchored to that leading `/meridian/src/`, which no real source import uses —
  app code imports via `@/…` or a relative path.

## Timing conventions

Everything timed precisely runs inside the page (`scripts/perf/probe.mjs`); a
Playwright round-trip costs 1–5 ms, which is the whole budget of the
interactions being measured. Node only ever reads back a number the page
already recorded. Two traps this cost a day each:

- **Hold your MutationObserver.** An observer nothing references is
  collectable, and under the GC pressure of a scrolled 10k-row agenda it does
  get collected — which reads as "the flow never happened".
- **Anchor an interaction on a marker the app owns.** Readiness selectors that
  reach for a Tailwind utility (`.grid-cols-7`, `.now-line`) or a library's
  internals (the results virtualizer's spacer `div[style*="height"]`) are the
  ones that broke; `[data-index]`, a `data-testid` and `button[role="checkbox"]`
  are the ones that held. This is why the view-switch, search and open-entry
  flows are no longer measured here — see the comment on `measureUI`.

