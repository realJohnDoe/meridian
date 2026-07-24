# Meridian — Codebase Health Survey (Report)

_Full-codebase survey. All five quality gates run green at time of writing (build, lint, 568 tests, knip, coverage)._

## 1. Health verdict

This is an **exceptionally healthy codebase** — among the best-engineered surveyed. All five quality gates pass (build, lint with 0 errors, 568 tests, knip, coverage), dependencies are current, and the architecture invariants documented in `CLAUDE.md` are genuinely **machine-enforced** by a sophisticated ESLint config (import-boundary zones, model-purity restrictions, single-importer rules for `zustand`/`dexie`, persistence-port enforcement). Type discipline is near-perfect: zero `any` outside generated files, no `dangerouslySetInnerHTML`, correct URL-scheme sanitization, textbook PKCE OAuth with the client secret isolated in a Cloudflare Worker. The findings are consequently **narrow and mostly preventive rather than corrective** — the single biggest theme is _defense-in-depth on the domain core that isn't yet turned on_: `noUncheckedIndexedAccess` is disabled despite 125 unchecked accesses clustered in exactly the correctness-critical layers (`model/` expansion + `calendar/` layout), and the CodeMirror decoration layer (`editor/cm/`) carries complex logic at 0% test coverage. The worst _relative_ area is the **storage/sync write path**, where a real (if edge-case) file-extension asymmetry can orphan `.yaml`/`.yml` entries.

## 2. Coverage statement

**Read closely:** entry/architecture core (`types.ts`, `store.ts`, `persistencePort.ts`, `storeCommit.ts`, `occurrenceActions.ts`), the most-imported modules (measured: `@/types` ×105, `@/lib/cn` ×45, `@/store`/`@/model` ×38), the full storage/security layer (`sync.ts`, `githubBackend.ts`, `githubOAuth.ts`, worker `index.ts`/`oauthToken.ts`/`cors.ts`), view-model layer (`occView.ts`, `format.ts`, `occurrence-variants.ts`, `model/dateUtils.ts`, `fileIO.ts`), representative model/editor/calendar/components files (`save.ts`, `computeColumns.ts`, `expansionCache.ts`, `OccurrenceCard.tsx`, `matching.ts`), and the entire toolchain (`package.json`, `eslint.config.js`, all `tsconfig*`, `vite.config.ts`, `vitest.config.ts`, `knip.json`, `.npmrc`, CI workflows).

**Sampled:** onboarding, search, hooks, remaining calendar/editor/components. **Skipped:** `src/components/ui/**` (vendored shadcn primitives — knip/coverage explicitly exclude them), `src/routeTree.gen.ts` (generated), `pnpm-lock.yaml`, `blog/`, `plans/`, `public/`.

**Quality gates (single run):** build ✅ · lint ✅ (0 errors, 2 unavoidable `react-hooks/incompatible-library` warnings on TanStack Virtual) · test ✅ (46 files, 568 tests) · knip ✅ (no unused files/exports/deps) · coverage ✅ (51.6% overall; per-file floors enforced on risky modules).

**Dependency currency (measured via `pnpm outdated`, both workspaces):** essentially current — only patch-level Radix bumps, `@eslint-react` 5.17→5.18, `lucide-react` 1.25→1.26. `@types/node` 22→26 is _correctly_ pinned to the Node 22 CI/runtime. TypeScript 6→7 is _correctly_ held back (verified: `typescript-eslint` still refuses TS 7 — the documented rationale holds).

**Coverage basis:** ~70% of `src/` reviewed by reading, remainder by targeted grep. **Unverified:** the `editor/cm/` decoration internals and `RepeatDialog.tsx` interaction logic were read but not exhaustively traced — flagged in Finding #3.

## 3. Category verdicts

1. **Architecture & Domain Separation** — findings: **#4** (otherwise exemplary; invariants machine-enforced)
2. **Directory & File Layout** — clean
3. **Security** — clean (PKCE OAuth, secret server-side only, URL sanitization, no XSS vectors, CORS scoped)
4. **Testing & Error Handling** — findings: **#3** (error handling itself is a model of consistency)
5. **Code Health & DRY** — findings: **#2, #5**
6. **Toolchain & Developer Feedback** — findings: **#1**
7. **Dependencies & Library Fit** — clean (status quo verified correct: date-fns used properly, no reinvention, hold-backs justified)
8. **Styling & UX** — clean (centralized `cva` variants, `jsx-a11y` recommended enforced)
9. **Performance** — clean (route+feature lazy-loading in place, CodeMirror isolated in its own chunk, memoization discipline e.g. `EMPTY_LISTED_ON`)

## 4. Findings

### #1 — `noUncheckedIndexedAccess` disabled across an index-heavy domain

- **Category:** `toolchain` `types`
- **Impact:** 5 · **Breadth:** 29 files (grep: distinct `src/*` paths in a `tsc` dry-run with the flag on) · **Fix effort:** M
- **Evidence:** `tsconfig.app.json` enables `"strict": true, "noUnusedLocals": true, "noUnusedParameters": true, "noFallthroughCasesInSwitch": true` — but not `noUncheckedIndexedAccess`. A dry-run enabling it yields **125 errors** concentrated in the domain core (`model/expansionCache.ts` ×24, `model/collapse.ts` ×15, `model/dateUtils.ts` ×10, `expansion.ts`, `repeat.ts`, `duration.ts`) and calendar layout (`calendar/AgendaView.tsx` ×14, `useAgendaSections.ts` ×7, `OccurrenceRow.tsx` ×5, `MonthGrid.tsx`, `DayView.tsx`). Real-fragility example — `AgendaView.tsx(137): 'section' is possibly 'undefined'` (virtualizer index lookup).
- **Problem:** Array/Map index access silently typed as non-`undefined` in precisely the paths (recurrence expansion, virtualized layout) where an out-of-range index would flow an `undefined` through as if it were a value — the one strictness class this otherwise-maximally-strict config leaves off.
- **Fix:** Enable the flag, fix the ~10 genuine spots (mostly `AgendaView`) with guards and the rest with justified `!`/`.at()`, sequenced as one dedicated PR.

