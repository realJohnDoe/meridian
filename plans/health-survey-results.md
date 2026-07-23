# Codebase Health Survey — Results

Surveyed at `692a983` on `claude/codebase-health-survey-420e7e` (2026-07-23). Survey prompt: [health-survey.md](health-survey.md).

## 1. Health verdict

This is one of the healthiest codebases I've surveyed: the documented architecture invariants are not just claims but machine-enforced by lint zones (I verified each one against the code and found zero violations), the sync engine is carefully reasoned CAS-based code with its tricky paths unit-tested, and CI runs build, typegen, lint, test, knip, and a dependency audit. The worst area by a clear margin is the **untested sublayer of `storage/`** — vault lifecycle, IndexedDB cache, and OAuth token refresh sit at 1–9% coverage while their neighbors (`sync.ts`, `githubBackend.ts`) are at ~88%. The second soft spot is a small cluster of **toolchain drift**: coverage floors that CI never enforces, a tsconfig test-exclude pattern that misses `.tsx` tests, and a TS language target lagging the declared es2022 runtime. The single biggest structural theme is that *the verification infrastructure slightly trails the code's own high standards* — the guards exist on paper (thresholds, targets, pins) but a few aren't actually wired to anything. There is also one genuine pending library-fit decision: TanStack Virtual is flagged incompatible with the React Compiler this project enables, in two components including the app's home view.

## 2. Coverage statement

**Read closely** (~35–40% of source LOC): `store.ts`, `storeBridge.ts` (skim), `storeCommit.ts`, `persistencePort.ts`, `occurrenceActions.ts`, `occView.ts`, `fileOccurrence.ts`, `wikilinks.ts`, `model/expansion.ts` (head), `model/storeOps.ts` (head), `storage/sync.ts`, `storage/vaultRegistry.ts`, `storage/cache.ts` (head), `storage/githubOAuth.ts`, `storage/exampleBackend.ts` (tail), `worker/src/*` (all three), `editor/ItemsList.tsx`, `editor/cm/markdownFormatting.ts` (link widget), `calendar/DayPane.tsx` (head), `search/SearchOverlay.tsx`, plus every config: `package.json` ×2, `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`, all four tsconfigs, `knip.json`, `.npmrc`, all four CI workflows.

**Sampled via grep/structure only:** remaining `calendar/`, `editor/dialogs/`, `components/`, `hooks/`, `onboarding/`, `routes/`, `lib/`, `debug/` (dev-only, excluded from prod bundle — verified via `rollupOptions.input`).

**Skipped:** `components/ui/**` internals (vendored shadcn), model test fixtures, `public/`, `scripts/process-icon.mjs`, `plans/` (docs).

