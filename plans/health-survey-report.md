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

### 5. `format.ts` hand-rolls calendar math incorrectly beside an installed date library

- **Category:** `library-fit` `dry`
- **Impact:** 4 · **Breadth:** 1 file, 2 functions (grep `durationToEnd` → `format.ts` + 3 UI callers) · **Fix effort:** S
- **Evidence:** `src/format.ts`:
  `if (p.unit === 'months')  return fmtISO(addDays(start, p.n * 30 - 1))` and
  `: p.unit === 'days'    ? addMinutes(start, p.n * 24 * 60)`
  — with `date-fns` (which exports calendar-correct `addMonths`/`addYears`/`addDays`) imported **in the same file**.
- **Problem:** A "1 month" duration starting Jan 31 ends Mar 1 instead of Feb 28, and day/week durations computed as minutes shift by an hour across DST transitions (`addDays` is DST-safe; `addMinutes(start, 1440)` is not) — user-visible wrong end dates in the duration dialog.
- **Fix:** Replace the arithmetic with `addMonths`/`addYears`/`addWeeks`/`addDays` from the already-installed library.

### 6. Agent worktrees under `.claude/worktrees/` are broken and silently target the wrong repo

- **Category:** `toolchain`
- **Impact:** 5 · **Breadth:** environment-wide (this survey's assigned worktree confirmed; prior sessions hit the same) · **Fix effort:** S
- **Evidence:** `.claude/worktrees/suspicious-jones-32470b/` has **no `.git` file**, so `git rev-parse --show-toplevel` from inside it returns `C:/Users/johan/code/meridian` — every git command silently operates on the parent repo. Its file copy is stale: its `package.json` lacks `@eslint-react/eslint-plugin`, and `eslint.config.js`, `index.html`, `knip.json`, and `src/occState.test.ts` are missing entirely. There is also a junk artifact directory `C:Usersjohancodemeridian.githubworkflows` (a mangled Windows path) in the repo root, untracked.
- **Problem:** An agent editing or surveying in such a worktree reads and modifies stale code while its commits land somewhere else — this survey initially computed metrics on the stale copy before catching it.
- **Fix:** Delete the broken worktree directories, recreate via `git worktree add` (verifying the `.git` pointer file exists), remove the junk directory, and consider a session-start check (hook) that fails fast when `git rev-parse --show-toplevel` doesn't match the cwd.

### 7. Hand-rolled recurrence engine — keep-custom verdict, with one caveat

- **Category:** `library-fit`
- **Impact:** 2 · **Breadth:** 2 files (`model/expansion.ts`, `model/repeat.ts`) · **Fix effort:** n/a (keep)
- **Evidence:** `src/model/expansion.ts` `generateScheduledDates` reimplements RRULE-style expansion (`byweekday`, `bymonthday`, `bysetpos`, `interval`, count/until ends) that the `rrule` library covers.
- **Problem/verdict:** **The custom engine is the right call** — `after_completion` repeats, per-instance override merging, and the YAML round-trip identity model are domain semantics `rrule` cannot express; the engine has a 500-iteration safety valve and is the best-tested code in the repo (9 test files + fixtures). One caveat: week-start is hardcoded to Monday (`const mondayOff = wd === 0 ? -6 : 1 - wd`) while the app maintains a user-facing `localePrefs.firstDayOfWeek` — for `interval ≥ 2` weekly rules, which days group into the same week depends on week-start (RFC 5545's `WKST`), so Sunday-week users can get off-by-one-week biweekly expansions.
- **Fix:** Keep the engine; either thread `firstDayOfWeek` into `generateScheduledDates` or document Monday-week as the file format's fixed semantics.

### 8. `store.ts` duplicates the localStorage helper that `lib/vaultStorage.ts` claims to own

- **Category:** `dry`
- **Impact:** 2 · **Breadth:** 2 files (grep `` `${keyPrefix}_${vaultId}` `` → both) · **Fix effort:** S
- **Evidence:** `src/lib/vaultStorage.ts` documents "the storage key is assembled in one place", yet `src/store.ts` defines its own
  `function readVaultJSON<T>(keyPrefix: string, vaultId: string, defaultValue: T): T`
  assembling the same `` `${keyPrefix}_${vaultId}` `` key.
- **Problem:** The generic reader is the natural third sibling of `readVaultStringArray`/`writeVaultJSON`; its private copy in `store.ts` violates the module's own stated contract and will drift on the next key-scheme change.
- **Fix:** Move `readVaultJSON` into `lib/vaultStorage.ts` and import it.

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

1. The GitHub adapter leaks into the generic sync orchestrator — the one real hexagonal break. sync.ts:289:

if (e instanceof AuthSyncError && !attemptedRefresh && backend instanceof GitHubBackend) {
sync.ts imports the concrete GitHubBackend and ensureFreshAccessToken, then does an instanceof dispatch and calls backend.updateToken(fresh). The orchestrator that should only know StorageBackend contains one adapter's auth-recovery protocol. It's the only instanceof <Backend> in the codebase (grep confirmed), so the fix is contained: add an optional refreshAuth(): Promise<boolean> to the StorageBackend interface, move the refresh logic into GitHubBackend, and the orchestrator's retry loop becomes adapter-agnostic.

3. Presentation leaks into orchestration and infrastructure (mild, arguably fine). occurrenceActions.ts:1 imports toast from sonner directly and runs the undo-toast state machine; storage/notifications.ts has infrastructure driving UI toasts. A purist would surface events and let the UI subscribe — and the store's syncError/syncOffline fields are that cleaner channel, used in parallel. At this app's scale I'd accept it; if you ever want to tidy it, occurrenceActions importing sonner directly (rather than going through a wrapper like notifications.ts) is the first thing to fix.

4. VaultRef lives in the wrong layer. store.ts:3 and storeBridge.ts do import type { VaultRef } from '@/storage' — the application state layer depends on an infrastructure-owned type. It's type-only (erased at runtime, no real cycle), but "a reference to a vault" is an application concept; moving it to types.ts would fix the arrow direction.

5. Port registration is an import side effect that fails silent. Registration happens when storage/index.ts is first imported, and persistencePort.ts uses \_impl?.writeEntity(slug) — if registration ever didn't run, writes would silently no-op rather than throw. A fail-fast throw in the unregistered case would be safer.
