# Codebase Health Survey — Report

_Survey date: 2026-07-09. Spec: [health-survey.md](health-survey.md). Surveyed at commit `7d35ec7` on the parent checkout (the assigned `.claude/worktrees/` copy was stale — see finding 6)._

## 1. Health verdict

This is an exceptionally healthy codebase for its class (client-only PWA, ~150 source files): strict TypeScript, a machine-enforced barrel/boundary lint layer, knip and `pnpm audit` gated in CI, a build-time CSP injector, PKCE OAuth with a secret-isolating Cloudflare worker, and a well-tested pure domain core. Security is exemplary — no XSS vectors, no unsafe HTML rendering, and deliberate, documented trade-offs everywhere I looked. The two weakest areas are **test infrastructure** (the entire UI layer is untestable under the current Vitest config, and app test files are type-checked by nothing — real type errors exist in them today) and the **lint enforcement gap in `model/` and the persistence port**, where CLAUDE.md claims machine enforcement that only partially exists. The single biggest structural theme: **the documentation's quality claims run ahead of what the toolchain actually enforces** — invariants are stated as guarded when the guard covers only one failure mode, and the installed lint stack ships type-aware capability (124 real findings' worth) that the config doesn't enable. A separate but serious environment note: the `.claude/worktrees/` agent worktrees are broken (stale file copies, no `.git` pointer), which caused this very survey to initially analyze stale code.

## 2. Coverage statement

- **Read closely:** all root residents (`store.ts`, `storeCommit.ts`, `occurrenceActions.ts`, `fileIO.ts`, `format.ts`, `wikilinks.ts` head), `model/expansion.ts` (full), `model/expansionCache.ts`, `model/storeItems.ts` (head), `model/dateUtils.ts` (partial), `storage/sync.ts`, `storage/cache.ts`, `storage/githubOAuth.ts` (full), `worker/src/*` (full), `calendar/DayView.tsx`, `editor/useEntryEditor.ts`, `editor/save.ts`, plus every toolchain file (`package.json`, `eslint.config.js`, all four tsconfigs, `vite.config.ts`, `vitest.config.ts`, `.npmrc`, `knip.json`, all four CI workflows).
- **Sampled:** `hooks/`, `search/`, `onboarding/`, `components/` (1–2 files each), `model/index.ts` barrel, test inventory. `components/ui/` treated as vendored shadcn (sampled only).
- **Skipped:** `storage/githubBackend.ts`, `localBackend.ts`, `fs.ts`, `exampleBackend.ts` internals (budget; they have tests), `editor/cm/` CodeMirror extensions beyond `taskLines`, `editor/dialogs/RepeatDialog.tsx` (556 lines, unread — flagged **unverified**), `debug/` (dev-only), `routeTree.gen.ts` (generated).
- **Evidence base:** roughly 60–70% of the non-vendored codebase by weight; metrics (import counts, file sizes, co-change pairs, lint dry-runs) computed over 100% of it.
- **Verified by dry-run:** `pnpm run lint` (clean, 1 deliberate warning), `pnpm run knip` (clean), `tsc -p tsconfig.eslint.json` (errors — finding 3), a lint probe file in `model/` (finding 1), and a temporary `recommended-type-checked` ESLint config (finding 2; temp files deleted afterwards).

## 3. Findings

| #   | Title                                                               | Category                      | Impact | Breadth          | Effort |
| --- | ------------------------------------------------------------------- | ----------------------------- | ------ | ---------------- | ------ |
| 1   | Documented architecture invariants only partially machine-enforced  | `toolchain` `architecture`    | 6      | 13 files         | S      |
| 2   | Unused type-checked lint preset — 124 real findings                 | `toolchain` `types`           | 5      | 30 files         | M      |
| 3   | App test files type-checked by nothing (errors exist today)         | `toolchain` `testing` `types` | 4      | 17 files         | S      |
| 4   | UI layer has zero tests and the test config can't run any           | `testing` `toolchain`         | 5      | ~70 files (est.) | L      |
| 5   | `format.ts` hand-rolls calendar math incorrectly beside date-fns    | `library-fit` `dry`           | 4      | 1 file           | S      |
| 6   | Broken `.claude/worktrees/` silently target the wrong repo          | `toolchain`                   | 5      | env-wide         | S      |
| 7   | Hand-rolled recurrence engine — **keep-custom verdict**, one caveat | `library-fit`                 | 2      | 2 files          | n/a    |
| 8   | `store.ts` duplicates `lib/vaultStorage.ts`'s key assembly          | `dry`                         | 2      | 2 files          | S      |
| 9   | OAuth worker returns unhandled 500s on malformed input              | `error-handling`              | 2      | 1 file           | S      |
| 10  | `.npmrc` comment says the opposite of what the setting does         | `toolchain`                   | 1      | 1 file           | S      |

---

### 2. Installed lint stack ships a type-checked preset the config doesn't use — 124 real findings

