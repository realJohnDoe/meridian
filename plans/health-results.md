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

1. **Architecture & Domain Separation** — findings: #10
2. **Simplicity & Overengineering** — findings: #6
3. **Directory & File Layout** — findings: #2, #7
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
5. **Testing & Error Handling** — findings: #3, #4, #5. Error handling
   itself is clean: exactly two `.catch(() => {})` in non-test source, both
   deliberate and documented.
6. **Code Health & DRY** — findings: #8. A 6-line-window duplicate scan
   across all non-test, non-`components/ui` source found no cross-file
   duplication other than import lists and #8.
7. **Toolchain & Developer Feedback Loops** — findings: #1, #3, #5
8. **Dependencies & Library Fit** — clean; three keep-verdicts stated below.
9. **Styling & UX** — findings: #2. Zero `<div onClick>`/`<span onClick>` in
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

| # | Finding | Cat | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 1 | `noImplicitOverride` off — 12 silent-override sites in `editor/cm/` | toolchain, types | 5 | 6 | Haiku 4.5 |
| 2 | `BADGE_CLASS` is a design token exported from a view, with its pixel math hand-copied into two files | layout, styling | 4 | 4 | Haiku 4.5 |
| 3 | `worker/` has no coverage measurement at all | toolchain, testing | 6 | 5 | Sonnet 5 |
| 4 | `store.ts` at 38.99%, with three irreversible migrations untested | testing | 7 | 3 | Sonnet 5 |
| 5 | Coverage floors omit the two largest domain files | toolchain, testing | 3 | 3 | Haiku 4.5 |
| 6 | Half of `EntryEditorHooks` is optional for a dev-only page | overengineering, types | 5 | 4 | Opus 5 |
| 7 | `exampleBackend.ts` — 392 of 497 lines are Tutorial content | layout, srp | 4 | 3 | Sonnet 5 |
| 8 | Virtualized-row scaffold duplicated across three list views | dry | 4 | 3 | Sonnet 5 |
| 9 | `useEntryEditor` — 366-line hook, 26-key return, 8 concerns | srp, architecture | 5 | 2 | Opus 5 |
| 10 | `sync.ts` — 1159 lines across seven banner-delimited concerns | architecture, layout | 4 | 3 | Opus 5 |

> **The order above is `(impact × breadth) ÷ effort`, not raw impact.** Two
> cheap, wide toolchain fixes (#1, #2) outrank the highest-impact finding in
> the report. A reader sorting by what actually matters most should start at
> **#4** (`store.ts` — impact 7, and the only finding where the failure mode
> is silent user-data loss), then **#3**.

**Sequencing:** #3 and #5 both edit coverage config — do #5 first (root
`vitest.config.ts`), then #3 (`worker/vitest.config.ts` + `package.json`), so
the root file is touched once. #9 and #6 both touch the editor's hook/prop
contract — do #6 first, since making the optionals required narrows what #9's
split has to preserve. Everything else is independent.

---

### 1. `noImplicitOverride` is off, and every CodeMirror widget override is unguarded

- **Category** — `toolchain`, `types`
- **Impact** — 5
- **Breadth** — 6 files (5 sources + `tsconfig.app.json`). Measured by a dry
  run, not estimated: a temporary tsconfig extending `tsconfig.app.json` with
  `noImplicitOverride: true` produced exactly **12 `TS4114` errors**, all in
  `src/editor/cm/` — `ReactWidget.ts` (2), `markdownFormatting.ts` (6),
  `taskDecorations.ts` (2), `wikilinkDecorations.ts` (2).
- **Recommended model** — **Haiku 4.5.** The fix is adding the `override`
  keyword at 12 sites; a wrong edit is a compile error, so it cannot fail
  silently. Hazard to name in the task: fix by *adding `override`*, never by
  renaming a method to dodge the error — a rename is the exact bug the flag
  exists to catch.
- **Evidence** — `tsconfig.app.json` enables `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch` and
  `noUncheckedIndexedAccess`, but not `noImplicitOverride`. The unguarded
  sites are CodeMirror `WidgetType` subclasses, e.g.
  `src/editor/cm/markdownFormatting.ts:75`:
  ```
  ignoreEvent(): boolean { return false }
  ```
  against `src/editor/cm/ReactWidget.ts:61`:
  ```
  ignoreEvent(): boolean { return true }
  ```
