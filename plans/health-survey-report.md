# Meridian — Codebase Health Survey (Report)

_Full-codebase survey. All five quality gates run green at time of writing (build, lint, 568 tests, knip, coverage)._

## 1. Health verdict

This is an **exceptionally healthy codebase** — among the best-engineered surveyed. All five quality gates pass (build, lint with 0 errors, 568 tests, knip, coverage), dependencies are current, and the architecture invariants documented in `CLAUDE.md` are genuinely **machine-enforced** by a sophisticated ESLint config (import-boundary zones, model-purity restrictions, single-importer rules for `zustand`/`dexie`, persistence-port enforcement). Type discipline is near-perfect: zero `any` outside generated files, no `dangerouslySetInnerHTML`, correct URL-scheme sanitization, textbook PKCE OAuth with the client secret isolated in a Cloudflare Worker. The findings are consequently **narrow — one systemic strictness gap, two latent correctness edge-cases, and a cluster of small DRY items — not structural rot.** The single biggest theme is _defense-in-depth on the domain core that isn't yet turned on_: `noUncheckedIndexedAccess` is disabled despite 125 unchecked accesses in exactly the correctness-critical layers (`model/` expansion + `calendar/` layout), and the CodeMirror decoration layer (`editor/cm/`) carries complex logic at 0% test coverage. The worst _relative_ area is the **storage/sync write path**, where a file-extension asymmetry can orphan `.yaml`/`.yml` entries and a bare `catch {}` can silently drop a failed local delete.

## 2. Coverage statement

**Read closely:** entry/architecture core (`types.ts`, `store.ts`, `persistencePort.ts`, `storeCommit.ts`, `occurrenceActions.ts`), the most-imported modules (measured: `@/types` ×105, `@/lib/cn` ×45, `@/store`/`@/model` ×38), the full storage/security layer (`sync.ts`, `githubBackend.ts`, `githubOAuth.ts`, worker `index.ts`/`oauthToken.ts`/`cors.ts`), view-model layer (`occView.ts`, `format.ts`, `occurrence-variants.ts`, `model/dateUtils.ts`, `fileIO.ts`, `occSort.ts`), representative model/editor/calendar/components files (`save.ts`, `computeColumns.ts`, `expansionCache.ts`, `OccurrenceCard.tsx`, `matching.ts`), and the entire toolchain (`package.json`, `eslint.config.js`, all `tsconfig*`, `vite.config.ts`, `vitest.config.ts`, `knip.json`, `.npmrc`, CI workflows).

**Sampled:** onboarding, search, hooks, remaining calendar/editor/components. **Skipped:** `src/components/ui/**` (vendored shadcn primitives — knip/coverage explicitly exclude them), `src/routeTree.gen.ts` (generated), `src/debug/**` (dev-only tooling, not shipped — noted where it appeared in greps), `pnpm-lock.yaml`, `blog/`, `plans/`, `public/`.

**Quality gates (single run):** build ✅ · lint ✅ (0 errors, 2 unavoidable `react-hooks/incompatible-library` warnings on TanStack Virtual) · test ✅ (46 files, 568 tests) · knip ✅ (no unused files/exports/deps) · coverage ✅ (51.6% overall; per-file floors enforced on risky modules).

**Dependency currency (measured via `pnpm outdated`, both workspaces):** essentially current — only patch-level Radix bumps, `@eslint-react` 5.17→5.18, `lucide-react` 1.25→1.26. `@types/node` 22→26 is _correctly_ pinned to the Node 22 CI/runtime. TypeScript 6→7 is _correctly_ held back (verified: `typescript-eslint` still refuses TS 7 — the documented rationale holds).

**Coverage basis:** ~70% of `src/` reviewed by reading, remainder by targeted grep. **Unverified:** the `editor/cm/` decoration internals and `RepeatDialog.tsx` interaction logic were read but not exhaustively traced — flagged in Finding #4. (Note: a `repeat-dialog-state-sprawl` fix has since landed on `origin/main` ahead of this branch's base.)

## 3. Category verdicts

