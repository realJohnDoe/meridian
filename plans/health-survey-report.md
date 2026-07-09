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

## Explicitly clean areas

- **Security** (threat model: client-only SPA parsing user-owned YAML/Markdown; GitHub tokens in IndexedDB behind a strict `script-src 'self'` CSP; PKCE with state+verifier checks; client secret isolated in the worker; single-origin CORS) — no findings.
- **Dependencies** — knip is CI-gated and clean, every dependency accounted for; `resolution-mode=lowest-direct` and `verify-store-integrity` are unusually careful.
- **Performance** — React Compiler enabled with the matching lint preset, route-level auto code-splitting, structural-change-aware expansion caching, virtualized lists.
- **Layout** — co-change pairs from `git log --name-only` all live side by side; every CLAUDE.md root-resident claim checked against the real import graph held up.