- **Problem** — CodeMirror's `WidgetType` supplies defaults for `eq()`
  (`false`) and `ignoreEvent()` (`true`), so a typo'd or renamed override
  compiles cleanly and the base default silently takes over — `eq` returning
  the default means the widget re-renders on every update, and `ignoreEvent`
  means clicks stop reaching React handlers, both of which present as vague
  editor jank rather than an error, in the repo's second-highest-churn
  directory (`editor/` 117 commits in 60 days, `editor/cm/` 49 of them).
- **Fix** — Add `"noImplicitOverride": true` to `tsconfig.app.json` and the
  `override` keyword at the 12 reported sites; confirm with `pnpm run build`
  in the repo root.

### 2. `BADGE_CLASS` is a design token exported from a view component, and its pixel height is hand-copied into two other files

- **Category** — `layout`, `styling`
- **Impact** — 4
- **Breadth** — 4 files (`grep -rn "BADGE_CLASS" src`): defined in
  `MonthGrid.tsx`, imported by `WeekPane.tsx`, `DayBadge.tsx`, `MonthView.tsx`.
- **Recommended model** — **Haiku 4.5 if the task names the destination
  module** (`calendar/` already has `timelineGeometry.ts` for exactly this
  kind of shared constant); **else Sonnet 5.** Hazard: moving the constant is
  mechanical, but the real defect is the derived `20`, and it must end up
  derived from one source rather than re-copied. `MonthGrid.tsx` and
  `MonthView.tsx` sit at 4.25% and 3.7% coverage, so nothing will catch a
  regression.
- **Evidence** — `src/calendar/MonthGrid.tsx:29`:
  ```
  export const BADGE_CLASS = 'text-xs font-medium text-dim w-5 h-5 flex items-center justify-center rounded-full shrink-0 mb-px'
  ```
  and `src/calendar/WeekPane.tsx:29`:
  ```
  const ALLDAY_ROW_H = 20 // matches BADGE_CLASS's h-5
  ```
  with `src/calendar/MonthView.tsx:13` independently re-deriving the same
  number: `3px + badge h-5 20px + badge mb-px 1px + the 8px flex gap`.
- **Problem** — A token used by four sibling views lives inside one of them
  (violating the depth rule: broadly-used code belongs above its consumers,
  not inside one), and two separate files hand-compute pixel arithmetic from a
  Tailwind class string in a third — change `h-5` to `h-6` in `MonthGrid.tsx`
  and both silently produce wrong layout, with no type error and no test.
- **Fix** — Move `BADGE_CLASS` (and `CELL_CLASS`/`OCC_LIST_CLASS`, which have
  the same shape) into `calendar/timelineGeometry.ts` beside the other shared
  geometry constants, and export a `BADGE_H = 20` from there that
  `ALLDAY_ROW_H` and `MonthView`'s comment both reference; confirm with
  `pnpm run build && pnpm run lint` in the repo root.

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

### 5. The coverage floors skip the two largest domain files, against the config's own stated policy

- **Category** — `toolchain`, `testing`
- **Impact** — 3
- **Breadth** — 3 files (`vitest.config.ts` plus the two files left unguarded).
- **Recommended model** — **Haiku 4.5.** The fix is adding two threshold
  entries read off a coverage run. Failure is loud: a floor set above measured
  coverage fails CI on the next run. Hazard: read the numbers from an actual
  `pnpm run test:coverage`, don't guess, and follow the file's convention of
  sitting a few points under measured.
- **Evidence** — `vitest.config.ts` states the policy:
  ```
  // Per-file floors for modules already well-covered, so they can't
  // silently regress. Set a few points below measured coverage to leave
  // headroom for legitimate branches added later.
  ```
  and then names 30+ files, including much smaller `model/` neighbours —
  `'src/model/collapse.ts': { statements: 90, branches: 80, functions: 95, lines: 90 }`
  — while `src/model/storeOps.ts` (1004 lines, measured 92.41%) and
  `src/model/expansion.ts` (905 lines, measured 91.38%) have no entry at all.