1. **Architecture & Domain Separation** — findings: **#9** (otherwise exemplary; invariants machine-enforced)
2. **Directory & File Layout** — clean
3. **Security** — clean (PKCE OAuth, secret server-side only, URL sanitization, no XSS vectors, CORS scoped)
4. **Testing & Error Handling** — findings: **#4, #7** (error strategy is otherwise strikingly consistent)
5. **Code Health & DRY** — findings: **#2, #3, #5, #6, #8, #10**
6. **Toolchain & Developer Feedback** — findings: **#1** (plus the missing global coverage floor noted in #4)
7. **Dependencies & Library Fit** — clean (status quo verified correct: date-fns used properly, no reinvention, hold-backs justified)
8. **Styling & UX** — clean (centralized `cva` variants, `jsx-a11y` recommended enforced; raw hex confined to `index.css` token definitions and dev-only `debug/`)
9. **Performance** — clean (route+feature lazy-loading in place, CodeMirror isolated in its own chunk, memoization discipline e.g. `EMPTY_LISTED_ON`)

## 4. Findings

**Summary (ranked by a rough `(impact × breadth) ÷ effort`, effort = model tier as ordinal; severity sanity applied so latent data-loss isn't buried under tidy-up):**

| Rank | Finding                                                             | Recommended model  |
| ---- | ------------------------------------------------------------------- | ------------------ |
| 1    | **#1** — `noUncheckedIndexedAccess` disabled                        | Opus 5             |
| 2    | **#2** — vault-file extension asymmetry / duplicated `isVaultFile`  | Opus 5             |
| 3    | **#3** — inlined `done !== undefined` tracked-task predicate        | Sonnet 5           |
| 4    | **#4** — `editor/cm/` decoration layer at 0% coverage               | Opus 5             |
| 5    | **#5** — `{ items, roots }` store snapshot reconstructed inline     | Haiku 4.5          |
| 6    | **#6** — path↔slug conversion scattered, no shared helper           | Sonnet 5           |
| 7    | **#7** — `diskDelete` bare `catch {}` swallows failed local deletes | Sonnet 5           |
| 8    | **#8** — repeated inline pluralization in `format.ts`               | Haiku 4.5          |
| 9    | **#9** — `store.ts` mixes view-ephemeral UI state with domain state | Opus 5 (plan mode) |
| 10   | **#10** — dead redundant branch in `occState`                       | Haiku 4.5          |

**Sequencing note (findings sharing a file):** #1 & #9 both edit `calendar/AgendaView.tsx` (index-access guards vs. moving agenda scroll state out of the store) — land #1 first or bundle them. #2 & #6 both edit `storage/sync.ts` (write-path extension fix vs. the path↔slug helper) — do them together, since #6's shared helper is where #2's fix belongs. #3 & #5 both edit `editor/save.ts` (tracked predicate vs. snapshot helper) — batch to avoid rebasing it twice.

### #4 — `editor/cm/` decoration layer at 0% coverage (no global floor to catch it)

- **Category:** `testing` `toolchain`
- **Impact:** 4 · **Breadth:** 5 files (coverage report: 0%-covered `editor/cm/*` with logic) · **Recommended model:** Opus 5 — an over-mocked decoration test passes without exercising real position-mapping, failing _silently_ (green suite, no protection); **Sonnet 5** if the specific behaviors to assert are enumerated in the task. The global-floor config edit alone is **Haiku 4.5**.
- **Evidence:** Coverage report shows `markdownFormatting.ts` (251 lines), `taskDecorations.ts`, `wikilinkDecorations.ts`, `ReactWidget.ts`, `viewUtils.ts` all at `0 | 0 | 0 | 0`. Meanwhile the _pure_ helper beneath them, `taskLines.ts`, is held to a 90% floor in `vitest.config.ts`, which sets only **per-file** thresholds — so a new untested logic module (as these were) slips through the gate.
- **Problem:** The most bug-prone CM6 code (decoration range computation, position mapping, widget lifecycle) is the least tested, and the coverage gate structurally can't flag newly-added untested modules.
- **Fix:** Add unit tests for the decoration builders (testable against an `EditorState` without a live DOM, as `taskLines.test.ts` shows), and add a modest **global** coverage floor so future untested logic fails CI.

### #6 — Path↔slug conversion is scattered with no shared owner

- **Category:** `dry`
- **Impact:** 2 · **Breadth:** 2 files (grep: `replace(/\.(md|yaml|yml)$/, '')` ×4) · **Recommended model:** Sonnet 5 — entangled with #2: a `pathToSlug`/`slugToPath` pair must agree on extension handling or it silently re-introduces the #2 asymmetry; **Haiku 4.5** for the read-side `pathToSlug` regex alone.
- **Evidence:** `model/storeItems.ts:134` `const fileSlug = path.replace(/\.(md|yaml|yml)$/, '')` and `storage/sync.ts` lines 49, 197, 266 all repeat the same extension-stripping regex, while the inverse (`fileSlugToPath`, `sync.ts:23`) hardcodes `+ '.md'`.
- **Problem:** The mapping between on-disk path and store slug — a genuine domain rule — has four inline copies and no canonical function, which is also what lets #2's read/write asymmetry hide.
- **Fix:** Introduce `pathToSlug`/`slugToPath` next to `titleToSlug` in `fileIO.ts` and route all four sites (and #2's write path) through them.

### #8 — Repeated inline pluralization in `format.ts`

- **Category:** `dry`
- **Impact:** 2 · **Breadth:** 1 file (grep: `=== 1 ?` ×12 in `format.ts`) · **Recommended model:** Haiku 4.5 — purely mechanical, single file; a wrong extraction breaks `format.test.ts` _loudly_. No load-bearing hazard.
- **Evidence:** `format.ts` repeats `${x} ${x === 1 ? 'year' : 'years'}` (and `month`/`week`/`day`/`hour`/`minute`) 12 times across `endDateToDuration`, `endDateTimeToDuration`, `fmtDuration`, `fmtDurationCompact` — e.g. line 67 `return \`${y} ${y === 1 ? 'year' : 'years'}\``.
- **Problem:** The same unit-pluralization rule is hand-inlined a dozen times; a new unit or an i18n change touches all of them.
- **Fix:** Extract a single `pluralize(n, unit)` (or a `{unit: [singular, plural]}` table) and call it from each site.

### #9 — `store.ts` mixes view-ephemeral UI state with vault/domain state

- **Category:** `architecture`
- **Impact:** 3 · **Breadth:** 1 file (source) · **Recommended model:** Opus 5 in plan mode, multi-PR — gated on a product decision (whether to do it at all, given the churn) plus a store-boundary change whose failure is _silent_ (broken agenda scroll-restore, subscription churn) rather than a loud build/test break.
- **Evidence:** `store.ts:83-93` — the app-global Zustand store carries calendar-view-local scroll/carousel state: `agendaScrollOffset: number`, `agendaScrollMeasurements: VirtualItem[]`, `monthPreview: string | null`, `dayPreview: string | null` — alongside vault data (`items`, `roots`), sync status, favorites, and locale.
- **Problem:** Ephemeral `calendar/` concerns live in the cross-cutting store, so a reader tracing calendar-view state must go through the global store and `storeBridge`. Idiomatic single-store Zustand and low-severity — but it's the one place the otherwise-crisp layer boundaries blur.
- **Fix:** Move the agenda/carousel ephemeral fields into a dedicated `calendar/` store slice or co-located hook; leave durable vault/sync/prefs state in the global store. (Genuinely optional — weigh against the churn.)

---

**Bottom line:** No high-severity defects. The two worth acting on soon are **#1** (systemic, preventive) and **#2** (a genuine latent data-loss path, small in code even if it warrants Opus-5 judgment on the resolution). #3–#7 are a cluster of small, mostly-Sonnet DRY/consistency cleanups that share a few files (see sequencing note); #8/#10 are Haiku-tier freebies and #9 is an optional, user-gated architecture call. This repo is in the top decile for engineering discipline — the survey's main service is confirming that, with receipts.
