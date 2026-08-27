# Codebase Health Survey — results

Run: 2026-08-25, against `ca3c63f`. Scope narrowed per request to **the
largest files in the repo** — the read-closely budget went to the top ~20
source files by line count rather than being spread evenly. All ten
categories were still scanned; where a category's evidence lives outside the
big files (toolchain, dependencies) it was scanned normally.

## 1. Health verdict

This is a healthy, unusually well-maintained codebase: every gate is green,
the architecture invariants in `CLAUDE.md` are machine-enforced by real lint
zones rather than asserted, and the big files are big because the domain is,
not because concerns fused. The two weakest areas are **`src/store.ts`** —
the repo's cross-cutting state module, at 38.99% statement coverage with
three irreversible `localStorage` migrations that no test exercises — and
**the `worker/` package**, whose SSRF validator and OAuth-secret handler have
their tests run by CI but their coverage never measured at all. The single
biggest structural theme is neither over- nor under-engineering of the
product code, but **verification that stops at the edges of the main
`src/` tree**: the coverage floors, the strictness flags, and the coverage
gate itself are all applied thoroughly in the middle of the repo and thin out
at its boundaries (the worker, the two largest domain files, the CodeMirror
widget subclasses, the dev-only debug page). Deliberately checked for
overengineering and mostly did not find it — `StorageBackend` has four real
implementations, `readAll`'s `onProgress` has a real producer and a real
consumer, and the TS 6 pin's stated rationale still holds on inspection; the
one exception is `EntryEditorHooks`, half of whose fields are optional purely
to accommodate a dev-only page. The findings below are refinements to a
codebase that is already in good shape, not repairs to a struggling one.

## 2. Coverage statement