- **Problem** — The two biggest files in the domain core, both already
  excellently covered, are guarded only by the global floor of `statements:
  68` — so either could shed more than twenty points of coverage without
  failing CI, which is precisely the silent regression the per-file floors
  were introduced to prevent.
- **Fix** — Add per-file threshold entries for `src/model/storeOps.ts` and
  `src/model/expansion.ts` a few points under their measured values; confirm
  with `pnpm run test:coverage` in the repo root.

### 6. Half of `EntryEditorHooks` is optional solely to accommodate a dev-only debug page

- **Category** — `overengineering`, `types`
- **Impact** — 5
- **Breadth** — 4 files (`editor/EntryEditor.tsx`,
  `debug/NodeInheritanceDebugger.tsx`, `routes/_entry.entry.new.tsx`,
  `routes/_entry.entry.$vault.$slug.tsx`).
- **Recommended model** — **Opus 5.** This needs a decision, not an edit:
  either the debugger supplies explicit no-ops for the 12 fields, or it gets
  its own narrower prop type and `EntryEditor` splits its rendering. Picking
  wrong either re-weakens the contract or breaks the debug page — which has
  **0% coverage and no test at all**, so nothing will tell you.
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
  `NodeInheritanceDebugger` pass explicit no-ops (or give it a dedicated
  `ScratchEditorHooks` type); confirm with `pnpm run build` in the repo root,
  which type-checks `src/debug/` too.

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

### 9. `useEntryEditor` is a 366-line hook returning 26 keys across eight concerns

- **Category** — `srp`, `architecture`
- **Impact** — 5
- **Breadth** — 2 files (`editor/useEntryEditor.ts`, its 411-line test).
- **Recommended model** — **Opus 5.** Hazard: the autosave path holds three
  refs whose teardown ordering is load-bearing — `flushAutoSaveRef` is
  invoked from an unmount effect (`useEffect(() => () => {
  flushAutoSaveRef.current() }, [])`) that must still see the current
  `bodyRef`. Moving autosave into its own hook changes unmount order between
  the two hooks and can silently drop the user's last edit; no test covers
  unmount-mid-edit, so this fails quietly.
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

### 10. `sync.ts` carries seven concerns behind banner comments instead of module boundaries

- **Category** — `architecture`, `layout`
- **Impact** — 4
- **Breadth** — 3 files (`storage/sync.ts`, `storage/index.ts`,
  `vitest.config.ts` — whose per-file floor is keyed to the current path).
- **Recommended model** — **Opus 5.** Not plan-mode: the seams are already
  drawn by the file's own banners and the module's barrel is unchanged, so a
  wrong split breaks the build loudly. Hazards to name: `_syncStates`,
  `_reportedLossy` and the backoff state are module-level singletons that must
  land in exactly one file each (duplicating one silently gives two vaults
  independent backoff), and the `'src/storage/sync.ts'` coverage-threshold key
  in `vitest.config.ts` must be re-pointed or the gate silently stops guarding
  anything.
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
- **Fix** — Split the two most independent sections into
  `storage/syncScheduler.ts` (backoff + scheduler, ~130 lines) and
  `storage/parseReport.ts` (the parse/round-trip reporting helpers, ~130
  lines), leaving collision/reconcile/sync-core in `sync.ts`; confirm with
  `pnpm run build && pnpm run lint && pnpm run test:coverage` in the repo root
  (lint enforces the module-barrel boundary, coverage confirms the re-keyed
  threshold).

---

**Near-miss, not in the top 10:** `multidayCoversDate` in
`src/model/expansion.ts:97` has no production caller — only its own test and
two comments — and its doc comment ("Used by calendar views to show the event
on every covered day without expanding it into multiple occurrences")
describes the design `expandWithMultiday` replaced, which does the opposite
("adds days 2..N"). knip can't see it because a test keeps it alive. Cheap to
close out alongside any other `model/` work; it scored just below #10.

**Survey file updated:** `plans/surveys/health.md` was edited in a separate
commit with three process learnings from this run — pinning down what
"largest files" means, splitting coverage from test on the gate×workspace
matrix axis, and a note about per-workspace `pnpm audit` invocation.