- **Category:** `toolchain` `types`
- **Impact:** 5 · **Breadth:** 30 files (from the dry-run's per-file tally) · **Fix effort:** M
- **Evidence:** `eslint.config.js` cherry-picks six `@typescript-eslint` rules (`no-floating-promises`, `no-misused-promises`, …). Dry-running the installed plugin's `recommended-type-checked` preset (minus already-enabled rules) via a temporary config: **131 hits, of which 124 are genuine** (7 were "Definition for rule … not found" artifacts from inline disables). Distribution: `no-unnecessary-type-assertion` 47 (auto-fixable — matches the heavy `as`-cast counts in `model/storeOps.ts` (22) and `model/collapse.ts` (14)), `no-base-to-string` 24 (e.g. `model/dateUtils.ts:49 's' will use Object's default stringification format ('[object Object]') when stringified.`), `no-unsafe-member-access` 15, `require-await` 11. Hits concentrate at the untyped-YAML boundary (`model/storeItems.ts` 16, `inheritance.ts` 7, `types.ts` 7).
- **Problem:** The riskiest layer of the app — parsing untrusted YAML into typed domain objects — is where the unused rules fire most, and `no-base-to-string` flags a real bug class (`[object Object]` leaking into dates/durations from malformed frontmatter).
- **Fix:** Enable `recommended-type-checked` (or at minimum `no-base-to-string`, `no-unsafe-*`, `no-unnecessary-type-assertion`) and burn down the 124, starting with the 47 auto-fixes.

### 7. Hand-rolled recurrence engine — keep-custom verdict, with one caveat

- **Category:** `library-fit`
- **Impact:** 2 · **Breadth:** 2 files (`model/expansion.ts`, `model/repeat.ts`) · **Fix effort:** n/a (keep)
- **Evidence:** `src/model/expansion.ts` `generateScheduledDates` reimplements RRULE-style expansion (`byweekday`, `bymonthday`, `bysetpos`, `interval`, count/until ends) that the `rrule` library covers.
- **Problem/verdict:** **The custom engine is the right call** — `after_completion` repeats, per-instance override merging, and the YAML round-trip identity model are domain semantics `rrule` cannot express; the engine has a 500-iteration safety valve and is the best-tested code in the repo (9 test files + fixtures). One caveat: week-start is hardcoded to Monday (`const mondayOff = wd === 0 ? -6 : 1 - wd`) while the app maintains a user-facing `localePrefs.firstDayOfWeek` — for `interval ≥ 2` weekly rules, which days group into the same week depends on week-start (RFC 5545's `WKST`), so Sunday-week users can get off-by-one-week biweekly expansions.
- **Fix:** Keep the engine; either thread `firstDayOfWeek` into `generateScheduledDates` or document Monday-week as the file format's fixed semantics.

### 9. OAuth worker returns unhandled 500s on malformed input

- **Category:** `error-handling`
- **Impact:** 2 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `worker/src/oauthToken.ts`: `const form = await request.formData()` — a non-form-encoded POST body throws before `badRequest()` can answer; likewise `const data = await githubResponse.json()` throws if GitHub ever returns non-JSON (e.g. an HTML error page), despite the handler otherwise carefully returning structured `invalid_request` errors.
- **Problem:** The worker's own error contract (JSON `error_description`, which the client's `exchangeForTokens` parses) breaks on exactly the inputs most likely during an outage, surfacing as an opaque failure in the sign-in flow.
- **Fix:** Wrap both parses in try/catch returning `badRequest(...)` / a 502 JSON error.

### 10. `.npmrc` comment says the opposite of what the setting does

- **Category:** `toolchain`
- **Impact:** 1 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `.npmrc`:
  `# Enforce the lockfile in CI — pnpm install will fail if pnpm-lock.yaml is out of date`
  directly above `frozen-lockfile=false`.
- **Problem:** The comment claims enforcement while the value disables it — the outcome is still safe only because CI happens to pass `--frozen-lockfile` explicitly, but the file actively misleads anyone auditing the supply-chain posture.
- **Fix:** Rewrite the comment to say local installs are unfrozen and CI enforces via the explicit flag (or delete the setting, since `false` is only meaningful locally).

---

## Explicitly clean areas

- **Security** (threat model: client-only SPA parsing user-owned YAML/Markdown; GitHub tokens in IndexedDB behind a strict `script-src 'self'` CSP; PKCE with state+verifier checks; client secret isolated in the worker; single-origin CORS) — no findings.
- **Dependencies** — knip is CI-gated and clean, every dependency accounted for; `resolution-mode=lowest-direct` and `verify-store-integrity` are unusually careful.
- **Performance** — React Compiler enabled with the matching lint preset, route-level auto code-splitting, structural-change-aware expansion caching, virtualized lists.
- **Layout** — co-change pairs from `git log --name-only` all live side by side; every CLAUDE.md root-resident claim checked against the real import graph held up.

## Architecture / DIP issues

5. Port registration is an import side effect that fails silent. Registration happens when storage/index.ts is first imported, and persistencePort.ts uses \_impl?.writeEntity(slug) — if registration ever didn't run, writes would silently no-op rather than throw. A fail-fast throw in the unregistered case would be safer.