**Read closely** (the request's focus — largest files by line count):
`storage/sync.ts` (1159), `model/storeOps.ts` (1004), `model/expansion.ts`
(905), `debug/NodeInheritanceDebugger.tsx` (816), `storage/vaultRegistry.ts`
(752), `store.ts` (642), `storage/ical/rruleToRepeat.ts` (641),
`calendar/agendaSections.ts` (515), `storage/exampleBackend.ts` (496),
`editor/useEntryEditor.ts` (413), `calendar/WeekPane.tsx` (409),
`storage/githubOAuth.ts` (400), `editor/ItemsList.tsx` (384),
`storage/ical/icsToEntries.ts` (370), `storage/githubBackend.ts` (352),
`editor/EntryEditor.tsx` (346), `storage/backend.ts`, `editor/urlSafety.ts`,
`editor/cm/markdownFormatting.ts`, `worker/src/icalFetch.ts`.

**Toolchain read in full:** `package.json` (both workspaces),
`eslint.config.js`, `vite.config.ts`, `vitest.config.ts`, `knip.json`,
`tsconfig*.json`, all four CI workflows.

**Sampled:** `calendar/` (AgendaView, OccurrenceList, MonthGrid, DayPane,
timelineScaffold), `components/` + `components/primitives/`, `hooks/`,
`lib/`, `search/`, `onboarding/`, `routes/`, `storage/cache/`,
`storage/ical/` remainder, `model/` remainder.

**Skipped:** `src/components/ui/**` (shadcn registry mirror — vendored by
policy, excluded from coverage and knip by design); `src/routeTree.gen.ts`
(generated); `blog/`, `assets/`, `public/`, `scripts/` (not source);
`src/model/__tests__/fixtures/` (test data). No source directory was skipped
entirely.

**Fraction:** roughly 45% of `src/` read line-by-line (the largest files are
~32% of non-test source lines on their own), the remainder sampled or
grepped. Both `worker/` source files read in full.

### Gate × workspace matrix

| Gate | command | root (`.`) | `worker` | result |
|---|---|---|---|---|
| build / typecheck | `pnpm run build` | ✅ | ✅ (fans out via `--filter … typecheck`) | **pass** |
| lint | `pnpm run lint` | ✅ | ✅ (`eslint src worker/src`) | **pass** |
| test | `pnpm run test` | ✅ | ✅ (fans out via `--filter … test`) | **pass** — 122 files, 2996 tests |
| **coverage** | `pnpm run test:coverage` | ✅ 74.47% stmt, thresholds enforced | ❌ **not measured** — no fan-out, no `coverage` block in `worker/vitest.config.ts` | pass |
| dead code | `pnpm run knip` | ✅ | ✅ (declared workspace) | **pass** |
| audit | `pnpm audit --audit-level=low` | ✅ | ✅ (run from `worker/`) | **pass** — no known vulnerabilities in either, at `low`, below CI's `high` |

The coverage row is the finding the matrix exists to surface: `test` fans out
to `worker`, `test:coverage` does not, so the gate is green while never
having looked at the package.

**Unverified** (flagged, not investigated): `src/calendar/MonthGrid.tsx`
(4.25%), `MonthView.tsx` (3.7%), `WeekView.tsx` (5.26%), `DayView.tsx`
(6.66%), `useCarousel.ts` (2.17%) — the calendar view shells are the largest
untested surface after `store.ts`, but they are presentational and the survey
focus was elsewhere. `src/editor/save.ts` at 38.93% is the one non-view file
in that band and likely deserves its own look.

## 3. Category verdicts

1. **Architecture & Domain Separation** — findings: #10 (part A is ready to fix; part B is deferred by design — see the finding)
2. **Simplicity & Overengineering** — clean.
3. **Directory & File Layout** — clean.
4. **Security** — clean. Threat model: a client-side PWA over user-owned
   Markdown, parsing untrusted `.ics` feeds and untrusted vault files, with
   GitHub OAuth tokens in IndexedDB and the client secret held server-side in
   the Worker. Verified: no `dangerouslySetInnerHTML` or `innerHTML =`
   anywhere; both URL render paths (`EntryViewOnly.tsx:102`,
   `markdownFormatting.ts:66`) gate on `isSafeUrl`; PKCE verifier/state in
   `sessionStorage` and cleared on use; a strict build-time CSP with
   `script-src 'self'`; the Worker's `/ical` proxy validates hosts on the
   original URL *and* every redirect hop, including IPv6-embedded IPv4;
   `pnpm audit --audit-level=low` clean in both workspaces.
5. **Testing & Error Handling** — clean. Error handling
   itself is clean: exactly two `.catch(() => {})` in non-test source, both
   deliberate and documented.
6. **Code Health & DRY** — clean. A 6-line-window duplicate scan across all
   non-test, non-`components/ui` source found no cross-file duplication other
   than import lists.
7. **Toolchain & Developer Feedback Loops** — clean.
8. **Dependencies & Library Fit** — clean; three keep-verdicts stated below.
9. **Styling & UX** — clean. Zero `<div onClick>`/`<span onClick>` in
   non-test source; `jsx-a11y` recommended is enabled with Radix/Badge/Card
   indirection taught to it.
10. **Performance** — clean. Code-splitting is real (`model` 155 kB,
    `githubOAuth` 103 kB, `vaultActions` 85 kB, `icalBackend` 17 kB all
    separate chunks; main 207 kB / 66.9 kB gzip), `babel-plugin-react-compiler`
    is on with its lint prerequisites enforced, and every long list is
    virtualized.

### Dependency verdicts (category 8 — status quo is correct)

- **TypeScript pinned to `~6.0.3` — keep.** `CLAUDE.md`'s stated expiry
  condition was checked against the registry, not memory: latest
  `@typescript-eslint/eslint-plugin` is **8.68.0** (not 8.65.0 as the doc
  says) and its `peerDependencies.typescript` is still `>=4.8.4 <6.1.0`; the
  installed 8.65.0 hard-codes the same `SUPPORTED_TYPESCRIPT_VERSIONS =
  '>=4.8.4 <6.1.0'`. The rationale holds. Only the doc's parenthetical
  version number is stale.
- **`@types/node` at 22 against a registry latest of 26 — keep.** All four CI
  workflows pin `node-version: 22`; this is correct runtime alignment, not
  drift.
- **`StorageBackend` — keep the abstraction.** Four real implementations
  (`LocalBackend`, `GitHubBackend`, `ExampleBackend`, `IcalBackend`) plus
  three test doubles. `readAll`'s optional `onProgress` was checked for
  speculative generality and has one real producer (`githubBackend.ts:262`)
  and one real consumer (`vaultRegistry.ts:374`).
- **Everything else is patch/minor drift only.** `pnpm outdated` in both
  workspaces shows no major gaps besides the two above. Batch the safe sweep
  in one PR; `pnpm run build && pnpm run lint && pnpm run test` is the
  verdict. `wrangler` 4.113.0 → 4.125.0 is worker-only and exact-pinned;
  bump it in the same sweep and confirm with
  `pnpm --filter meridian-oauth-worker run typecheck`.

## 4. Findings

Every finding below carries a **Task context** block: the specific file, line,
value list or hazard a fixer needs in order to work at the named tier without
re-deriving it. All but one are Sonnet-tier as written *because* of those
blocks — drop the context and most revert to Opus 5.

**`#` is a stable identity, not a priority** (the category verdicts above
reference these numbers, and they don't move as findings get closed out). The
table is sorted by **Rank** — `(impact × breadth) ÷ effort` — while the
detailed sections below stay in `#` order so they're findable.

| Rank | # | Finding | Cat | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|---|
| 6 | 10 | `sync.ts` — 1159 lines across seven banner-delimited concerns | architecture, layout | 4 | 3 | **Sonnet 5** (part A) / Opus 5 (part B) |
| 7 | 9 | `useEntryEditor` — 366-line hook, 26-key return, 8 concerns | srp, architecture | 5 | 2 | **Sonnet 5** |

> **The order above is `(impact × breadth) ÷ effort`, not raw impact.**
>
> **Two findings moved down a tier** once their Task context was written out
> — #9 from Opus 5 to Sonnet 5 outright, and #10 partially. One thing
> did **not** move: `sync.ts`'s scheduler/backoff half (#10 part B) shares the
> `_syncStates` map with sync core, so splitting it needs a design decision
> rather than a specified edit. It is the only Opus-tier work left in the
> report, and it is genuinely Opus-tier — see #10 for why.

---

### 9. `useEntryEditor` is a 366-line hook returning 26 keys across eight concerns

- **Category** — `srp`, `architecture`
- **Impact** — 5
- **Breadth** — 2 files (`editor/useEntryEditor.ts`, its 411-line test).
- **Recommended model** — **Sonnet 5**, scoped to the `useAutoSave`
  extraction with the member list below. (Opus 5 without it: the trap is that
  `commitEntry` *looks* like part of the autosave cluster and is not — it
  reaches `baseRef`, `flushLinksRef`, `createdItemRef`, `setCreatedKey`,
  `setTitleMissing`, `draftId` and `targetVaultId`, so moving it into the new
  hook drags half the file along and changes when the first save creates the
  file.) Pass `commitEntry` **in** as a parameter and the seam is clean.
- **Evidence** — `src/editor/useEntryEditor.ts:48`:
  ```
  export function useEntryEditor(initialOcc: Occurrence | null, initialScope: EditScope = 'single', initialTitle?: string, seed?: NewEntrySeed) {
  ```
  The body holds 6 `useState`, 8 `useRef` and 5 `useEffect`, and returns 26
  keys spanning: autosave timing, vault targeting and cross-vault move,
  wikilink navigation, scope changes, item-type changes, done-toggling, task
  promotion, delete, and route navigation.
- **Problem** — One hook owns eight unrelated jobs in the repo's
  second-highest-churn directory, so any editor change starts by reading 366
  lines to find the three that matter. The file already shows the intended
  seam — it delegates to `useEntryDialogs` and `usePendingLinks` — but the
  extraction stopped there.
- **Fix** — Continue the established pattern by extracting `useAutoSave`
  (timer, `bodyRef`, flush-on-unmount) and `useVaultTarget` (target vault,
  pending move, confirm/cancel) as sibling hooks; confirm with `pnpm run
  test` in the repo root, and check the `src/editor/useEntryEditor.ts`
  coverage floor in `vitest.config.ts` still holds under
  `pnpm run test:coverage`.
- **Task context** — Do the `useAutoSave` half first; it is the larger win and
  the better-defined seam. Signature:

  ```
  useAutoSave(commitEntry: (next: EntryState) => void, entryRef: RefObject<EntryState>)
    → { scheduleAutoSave, flushAutoSave, cancelAutoSave, bodyRef }
  ```

  Moves into the new hook (all currently in `src/editor/useEntryEditor.ts`):
  `autosaveTimerRef` (line 75), `bodyRef` (line 80), `flushAutoSave`
  (line 170), `cancelAutoSave` (line 181), the `flushAutoSaveRef` latest-ref
  pair and its unmount effect (lines 190-192), and `scheduleAutoSave`
  (line 210).

  **Stays behind** in `useEntryEditor`: `commitEntry` (line 141), `saveMeta`
  (line 163), `updateEntry`, `entryRef`, `baseRef`, `createdItemRef`, `flushLinksRef`,
  `initialCommitRef` and its mount effect. `saveMeta` reads `bodyRef`, so
  return `bodyRef` from the hook rather than duplicating it.

  Three specifics that are easy to get wrong:
  - The debounce is **1500 ms** and `scheduleAutoSave` returns early when
    `entryRef.current.editScope === 'add'` — preserve both.
  - `handleDelete` (line 300) calls `cancelAutoSave()` *before* `deleteNode`,
    deliberately, so `goBack`'s flush can't resurrect the item being deleted.
    That ordering must survive the move.
  - The unmount effect is written as a latest-ref pair specifically to avoid
    an `exhaustive-deps` suppression, which the file's comment notes "would
    have opted this hook out of React Compiler optimization entirely". Keep
    the same shape; do not replace it with a dependency array.

  `src/editor/useEntryEditor.test.tsx` (411 lines) already exercises autosave
  and is the regression net. `vitest.config.ts` pins
  `'src/editor/useEntryEditor.ts': { statements: 68, branches: 55, functions: 55, lines: 70 }`
  — after the split that key covers a smaller file, so re-check it holds and
  add a floor for the new hook file.

### 10. `sync.ts` carries seven concerns behind banner comments instead of module boundaries

- **Category** — `architecture`, `layout`
- **Impact** — 4
- **Breadth** — 3 files (`storage/sync.ts`, `storage/index.ts`,
  `vitest.config.ts` — whose per-file floor is keyed to the current path).
- **Recommended model** — **split by half.** **Part A (parse/report) is
  Sonnet 5** — verified one-way seam, specified below. **Part B
  (scheduler/backoff) stays Opus 5**, and this is the one place in the report
  where more context does not lower the tier: `resetSyncBackoff` iterates
  `_syncStates.values()` and mutates `consecutiveFailures`/`nextRetryAt` on
  entries that SYNC CORE owns and writes, so the scheduler and the sync core
  share one mutable map. Separating them means either exporting `_syncStates`
  (which dissolves the singleton the file is built around) or lifting
  `VaultSyncState` into a third module that both import — a design decision,
  not a specified edit. Do part A now; leave part B until someone wants to
  make that call.
- **Evidence** — `src/storage/sync.ts` is 1159 lines divided by seven of its
  own section banners:
  ```
  // ── HELPERS ────────────────────────────────────────────────────
  // ── COLLISION RESOLUTION ───────────────────────────────────────────
  // ── RECONCILE ─────────────────────────────────────────────────
  // ── SYNC CORE ─────────────────────────────────────────────────────────
  // ── BACKOFF STATE ─────────────────────────────────────────────────────
  // ── SCHEDULER ─────────────────────────────────────────────────────────
  // ── CACHE WRITE / DELETE ──────────────────────────────────────
  ```
- **Problem** — The file is the largest in the repo and the second-most-changed
  (11 commits in 60 days), and the banners are doing the job module boundaries
  should: parse-failure reporting, three-way collision resolution, and a timer
  scheduler are separately testable concerns that share a file only by
  history. The cost is concentrated where changes actually land — its
  1931-line test file is the largest test in the repo, because every concern
  must be set up through the same module.
- **Fix (part A)** — Move the parse/round-trip reporting cluster into
  `src/storage/parseReport.ts`, leaving collision/reconcile/sync-core and the
  scheduler in `sync.ts`; confirm with `pnpm run build && pnpm run lint &&
  pnpm run test:coverage` in the repo root (lint enforces the module-barrel
  boundary, coverage confirms the re-keyed threshold).
- **Task context (part A)** — Lines 40–157 of `src/storage/sync.ts` move as a
  block: the `ParseFailure` and `RoundTripLoss` interfaces, `auditRoundTrip`,
  `parseFiles`, `reportParseFailures`, the `_reportedLossy` module-level Set
  (line 130) and `reportRoundTripLosses`. The seam was verified in both
  directions:
  - **Outbound** — the cluster's only imports are `warn`/`warnWithDetails`
    from `./notifications`, `runInIdleBatches` from `@/lib/idle`,
    `parseToStoreItems`/`roundTripLoss` from `@/model`, and `pathToKey` from
    `@/fileIO`. It touches no sync state — not `_syncStates`, not the backoff
    constants, not `getBackend`.
  - **Inbound** — exactly one caller inside `sync.ts` remains:
    `mergeChangedIntoStore` at lines 496–505 (`parseFiles`,
    `reportParseFailures`, `auditRoundTrip`), which becomes an ordinary
    import. External callers are `storage/vaultRegistry.ts` and
    `editor/save.ts`; both import from `@/storage/sync` today and must be
    re-pointed.

  `_reportedLossy` must exist in exactly one module — it is the
  "already warned about this path" dedupe, so a duplicated copy silently
  re-toasts the user on every reconcile. Note `parseFiles` and
  `reportParseFailures` are **not** re-exported from `src/storage/index.ts`,
  so the barrel needs no change; the importers are inside `storage/` and in
  `editor/save.ts`, which reaches them by deep path today — check
  `pnpm run lint` after, since the import-boundary zones will judge the new
  file the same way.

  `vitest.config.ts` pins
  `'src/storage/sync.ts': { statements: 68, branches: 55, functions: 55, lines: 72 }`.
  After the move that key guards a smaller file; re-measure and add a floor
  for `parseReport.ts` too, or the extracted code ends up guarded by nothing
  but the global floor.
- **Fix (part B, deferred)** — Lifting BACKOFF STATE + SCHEDULER (lines
  673–691 and 966–1072, ~130 lines) into `storage/syncScheduler.ts` requires
  first deciding where `VaultSyncState` and the `_syncStates` map should live.
  Worth doing, but as its own change with that decision made explicitly.

---

**Near-miss, not in the top 10:** `multidayCoversDate` in
`src/model/expansion.ts:97` has no production caller — only its own test and
two comments — and its doc comment ("Used by calendar views to show the event
on every covered day without expanding it into multiple occurrences")
describes the design `expandWithMultiday` replaced, which does the opposite
("adds days 2..N"). knip can't see it because a test keeps it alive. Cheap to
close out alongside any other `model/` work; it scored just below #10.

**Survey files updated:** `plans/surveys/health.md` was edited in a separate
commit with three process learnings from this run — pinning down what
"largest files" means, splitting coverage from test on the gate×workspace
matrix axis, and a note about per-workspace `pnpm audit` invocation — plus a
`Task context` entry in its finding-output spec.

`plans/surveys/README.md` gained a new shared section, *"Write findings down
to Sonnet 5 where you honestly can"*, making the Task context block a
convention for **every** survey rather than just this one: rate the tier
against the finding *with* its context written out, don't fake a downgrade
that a judgement call blocks, re-rank afterwards because `effort` feeds the
formula, and keep `#N` stable when the order moves. The other four survey
files inherit it through the README without needing their own edit; only
`health.md` also got the explicit output field, since that is the one this
run exercised.
