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
| **coverage** | `pnpm run test:coverage` | ✅ 74.47% stmt, thresholds enforced | ❌ **not measured** — no fan-out, no `coverage` block in `worker/vitest.config.ts` | pass, but see finding #3 |
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
2. **Simplicity & Overengineering** — findings: #6
3. **Directory & File Layout** — findings: #7
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
5. **Testing & Error Handling** — findings: #3, #4. Error handling
   itself is clean: exactly two `.catch(() => {})` in non-test source, both
   deliberate and documented.
6. **Code Health & DRY** — findings: #8. A 6-line-window duplicate scan
   across all non-test, non-`components/ui` source found no cross-file
   duplication other than import lists and #8.
7. **Toolchain & Developer Feedback Loops** — findings: #3
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
| 1 | 3 | `worker/` has no coverage measurement at all | toolchain, testing | 6 | 5 | Sonnet 5 |
| 2 | 4 | `store.ts` at 38.99%, with three irreversible migrations untested | testing | 7 | 3 | Sonnet 5 |
| 3 | 6 | Half of `EntryEditorHooks` is optional for a dev-only page | overengineering, types | 5 | 4 | **Sonnet 5** |
| 4 | 7 | `exampleBackend.ts` — 392 of 497 lines are Tutorial content | layout, srp | 4 | 3 | Sonnet 5 |
| 5 | 8 | Virtualized-row scaffold duplicated across three list views | dry | 4 | 3 | Sonnet 5 |
| 6 | 10 | `sync.ts` — 1159 lines across seven banner-delimited concerns | architecture, layout | 4 | 3 | **Sonnet 5** (part A) / Opus 5 (part B) |
| 7 | 9 | `useEntryEditor` — 366-line hook, 26-key return, 8 concerns | srp, architecture | 5 | 2 | **Sonnet 5** |

> **The order above is `(impact × breadth) ÷ effort`, not raw impact.** A
> reader sorting by what actually matters most should start at **#4**
> (`store.ts` — impact 7, and the only finding where the failure mode is
> silent user-data loss), then **#3**.
>
> **Three findings moved down a tier** once their Task context was written out
> — #6 and #9 from Opus 5 to Sonnet 5 outright, and #10 partially. One thing
> did **not** move: `sync.ts`'s scheduler/backoff half (#10 part B) shares the
> `_syncStates` map with sync core, so splitting it needs a design decision
> rather than a specified edit. It is the only Opus-tier work left in the
> report, and it is genuinely Opus-tier — see #10 for why.

**Sequencing:** #9 and #6 both touch the editor's hook/prop
contract — do #6 first, since making the optionals required narrows what #9's
split has to preserve. Everything else is independent.

---

### 3. The `worker/` package's tests run in CI but its coverage is never measured

- **Category** — `toolchain`, `testing`
- **Impact** — 6
- **Breadth** — 5 files (4 worker sources left unmeasured +
  `worker/vitest.config.ts`).
- **Recommended model** — **Sonnet 5.** Hazard: adding a `coverage` block is
  trivial, but picking the *initial thresholds* is not — set them from a
  measured run, and set them a few points under measured, matching the root
  config's stated convention. Setting a floor above measured coverage fails
  CI loudly (safe); the silent failure is adding coverage with no thresholds
  at all, which reports numbers nothing gates — exactly the state the root
  config avoided.
- **Evidence** — `worker/vitest.config.ts` in full has no `coverage` key:
  ```
  export default defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  })
  ```
  Meanwhile root `package.json` fans `test` out but not `test:coverage`:
  ```
  "test": "vitest run && pnpm --filter meridian-oauth-worker run test",
  "test:coverage": "vitest run --coverage",
  ```
  and root `vitest.config.ts` scopes coverage to `include: ['src/**/*.{ts,tsx}']`.
- **Problem** — The unmeasured package holds the repo's two most
  security-sensitive files — `worker/src/icalFetch.ts` (286 lines), whose
  `validateFeedUrl` is the SSRF guard on an open fetcher including IPv6-embedded
  IPv4 handling, and `worker/src/oauthToken.ts`, which handles the GitHub
  client secret — and `eslint.config.js` itself calls this package "the most
  security-sensitive code in the repo". Every gate reports green, so the gap
  is invisible from a passing pipeline: an untested branch added to the SSRF
  validator would not move any number anyone looks at.