### #2 — Vault-file extension asymmetry orphans `.yaml`/`.yml` entries; `isVaultFile` duplicated verbatim

- **Category:** `dry` `error-handling`
- **Impact:** 5 · **Breadth:** 4 files (grep: `isVaultFile` defs ×2; `fileSlugToPath`; strip-regex sites) · **Fix effort:** S
- **Evidence:** Reads accept three extensions — `storage/fs.ts:20` and `storage/githubBackend.ts:7` each define, **identically**, `return name.endsWith('.md') || name.endsWith('.yaml') || name.endsWith('.yml')`. But every write hardcodes `.md` — `storage/sync.ts:23` `return fileSlug + '.md'`. `fileIO.ts:49` confirms non-`.md` files parse as pure-frontmatter entries.
- **Problem:** A `.yaml`/`.yml` vault entry is read and gets slug `foo` (extension stripped by `path.replace(/\.(md|yaml|yml)$/, '')`), but saving it writes `foo.md` — leaving the original `foo.yaml` untouched, producing a duplicate/orphaned pair that a later reconcile double-loads into the store. The duplicated predicate also means the two backends can drift.
- **Fix:** Hoist one shared `isVaultFile`/`stripVaultExt`/`slugToPath` into `storage/backend.ts` (or `fileIO.ts`) and make the write path preserve the source extension — or, if only `.md` is truly supported, narrow `isVaultFile` to `.md` so reads and writes agree.

### #3 — `editor/cm/` decoration layer at 0% coverage (no global floor to catch it)

- **Category:** `testing` `toolchain`
- **Impact:** 4 · **Breadth:** 5 files (coverage report: 0%-covered `editor/cm/*` with logic) · **Fix effort:** M
- **Evidence:** Coverage report shows `markdownFormatting.ts` (251 lines), `taskDecorations.ts`, `wikilinkDecorations.ts`, `ReactWidget.ts`, `viewUtils.ts` all at `0 | 0 | 0 | 0`. Meanwhile the _pure_ helper beneath them, `taskLines.ts`, is held to a 90% floor in `vitest.config.ts`. `vitest.config.ts` sets only **per-file** thresholds — there is no global floor, so a new untested logic module (as these were) slips through the gate.
- **Problem:** The most bug-prone CM6 code (decoration range computation, position mapping, widget lifecycle) is the least tested, and the coverage gate structurally can't flag newly-added untested modules.
- **Fix:** Add unit tests for the decoration builders (they're testable against an `EditorState` without a live DOM, as `taskLines.test.ts` shows), and add a modest **global** coverage floor so future untested logic fails CI.

### #4 — `store.ts` mixes view-ephemeral UI state with vault/domain state

- **Category:** `architecture`
- **Impact:** 3 · **Breadth:** 1 file (source) · **Fix effort:** M
- **Evidence:** `store.ts:83-93` — the app-global Zustand store carries calendar-view-local scroll/carousel state: `agendaScrollOffset: number`, `agendaScrollMeasurements: VirtualItem[]`, `monthPreview: string | null`, `dayPreview: string | null` — alongside vault data (`items`, `roots`), sync status, favorites, and locale.
- **Problem:** Agenda scroll measurements and month/day carousel previews are ephemeral `calendar/` concerns living in the cross-cutting store, so a reader tracing calendar-view state must go through the global store and `storeBridge`. This is idiomatic single-store Zustand and low-severity — but it's the one place the otherwise-crisp layer boundaries blur.
- **Fix:** Move the agenda/carousel ephemeral fields into a dedicated `calendar/` store slice or co-located hook; leave durable vault/sync/prefs state in the global store. (Genuinely optional — weigh against the churn.)

### #5 — Repeated inline pluralization in `format.ts`

- **Category:** `dry`
- **Impact:** 2 · **Breadth:** 1 file (grep: `=== 1 ?` ×12 in `format.ts`) · **Fix effort:** S
- **Evidence:** `format.ts` repeats `${x} ${x === 1 ? 'year' : 'years'}` (and `month`/`week`/`day`/`hour`/`minute`) 12 times across `endDateToDuration`, `endDateTimeToDuration`, `fmtDuration`, `fmtDurationCompact` — e.g. line 67 `return \`${y} ${y === 1 ? 'year'  : 'years'}\``.
- **Problem:** The same unit-pluralization rule is hand-inlined a dozen times; a new unit or an i18n change touches all of them.
- **Fix:** Extract a single `pluralize(n, unit)` (or a `{unit: [singular, plural]}` table) and call it from each site.

---

**Bottom line:** No high-severity defects. The two findings worth acting on soon are **#1** (cheap, systemic, preventive) and **#2** (a genuine latent data-loss path, small fix). #3–#5 are polish. This repo is in the top decile for engineering discipline — the survey's main service is confirming that, with receipts.