**Quality gates (single run):** build ✅ · lint ✅ (0 errors, 2 warnings — see finding #3) · tests ✅ 437/437 · worker tests ✅ 14/14 · knip ✅ clean · `pnpm audit --audit-level=high` ✅ (1 low, below gate) · coverage run ✅ (43% statements overall; thresholds pass).

**Unverified:** runtime UX/visual behavior (didn't launch the app, per CLAUDE.md); File System Access edge cases in `localBackend`/`fs.ts`.

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Architecture & Domain Separation | **clean.** Every CLAUDE.md invariant verified by measurement: no barrel bypasses (grep excluding allowed exceptions), `model/` purity lint-enforced, persistence port not pierced, the documented `calendar → components → editor → routes → calendar` cycle confirmed real and reasonably accepted. |
| 2 | Directory & File Layout | findings: **#9**. Barrels consistent across all 9 feature dirs; routes co-located; git co-change (80 commits) follows feature boundaries. |
| 3 | Security | **clean.** Threat model: static GitHub-Pages SPA + minimal token-exchange worker; GitHub tokens in IndexedDB (unavoidable client-side), mitigated by strict `script-src 'self'` CSP; PKCE + state check correct; worker keeps the client secret server-side with restricted CORS; markdown links scheme-allowlisted (`/^(https?|mailto):/i`) with `noopener`; no `innerHTML` anywhere. |
| 4 | Testing & Error Handling | findings: **#1, #2**. Error strategy is otherwise consistent (notify/notifyError + console; the six silent catches are justified localStorage/fallback guards). |
| 5 | Code Health & DRY | findings: **#7**. (Also: the `\.(md\|yaml\|yml)$` slug-strip regex appears in 2 files / 4 sites — below reporting threshold.) |
| 6 | Toolchain & Developer Feedback Loops | findings: **#2, #5, #6**. Anti-recommendation, from an actual dry-run: adopting `@eslint-react`'s full `recommended-type-checked` preset would add 32 warnings that are mostly duplicates of the react-hooks compiler rules plus naming/stylistic rules (`exhaustive-deps` ×8, `naming-convention-*` ×6, `use-state` ×5) — the current hand-picked rule set is the better choice; keep it. |
| 7 | Dependencies & Library Fit | findings: **#3, #4, #8**. Status-quo-correct verdicts: `@types/node` 22 held back correctly (CI runs Node 22 — runtime alignment, not drift); `.npmrc` `resolution-mode=lowest-direct` makes in-range "outdated" entries deliberate policy; hand-rolled YAML round-trip/expansion beside `date-fns` is right (owned file format with inheritance semantics no library expresses); `dexie`, `zustand`, `embla`, `vaul` all squarely in their core use cases. |
| 8 | Styling & UX | **clean.** shadcn/Tailwind used consistently; the 32 inline `style={{}}` sites are almost all dynamic pixel math (virtualizers, timeline layout) where Tailwind can't help; jsx-a11y recommended enforced at error level; loading/error/offline states modeled in the store and surfaced. |
| 9 | Performance | **clean.** React Compiler enabled, route-level `autoCodeSplitting` on, virtualization in the two long lists, incremental `fom`/backlink indexes. Watch (not a finding): the PWA precaches 1.76 MB including the lazy 719 kB CodeMirror chunk — defensible for an offline-first app. |

## 4. Findings

### #1 — Vault lifecycle & auth-refresh layer is effectively untested

**Category:** `testing` · **Impact:** 6 · **Breadth:** 6 files (coverage rows <10%: `vaultRegistry.ts` 1.1%, `cache.ts` 2.0%, `githubOAuth.ts` 9.0%, `localBackend.ts`, `fs.ts`, `notifications.ts` 0%) · **Fix effort:** M

**Evidence:** [vaultRegistry.ts:167](../src/storage/vaultRegistry.ts#L167) — `await fallbackToExample().catch(() => {})`; measured coverage from `pnpm run test:coverage`.

**Problem:** The code that keeps vault identity consistent across "three places [that] must always agree" (its own words), decides token-refresh recovery (`ensureFreshAccessToken`'s force/PAT/margin branching), and persists everything to IndexedDB has near-zero coverage, while the neighboring sync engine is at 87% — the riskiest orchestration in `storage/` is the one part nothing guards.

**Fix:** Unit-test `ensureFreshAccessToken`'s decision matrix (its storage calls are already injectable-shaped) and the `restoreVaultsInner`/`setActiveVault` branch logic against a fake backend + `fake-indexeddb`, mirroring how `sync.test.ts` already fakes its dependencies.

### #2 — Coverage floors exist but CI never enforces them

**Category:** `toolchain` `testing` · **Impact:** 5 (mechanically guards the regression class in #1's neighborhood — scores like the class it catches) · **Breadth:** 2 files (`vitest.config.ts`, `.github/workflows/build.yml`), protecting 9 thresholded modules · **Fix effort:** S

**Evidence:** [vitest.config.ts](../vitest.config.ts) — `// Per-file floors for modules already well-covered, so they can't` `// silently regress.` — but [build.yml](../.github/workflows/build.yml) runs only `- run: pnpm test` (no `--coverage`), and Vitest checks thresholds only when coverage is enabled.

**Problem:** The config's own stated purpose ("can't silently regress") is currently false — every per-file floor is a dead letter because no CI step runs `test:coverage`.

**Fix:** Change the CI test step to `pnpm run test:coverage` (the run adds ~0 wall time here since coverage collection ran in 41s locally vs 54s for the plain suite).

### #3 — TanStack Virtual is flagged incompatible with the enabled React Compiler

**Category:** `library-fit` `performance` · **Impact:** 5 · **Breadth:** 2 files (grep `useVirtualizer`: `calendar/AgendaView.tsx`, `search/FileResultsList.tsx`) · **Fix effort:** M

**Evidence:** lint output at [AgendaView.tsx:151](../src/calendar/AgendaView.tsx#L151) (`const virtualizer = useVirtualizer({`): *"TanStack Virtual's `useVirtualizer()` API returns functions that cannot be memoized safely — react-hooks/incompatible-library"* — the only 2 warnings in an otherwise clean lint run.

**Problem:** `babel-plugin-react-compiler` is enabled globally, but the compiler cannot safely memoize the two virtualized components — one being the agenda, the app's home view — leaving a standing correctness risk (stale virtualizer state under memoization) that the config comment explicitly labels "real but sometimes unfixable."

**Fix:** Resolve the decision this branch's name implies: either swap these two lists to a component-API virtualizer that doesn't fight the compiler (e.g. react-virtuoso — verify its compiler compatibility empirically, not from its README), or add `'use no memo'` directives to the two components and record that as the accepted trade-off.

### #4 — TypeScript 7 major available; the rest is one safe minor sweep

**Category:** `dependencies` · **Impact:** 4 · **Breadth:** 2 workspaces (`pnpm outdated`: 28 outdated rows in root, 3 in `worker/`) · **Fix effort:** M

**Evidence:** [package.json:85](../package.json#L85) — `"typescript": "~6.0.0"` — registry reports 6.0.3 current vs **7.0.2 latest** (both workspaces).

**Problem:** The only real version gaps are one major (TS 7) and a pile of in-range minors/patches; nothing is abandoned or vulnerable (audit: 1 low), but the tilde pin means TS stays on 6.0.x until someone acts deliberately.

**Fix (sequencing):** PR 1 — batch the safe sweep (`pnpm update` both workspaces: all Radix/CodeMirror/TanStack/react/vite/tailwind minors + `@eslint-react` 5.17, `@typescript-eslint` 8.65, `eslint` 10.7, `wrangler` 4.113), gated by `pnpm run build && pnpm run lint && pnpm test && pnpm --filter meridian-oauth-worker test`; PR 2 — try TS 7 on a branch, gating risk being `@typescript-eslint@8.65`'s TS-7 support matrix and `tsc -b` behavior, same green command as verdict; leave `@types/node` at 22 (CI/production run Node 22 — upgrading past the runtime would be drift in the other direction).

### #5 — `tsconfig.app.json` excludes `*.test.ts` but not `*.test.tsx`

**Category:** `toolchain` · **Impact:** 2 · **Breadth:** 7 files (`git ls-files 'src/**/*.test.tsx'`) · **Fix effort:** S

**Evidence:** [tsconfig.app.json](../tsconfig.app.json) — `"exclude": ["src/**/__tests__/**", "src/**/*.test.ts"]`.

**Problem:** The seven `.test.tsx` files silently fall into the *app* project (compiled by `tsc -b` alongside production code, contrary to the exclude's evident intent), duplicating work with `tsconfig.test.json` which includes all of `src`.

**Fix:** Change the pattern to `"src/**/*.test.*"` (or `*.test.{ts,tsx}`).

### #6 — TS language target lags the declared es2022 runtime

**Category:** `toolchain` `dependencies` · **Impact:** 2 · **Breadth:** 2 config files · **Fix effort:** S

**Evidence:** [tsconfig.app.json](../tsconfig.app.json) — `"target": "ES2020",` / `"lib": ["ES2020", "DOM", "DOM.Iterable"]` vs [vite.config.ts:186](../vite.config.ts#L186) — `target: ['es2022', 'chrome102', 'firefox102', 'safari16'],` with the comment "aligns with the actual runtime requirements."

**Problem:** The type system forbids ES2021/22 idioms (`.at()`, `Object.hasOwn`, error `cause`, top-level await typing) that the build and every supported browser already accept — an "unused newer feature" of the installed toolchain per the project's own runtime declaration.

**Fix:** Bump `target`/`lib` to `ES2022` in `tsconfig.app.json` (and the worker's tsconfig if it lags too); zero runtime effect since `noEmit`.

### #7 — Vault activation logic duplicated between restore and switch paths

**Category:** `dry` `srp` · **Impact:** 3 · **Breadth:** 1 file (4 near-duplicate blocks) · **Fix effort:** M

**Evidence:** [vaultRegistry.ts:154](../src/storage/vaultRegistry.ts#L154) — `const backend = new GitHubBackend(targetRef.id, targetRef.name, { ...targetRef.github, token })` vs [vaultRegistry.ts:191](../src/storage/vaultRegistry.ts#L191) — `const backend = new GitHubBackend(id, ref.name, { ...ref.github, token })`.

**Problem:** `restoreVaultsInner` and `setActiveVault` each hand-build the local/GitHub backend + permission + token flow with subtly different interactivity flags and failure messages, so a future change to activation semantics must be made twice and the divergences (silent fallback vs. toast) are easy to miss — and this interweaving is part of why the file is untestable (#1).

**Fix:** Extract a single `buildAndActivate(ref, { interactive })` helper that both paths call, with the restore path supplying its fallback-to-example policy as the failure handler.

### #8 — Undocumented exact pin on `@lezer/markdown`

**Category:** `dependencies` · **Impact:** 2 · **Breadth:** 1 file · **Fix effort:** S

**Evidence:** [package.json:24](../package.json#L24) — `"@lezer/markdown": "1.6.4",` (only exact pin among 39 deps; registry latest 1.7.2; introduced in commit `508a684` with no stated rationale).

**Problem:** A pin is a standing decision, and this one's rationale is recorded nowhere — nobody can tell whether 1.7.x breaks the link-widget rendering the pinning commit touched or whether the pin is just stale.

**Fix:** Either try `^1.7.2` on a branch (gate: `pnpm test` + manual check of body-editor link rendering) or add a one-line comment stating what 1.7.x broke.

### #9 — `use-visual-viewport` violates the project's own placement rule

**Category:** `layout` · **Impact:** 1 · **Breadth:** 3 files (grep `useVisualViewport`: the hook + `components/ui/dialog.tsx`, `components/ui/popover.tsx`) · **Fix effort:** S

**Evidence:** [dialog.tsx:41](../src/components/ui/dialog.tsx#L41) — `const viewportHeight = useVisualViewportHeight()` — the hook's only two consumers, both in `components/ui/`.

**Problem:** CLAUDE.md's placement rule says a file belongs in a subdirectory "when every caller already lives in that subdirectory"; by that standard this hook belongs in `components/`, not the shared `hooks/` barrel it currently widens.

**Fix:** Move it to `components/ui/` (already an allowed deep-import zone) and drop the two exports from `hooks/index.ts` — or explicitly note it as intended-shared and leave it.

---

**Overall:** 9 findings, none above impact 6 — no padding to reach 10. The top three (untested vault-lifecycle layer, the unenforced coverage gate that would guard it, and the virtualizer/compiler decision) are where I'd spend effort; #2 and #5–#6 are quick wins that close real gaps for a few minutes' work.