- **Fix** — Add a `coverage` block with `provider: 'v8'` and per-file
  thresholds to `worker/vitest.config.ts`, add a `test:coverage` script to
  `worker/package.json`, and fan the root `test:coverage` out to it the way
  `test` already does; confirm with `pnpm --filter meridian-oauth-worker run
  test:coverage`, then `pnpm run test:coverage` from the root.
- **Task context** — `worker/` has four sources to threshold:
  `src/icalFetch.ts` (286 lines), `src/oauthToken.ts` (88), `src/index.ts`
  (36), `src/cors.ts` (24), against three test files
  (`icalFetch.test.ts` 224, `oauthToken.test.ts` 152, `index.test.ts` 51).
  Run `pnpm --filter meridian-oauth-worker exec vitest run --coverage` once to
  get the measured baseline, then set each floor a few points under it — the
  convention `vitest.config.ts` states at the root ("Set a few points below
  measured coverage to leave headroom"). `@vitest/coverage-v8` is already in
  the root workspace but **not** in `worker/package.json`; add it there.
  Finally add `&& pnpm --filter meridian-oauth-worker run test:coverage` to
  the root `test:coverage` script so it fans out the way `test` already does.
  Note CI already runs the worker's tests in a separate `worker-checks` job in
  `.github/workflows/ci.yml` — that job is where coverage will start being
  enforced, so no workflow edit is needed if the root script fans out.

### 4. `src/store.ts` is the repo's worst-covered core module, and its three irreversible migrations are untested

- **Category** — `testing`
- **Impact** — 7
- **Breadth** — 3 files (`src/store.ts`, `src/store.test.ts`, and
  `src/lib/vaultStorage.ts` at 35.71% — the helper all three migrations call).
- **Recommended model** — **Sonnet 5.** Hazard to name in the task: each
  migration is idempotent *by deleting its own legacy key*, and
  `migrateParticipantFilter` additionally guards on a module-level
  `_filterMigrationChecked` Set that persists across tests in the same file.
  A test suite that doesn't reset both `localStorage` and the module (via
  `vi.resetModules()`) will pass while never exercising the second-run path —
  which is the path that matters. With that named, Sonnet 5 is enough;
  without it, **Opus 5**.
- **Evidence** — measured coverage for `src/store.ts` (643 lines) is
  **38.99% statements / 42.93% lines / 29.9% branches**, the worst of any
  non-view file in the repo. `src/store.test.ts` is 102 lines containing two
  tests, both under a single `describe('deriveViews', …)`. The untested
  destructive step, `src/store.ts:451`:
  ```
  clearVaultKey(LEGACY_PARTICIPANT_FILTER_PREFIX, vaultId)
  ```
  with the same pattern at lines 411/418 (`LEGACY_FAVORITES_PREFIX`) and 625
  (`LEGACY_SHOW_TASKS_PREFIX` — inside the coverage report's explicitly
  uncovered `609-627` range).
- **Problem** — `store.ts` is a documented cross-cutting root resident
  holding durable state for every feature, it saw 7 commits in the last 60
  days, and it performs three one-way `localStorage` migrations that delete
  the old value as they go. A regression in any of them silently discards a
  user's favourites, participant filters or show-tasks preference with the
  legacy key already gone — unrecoverable, and invisible because no test and
  no coverage floor watches this file.
- **Fix** — Add a `src/store.test.ts` suite covering the three migrations —
  populated legacy key, absent legacy key, empty legacy value, and a second
  run after the key was cleared — and add a per-file coverage floor for
  `src/store.ts` once it is up; confirm with `pnpm run test:coverage` in the
  repo root.
- **Task context** — The three migrations, all in `src/store.ts`:
  1. `readFavorites(vaultIds)` (line ~401) — reads `meridian_favorites`
     (`FAVORITES_KEY`), folds in per-vault `meridian_favorites_<id>`
     (`LEGACY_FAVORITES_PREFIX`), clears each legacy key at lines 411 and 418,
     writes back if `changed || flat === null`.
  2. `migrateParticipantFilter(vaultId, items, current)` (line ~440) — reads
     `meridian_participant_filter_<id>`, clears it at line 451, converts the
     old *inclusive* filter to the new *hidden* semantics as
     `hidden = allParticipants − oldFilter`, writes `HIDDEN_PARTICIPANTS_KEY`.
     Called from `setVaultLayer`.
  3. The show-tasks fold at lines ~622–625 — reads
     `meridian_show_tasks_<id>` (`LEGACY_SHOW_TASKS_PREFIX`), clears every
     vault's copy. This is the one sitting in the coverage report's uncovered
     `609-627` range.

  All three read/write through `src/lib/vaultStorage.ts`
  (`readVaultStringArray`, `readVaultJSON`, `writeVaultJSON`, `clearVaultKey`),
  which is itself at 35.71% — testing the migrations lifts it too.
  `src/test-utils/setup.ts` is already the global setup file; check whether it
  resets `localStorage` between tests before adding your own teardown.
  The four cases per migration: populated legacy key, absent legacy key, empty
  legacy value, and a second run after the key was cleared. The fourth is the
  one that needs `vi.resetModules()` — see the hazard above.

### 6. Half of `EntryEditorHooks` is optional solely to accommodate a dev-only debug page

- **Category** — `overengineering`, `types`
- **Impact** — 5
- **Breadth** — 4 files (`editor/EntryEditor.tsx`,
  `debug/NodeInheritanceDebugger.tsx`, `routes/_entry.entry.new.tsx`,
  `routes/_entry.entry.$vault.$slug.tsx`).
- **Recommended model** — **Sonnet 5**, given the Task context below. (It was
  Opus 5 until the decision was made here: take the no-op route, not the
  separate-prop-type route.) The one hazard that survives is named and located
  — `ListedOnRow.tsx:57` branches on `onOpenWikilink` being `undefined`, so a
  no-op there is *not* behaviour-preserving. Everything else coalesces
  internally. Without that pointer this is Opus 5, because the debug page has
  **0% coverage and no test at all**, so a wrong no-op fails silently.
- **Evidence** — `src/editor/EntryEditor.tsx:62-66` states the reason
  outright:
  ```
   * Declared as its own interface rather than `ReturnType<typeof useEntryEditor>`
   * so `debug/NodeInheritanceDebugger` can drive the same component from a
   * hand-built object: it edits a scratch snapshot, never the vault, so it has no
   * autosave, no wikilink navigation and no backlink toggling. Everything optional
   * here is a capability that caller legitimately doesn't have.
  ```
  12 of the interface's fields carry `?:` as a result (`pendingMove`,
  `onMoveConfirm`, `onMoveCancel`, `scheduleAutoSave`, `saveMeta`,
  `handleScopeChange`, `handleTypeChange`, `handleDoneToggle`,
  `handleOpenWikilink`, `handleToggleDoneBacklink`, `titleMissing`,
  `focusTitleTick`), producing guarded call sites throughout the component —
  `src/editor/EntryEditor.tsx:143`:
  ```
      handleScopeChange?.(scope)
  ```
- **Problem** — Both production call sites pass `useEntryEditor`'s return
  value, which supplies all 12 fields, so the optionality exists only for a
  page that is not in the production bundle (`vite.config.ts` builds
  `index.html` alone). The cost is paid in production: TypeScript can no
  longer distinguish "the debugger legitimately lacks this" from "a route
  forgot to wire this up", and a forgotten handler becomes a silently
  swallowed no-op instead of a compile error, on the app's primary editing
  surface.
- **Fix** — Make the 12 fields required on `EntryEditorHooks` and have
  `NodeInheritanceDebugger` pass explicit no-ops; confirm with `pnpm run
  build` in the repo root, which type-checks `src/debug/` too.
- **Task context** — Drop the `?` from all 12 fields at
  `src/editor/EntryEditor.tsx:82-100`, then extend the object literal at
  `src/debug/NodeInheritanceDebugger.tsx:762-779`. It already supplies
  `entry`, `series`, `vaultId`, `onVaultChange: null`, `pendingLinks`,
  `dialogHandlers`, `setEntry`, `handleSave`, `handleOpenDlg`,
  `handleOpenRepeatDlg`, `handleScopeChange` and `handlePromoteTask`. The 11
  to add, with the values that preserve current behaviour:

  ```
  pendingMove: null,               onMoveConfirm: () => {},
  onMoveCancel: () => {},          scheduleAutoSave: () => {},
  saveMeta: () => {},              handleTypeChange: () => {},
  handleDoneToggle: () => {},      handleToggleDoneBacklink: () => {},
  titleMissing: false,             focusTitleTick: 0,
  handleOpenWikilink: () => {},    // ← see the trap below
  ```

  **The trap.** Two of these are passed straight through to children, and only
  one of the children treats `undefined` as meaningful:
  - `EntryBody.tsx:104-107` coalesces both `onOpenWikilink` and `onChange` to
    `() => {}` internally, so a no-op is exactly equivalent — safe.
  - `ItemsList.tsx:192` calls `onOpenWikilink?.(…)` — safe.
  - **`ListedOnRow.tsx:57` is not safe**:
    `onNavigate={onOpenWikilink && meta ? () => onOpenWikilink(meta.fileSlug) : undefined}`.
    A no-op makes `onNavigate` truthy, so the row renders as navigable and
    then does nothing when clicked. Handle it by keeping the debugger's
    `handleOpenWikilink` genuinely absent at *that* call site — thread the
    debugger's own "no navigation" state down, or have `EntryEditor` pass
    `undefined` to `ListedOnRow` when navigation is unavailable — rather than
    by reverting the field to optional.

  `EntryEditor` destructures all 12 at lines 115-121; no call-site changes are
  needed there beyond the `?.` operators becoming unnecessary (leaving them is
  harmless, so don't churn them unless lint asks).

### 7. `exampleBackend.ts` is 79% Tutorial content wrapped around a 32-line adapter

- **Category** — `layout`, `srp`
- **Impact** — 4
- **Breadth** — 3 files (`storage/exampleBackend.ts`, the new content module,
  `storage/devFixtures/testVaultGen.ts` as the established sibling).
- **Recommended model** — **Sonnet 5.** Hazard: the tutorial's slugs are
  load-bearing beyond this file — `CLAUDE.md` documents `01-start-here` …
  `05-make-it-yours` for agent navigation, and `const VERSION = 'example-v4'`
  gates cache invalidation for every existing user's Tutorial vault. The move
  must preserve both; bumping or dropping `VERSION` by accident silently
  re-seeds or fails to re-seed people's sandbox.
- **Evidence** — `src/storage/exampleBackend.ts` is 496 lines, of which lines
  59–450 are one function, `src/storage/exampleBackend.ts:59`:
  ```
  function buildEntries(): Array<{ id: string; content: string }> {
  ```
  The actual backend is lines 465–496. A sibling directory already exists for
  exactly this kind of content — `src/storage/devFixtures/testVaultGen.ts`,
  described in its own header as producing "a deterministic vault in the same
  markdown+frontmatter format the ExampleBackend uses".
- **Problem** — Editing user-facing onboarding copy means editing a
  `StorageBackend` implementation, and the 32 lines that actually implement
  the interface are buried under 392 lines of Markdown fixtures — so the file
  reads as neither one thing nor the other, and the directory's own
  established home for vault content (`devFixtures/`) is bypassed.
- **Fix** — Move `buildEntries` and its date helpers into
  `src/storage/devFixtures/tutorialVault.ts`, leaving `exampleBackend.ts` as
  the adapter plus `loadEntries`/`VERSION`; confirm with `pnpm run build &&
  pnpm run test` in the repo root.
- **Task context** — Move lines 59–450 of `src/storage/exampleBackend.ts`
  (`buildEntries`) plus the four helpers it depends on — `d` (line 14),
  `lastWeekdayDate` (19), `weekdaysBeforeToday` (25), `doneInstances` (46) —
  and the `const MON = 1, WED = 3, FRI = 5` line (57) into
  `src/storage/devFixtures/tutorialVault.ts`. What stays in
  `exampleBackend.ts`: `loadEntries()` (451), `const ENTRIES` (461),
  `const VERSION = 'example-v4'` (463) and the `ExampleBackend` class
  (465–496).

  Two things must not change value:
  - `VERSION` gates cache invalidation for every existing user's Tutorial
    vault. Leave the string exactly `'example-v4'` — bumping it re-seeds
    everyone's sandbox, and it is not a version of the file's location.
  - The entry ids `01-start-here`, `02-your-first-task`, `03-plan-your-week`,
    `04-link-your-notes`, `05-make-it-yours` are referenced by `CLAUDE.md`
    (the agent-navigation notes) and by the onboarding tour. Grep for them
    after the move.

  `devFixtures/testVaultGen.ts` is the sibling precedent and already imports
  `fmtISO` from `@/model` and `addDays` from `@/format`, exactly as
  `buildEntries` does — so the new file's imports mirror one that already
  passes lint in that directory. `exampleBackend.ts` currently imports
  `generateBigVault` from `./devFixtures/testVaultGen`; it will gain a second
  import from the same directory.

### 8. Three list views hand-copy the same virtualized-row scaffold

- **Category** — `dry`
- **Impact** — 4
- **Breadth** — 3 files (`calendar/AgendaView.tsx`,
  `calendar/OccurrenceList.tsx`, `search/FileResultsList.tsx` — found by
  grepping `FLIP_KEY_ATTR` and the positioning style literal).
- **Recommended model** — **Sonnet 5.** Hazard: the inner FLIP div must stay
  the animated element. The comment duplicated in both files explains why —
  a WAAPI animation outranks inline style, so animating the outer positioned
  div overrides the virtualizer's `translateY` and stacks every row at the top
  of the list. Collapsing the two divs during extraction reintroduces that,
  and no test catches it. `FileResultsList` needs its extra style keys
  (`--stagger`, `paddingBottom`) threaded through rather than dropped.
- **Evidence** — `diff` of `AgendaView.tsx:184-207` against
  `OccurrenceList.tsx:118-141` shows 19 of 24 lines byte-identical, differing
  only in one Tailwind class, two comment lines and the row-renderer switch.
  Both carry `style={{ position: 'absolute', top: 0, left: 0, width: '100%',
  transform: `translateY(${vi.start}px)` }}` verbatim
  (`AgendaView.tsx:198`, `OccurrenceList.tsx:131`), and both carry this
  comment word-for-word:
  ```
  {/* useVirtualFlip animates this inner element, never the
      positioned one above: a WAAPI animation outranks inline
      style, so gliding the outer div would override the
      virtualizer's own translateY and stack every row at the
      top of the list. */}
  ```
- **Problem** — The scaffold that makes virtualization and FLIP animation
  cooperate is subtle enough to need a five-line explanatory comment, and it
  exists in three copies — so a fix to scroll restoration, measurement or the
  animation interaction has to be made three times, in the repo's
  highest-churn directory (`calendar/`, 189 file-touches in 60 days).
- **Fix** — Extract a `VirtualRows` component taking the virtualizer, the
  rows and a render callback, exactly as `calendar/timelineScaffold.tsx` was
  extracted from `DayPane`/`WeekPane` in `cb05ea1`; confirm with `pnpm run
  test` in the repo root (`AgendaView.test.tsx`, `OccurrenceList.test.tsx`
  and `FileResultsList.test.tsx` all exist).
- **Task context** — `src/calendar/timelineScaffold.tsx` is the precedent to
  copy — read it and commit `cb05ea1` first; it solved the identical problem
  for `DayPane`/`WeekPane` and its commit message explains the arity-not-flag
  split principle. The three call sites:
  - `AgendaView.tsx:184-207` — outer `pb-24 lg:max-w-3xl lg:mx-auto`
  - `OccurrenceList.tsx:118-141` — outer `pt-2 pb-24 lg:max-w-3xl lg:mx-auto`
    (the `pt-2` is the only class that differs; make it a prop, don't
    normalise it away)
  - `FileResultsList.tsx` — same shape, but its style object adds two extra
    keys (a `--stagger` custom property set from `vi.index * 0.025` seconds,
    and `paddingBottom: 6`) and casts the object to `React.CSSProperties` so
    the custom property type-checks. Thread extra style keys through rather
    than dropping them.

  The invariant to preserve: **two nested divs, not one.** The outer div
  carries `data-index`, `ref={virtualizer.measureElement}` and the
  `translateY` transform; the inner div carries only `{[FLIP_KEY_ATTR]: vi.key}`
  and is what `useVirtualFlip` animates. The five-line comment duplicated in
  both files explains why merging them breaks the list — carry that comment
  into the extracted component so it doesn't get lost.

  `AgendaView` additionally calls `useVirtualFlip(scRef, virtualItems, rows,
  virtualizer.isScrolling)` and drives scroll restore through `anchorAt` /
  `markAgendaScrolled`; leave all of that in the call sites and extract only
  the render scaffold. Tests exist for all three
  (`AgendaView.test.tsx`, `OccurrenceList.test.tsx`, `FileResultsList.test.tsx`).

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
