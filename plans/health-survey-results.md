# Codebase health survey — results

Run: 2026-08-08 · commit `b7fdc5b` · branch `claude/codebase-health-survey-ldpr9j`

> **Update:** findings #1 (malformed YAML array/boolean/priority values escaping the parse quarantine and crashing the whole vault load), #2 (`types.ts` god module mixing the YAML parse runtime with storage and UI vocabulary), #4 (`storage/cache.ts` holding five unrelated concerns because one lint rule forced them together), #5 (`strict-type-checked` subset unenabled), #7 (CI accepting lint warnings silently), and #8 (`NewEntrySeed` defined twice) have been fixed and their write-ups removed below — see the "Fixed and removed from this record" note under the findings summary table for what changed and how each was verified. The remaining findings keep their original numbers (#3, #6, #9) rather than being renumbered, so references from parallel sessions still resolve.

## 1. Health verdict

Meridian is a healthy, unusually well-tended codebase: every quality gate passes (build, lint, 79 test files, coverage 62.5% against a 57% floor, knip, `pnpm audit --audit-level=high`), the documented architecture invariants are genuinely machine-enforced by custom `import-x` zones rather than just asserted, dependencies are current in both workspaces with zero unaddressed major gaps, and the security posture (PKCE + `state`, worker holding the client secret, no `innerHTML` anywhere, scheme-guarded link widget) is correct. The weakest remaining area is the **storage cache** — the durability-and-credentials layer, now `storage/cache/{db,files,credentials,registry}.ts` — which is still the repo's least-covered code (3.7% statements, `vi.mock`'d away in every test that touches it). (Two of the weak spots this survey originally found have since been fixed: the YAML parse boundary and god-module structure in `types.ts`, and the concern-crowding that kept all five of the cache's jobs in one 396-line file. See the update note above.)

The single biggest structural theme this survey found was **underengineering at exactly one seam — the boundary between untrusted file bytes and typed domain data**: `parseToStoreItems` was wrapped in a careful per-file quarantine that reported failures to the user, but the coercion it fed emitted `string[]` types holding numbers and `boolean` types holding strings, so one hand-authored `items: [42]` in any vault file escaped the quarantine and threw in `buildBacklinkIndex`, taking the whole vault load down. That gap is now closed. With it fixed, the codebase's remaining underengineering is smaller and more contained — the storage cache's near-zero test coverage, now that the five unrelated concerns it crowded into one file have been split apart — set against a mild, localised overengineering pressure elsewhere: an `EditorShell` that forwards fifteen fields and adds a `<section>`, thirteen single-caller one-line forwarders in `storeBridge.ts`, and an entry-editing concern that costs eight files to follow end to end. Neither theme is systemic enough to call the codebase unhealthy.

## 2. Coverage statement

**Read closely** (full file or all significant sections): `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `eslint.config.js`, `vitest.config.ts`, `knip.json`, `vite.config.ts` (build/plugin sections), all four `.github/workflows/*.yml`, `worker/package.json`, `worker/wrangler.toml`, `worker/src/{index,cors,oauthToken}.ts`, `src/types.ts`, `src/store.ts`, `src/storeBridge.ts`, `src/storeCommit.ts`, `src/persistencePort.ts`, `src/fileIO.ts`, `src/wikilinks.ts`, `src/fileOccurrence.ts`, `src/occView.ts`, `src/model/{storeItems,nodeSchema}.ts` + the parse walker in `expansion.ts`, `src/storage/{backend,activeBackend,index,cache,sync,githubOAuth}.ts`, `src/editor/{save,state,useEntryEditor,EditorShell,EntryEditor}.tsx?`, `src/routes/{_app.entry.$slug.tsx,-entryRoute.ts}`, `src/calendar/{useExpandWithMultiday,undatedOccs,UndatedListView,BacklogView,NotesView,viewState,OccurrenceList}.tsx?`, `src/lib/matching.ts`, `src/hooks/index.ts`, `src/onboarding/*`, `src/editor/cm/markdownFormatting.ts` (link/widget path).

**Sampled** (grep/structure/interface level, not line by line): the remaining `src/calendar/*` views, `src/components/*` and `src/components/primitives/*`, `src/search/*`, `src/editor/dialogs/*`, `src/editor/cm/*` beyond the link path, `src/storage/{githubBackend,githubApi,fs,localBackend,exampleBackend,vaultRegistry,notifications}.ts`, `src/model/{collapse,inheritance,repeat,duration,dateUtils,expansionCache,roundTripCheck,storeOps}.ts`, the test suite (mock strategy and file inventory rather than assertions).

**Skipped, with reason:** `src/components/ui/**` (vendored shadcn registry — deliberately excluded from coverage and knip, and `shadcn diff` is the right check for it, not this one); `src/routeTree.gen.ts` (generated); `src/debug/NodeInheritanceDebugger.tsx` (780 lines, developer-only tooling never shipped to users, already lint-exempted for a11y); `blog/`, `public/`, `plans/`, `scripts/process-icon.mjs` (not application code); `pnpm-lock.yaml`.

**Quality gates — all run once, all green:**

| Gate | Command | Result |
|---|---|---|
| Build | `pnpm run build` | ✅ pass (exit 0) |
| Lint | `pnpm run lint` | ✅ pass (exit 0) — **0 errors, 12 warnings**, ratcheted via `--max-warnings=12` (formerly finding #7, fixed and removed from this record) |
| Tests | `pnpm run test:coverage` | ✅ pass — statements 62.46%, branches 59.25%, functions 53.22%, lines 64.67%; all per-file and global thresholds met |
| Dead code | `pnpm run knip` | ✅ pass, zero issues |
| Audit | `pnpm audit --audit-level=high` | ✅ pass (1 moderate, below threshold) |
| Worker typecheck | `pnpm --filter meridian-oauth-worker run typecheck` | ✅ pass |
| Worker tests | `pnpm --filter meridian-oauth-worker run test` | ✅ pass (14 tests, 2 files) |

**Fraction of codebase:** ~60–65% of the 35.9k lines of first-party TS/TSX read directly; the rest covered structurally (exports, imports, signatures, test inventory).

**Development concentration** (`git log --since="60 days ago" --name-only`, 199 commits): `src/components` 294 file-touches, `src/editor` 292, `src/model` 270, `src/calendar` 238, `src/storage` 128, `src/routes` 113. Hottest single files: `src/model/storeOps.ts` (12), `src/editor/EntryBody.tsx` (12), `src/routes/_app.tsx` (10). Findings in `editor/`, `model/` and the root parse files are weighted up accordingly.

**Unverified areas** I suspect but did not have budget to confirm:
- `src/editor/cm/*` decoration plugins (`wikilinkDecorations.ts` 58% stmt / 28% branch, `taskDecorations.ts` 65% / 35%) — CodeMirror `ViewPlugin` lifecycle bugs are exactly the class low branch coverage hides, and `EntryBody.tsx` is the #2 hottest file in the repo. **Unverified.**
- `src/storage/vaultRegistry.ts` (447 lines, 72% stmt, uncovered ranges at 354-415/444-445) — multi-vault activation/teardown ordering. **Unverified.**
- Whether the 720 KB (245 KB gzipped) lazy `editor` chunk can be split further; it is already off the critical path, so I did not chase it. **Unverified.**

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Architecture & Domain Separation | findings: **#6** — barrel invariants, `model/` purity and port usage all verified clean by grep; both god modules (#2, `types.ts`; #4, `storage/cache.ts`) were fixed and removed from this record |
| 2 | Simplicity & Overengineering | findings: **#6, #9** — its other finding (#5, `strict-type-checked` subset unenabled) was fixed and removed from this record |
| 3 | Directory & File Layout | **clean** — co-change analysis over 120 days produced no cross-directory pair above 3 co-occurrences; the root-resident list in CLAUDE.md matches the actual import graph (spot-checked all 12); `-`-prefixed non-route files in `routes/` are correctly placed beside their only consumers |
| 4 | Security | **clean** — threat model and evidence below the table |
| 5 | Testing & Error Handling | findings: **#3** — error *strategy* is otherwise consistent and good (see note below) |
| 6 | Code Health & DRY | **clean** — both its findings (#1, malformed YAML coercion; #8, `NewEntrySeed` defined twice) were fixed and removed from this record |
| 7 | Toolchain & Developer Feedback Loops | **clean** — both its findings (#5, `strict-type-checked` subset unenabled; #7, CI silently accepting lint warnings) were fixed and removed from this record |
| 8 | Dependencies & Library Fit | **clean** — measured verdicts below the table |
| 9 | Styling & UX | **clean** — 33 inline `style={{}}` uses, all dynamic values Tailwind can't express (measured positions, CSS custom properties, virtualizer transforms); no custom re-implementation of an installed shadcn component; `jsx-a11y/recommended` is enabled and passing with one justified `no-autofocus` disable |
| 10 | Performance | **clean** — React Compiler enabled at target 19, three virtualized lists, route-level `lazy()` on every heavy view, an LRU expansion cache with correct vault-change reset wiring (verified `resetCalendarOnVaultChange` → `resetExpansionCache` is called from `routes/_app.tsx:56`) |

**Category 4 — threat model and why it is clean.** Everything but the OAuth token exchange is client-side: vault bytes live in the browser's IndexedDB (Dexie) and on the user's disk or GitHub repo; the only server is a Cloudflare Worker holding `GITHUB_CLIENT_SECRET`. Untrusted input is (a) vault markdown/YAML, possibly authored by someone else in a shared repo, and (b) the OAuth redirect's query string. Checks run: zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` across `src/`; the one variable `href` is a module constant (`GITHUB_APP_INSTALL_URL`); `LinkWidget.toDOM` uses `textContent` and gates navigation on `/^(https?|mailto):/i.test(this.url)`, so `[x](javascript:…)` in a note body renders inert; `completeGitHubSignIn` validates `state !== storedState` and uses S256 PKCE; the worker never echoes the client secret and gates CORS response-reading on a single origin, with a correct written rationale for why executing the exchange from any origin is safe under PKCE; tokens sit in IndexedDB (appropriate for an offline-first PWA — `sessionStorage` holds only the short-lived verifier). `pnpm audit --audit-level=high` is clean and `pnpm-workspace.yaml` carries documented, CVE-cited overrides plus `minimumReleaseAge: 1440`.

**Category 5 — the error *strategy* is a keep.** `storage/githubBackend.ts` routes every failure through one `mapGitHubError` classifier; `sync.ts` quarantines per-file parse failures and surfaces them via `reportParseFailures` toasts rather than `console.warn` alone. Only three empty `catch` blocks exist repo-wide (`src/store.ts:27`, `src/storage/exampleBackend.ts:446`, `src/onboarding/tourState.ts:8`) and all three wrap `localStorage` access, where swallowing is correct. Finding #3 is about a gap the strategy doesn't reach, not about the strategy.

**Category 8 — measured verdicts** (`pnpm outdated` in both workspaces, run this session):
- **Root workspace: no unaddressed major gaps.** 28 packages drift by patch/minor only (Radix `1.1.20 → 1.1.23`, `@tanstack/react-router 1.170.18 → 1.170.23`, `lucide-react 1.25.0 → 1.30.0`, `vite 8.1.5 → 8.2.1`, `eslint 10.7.0 → 10.8.0`, `knip 6.29.0 → 6.32.0`, …). Note `resolution-mode=lowest-direct` in `.npmrc` means "Current" is the floor of each caret range, not a stale lock — the drift is a deliberate standing policy, not neglect. **Verdict: batch all of these into one sweep PR; `pnpm run build && pnpm run lint && pnpm run test:coverage && pnpm run knip` green is the verdict.**
- **`typescript ~6.0.3` (latest 7.0.2) — deliberately held back, and the reason still holds.** Verified by inspection, not memory: the installed `@typescript-eslint/typescript-estree@8.65.0` declares `exports.SUPPORTED_TYPESCRIPT_VERSIONS = '>=4.8.4 <6.1.0'` with an empty `SUPPORTED_PRERELEASE_RANGES`. CLAUDE.md's rationale is accurate; the only correction is that latest is now 8.66.0, not 8.65.0, so the re-check should target that line. **Verdict: keep the pin.**
- **`@types/node ^22.20.1` (latest 26.2.0) — correct runtime alignment, not drift.** Both `.github/workflows/build.yml` and `ci.yml` pin `node-version: 22`. Chasing 26 would type against APIs CI and the Worker build don't have. **Verdict: keep; bump only when CI's Node major moves.**
- **`jsdom 29.1.1 → 30.0.1` — the one real major gap.** Dev-only, used solely as vitest's opt-in DOM env for the ~20 files carrying `// @vitest-environment jsdom`. **Verdict: try on its own branch; gating risk is DOM-API behaviour changes in `responsive-modal` / `TimeWheels` / `FloatingComboboxList` tests. `pnpm run test:coverage` green is the verdict.**
- **Worker workspace: `wrangler 4.113.0 → 4.120.0` (exact pin, minor drift).** The exact pin is a standing decision worth keeping — `wrangler types` output feeds the worker's type-aware lint, so a floating range would make lint results non-reproducible. **Verdict: keep the exact pin, bump the number in the same sweep PR.**
- **Library fit, both directions:** no hand-rolled date math found beside `date-fns` (`differenceInCalendarDays`, `addWeeks`, `addMonths`, `startOfToday` are used where you'd expect); YAML goes through the `yaml` package with a documented YAML-1.2-core rationale rather than a regex; `@octokit/plugin-throttling` is used for exactly its purpose. `src/lib/matching.ts` is a 35-line hand-rolled subsequence matcher rather than a fuzzy-search dependency — **keep-custom is right**: it is shared by all four pickers, its ranking is tuned to this app's prefix-bonus behaviour, and a library like Fuse would add weight for a worse fit.

---

## 4. Findings

### Summary table

| # | Finding | Recommended model |
|---|---|---|
| 3 | The durability + credentials layer is mocked out of every test it appears in (3.7% coverage) | **Opus 5** |
| 6 | Entry editing costs eight files to follow, with `EditorShell` forwarding fifteen fields and adding nothing | **Opus 5** |
| 9 | 13 of 19 `storeBridge` exports are single-caller one-line forwarders | **Sonnet 5** |

**Fixed and removed from this record:** #1 (malformed YAML array/boolean/priority values escaped the parse quarantine and crashed the whole vault load) — `parseInlineField`/`extractFileMetadata` in `src/types.ts` now validate array elements and boolean/priority shape, routing anything that fails validation into the `extra` bag so a save still round-trips byte-for-byte. Verified: `pnpm run build`/`lint`/`test:coverage` stay green, and a regression test in `linking.test.ts` reproduces the original `buildBacklinkIndex` crash and confirms it no longer throws. #2 (`types.ts` mixed pure domain types with the YAML parse/coercion runtime, plus the unrelated storage and UI vocabularies `VaultRef`/`OccState`/`LocalePrefs`, importable by 105 files) — the runtime registry (`INLINE_FIELDS`, `parseInlineField`, `extract*Metadata`, `deepEqual`, `scalarToString`, and friends) moved to `model/fieldRegistry.ts` next to its only callers (every consumer was already inside `model/`, so no import-boundary reversal was needed); `VaultRef`/`VaultKind`/`GitHubVaultRef` moved to a new root leaf `src/vaultRef.ts`; `OccState` moved into `occView.ts` beside the `occState()` function that derives it; and `LocalePrefs` moved into `model/dateUtils.ts`, re-exported from the `@/model` barrel. Rather than add a bespoke lint rule to stop `types.ts` regrowing runtime exports, `eslint.config.js` now derives its module list from the filesystem (any `src/` directory with its own `index.ts`) and extends each module's `no-restricted-paths` zone to cover root-level files as a restricted target too, not just sibling modules — folding the root-file case `no-internal-modules` used to police separately into the same structural rule. Verified: `pnpm run build`/`lint`/`test:coverage`/`knip` and the worker's `typecheck`/`test` all stay green, the generalized zones introduce zero new violations against the existing codebase, and a deliberate test import (a root file reaching into `@/model/collapse`) confirmed the rule still fires before being reverted. #4 (`storage/cache.ts` mixed the file cache, credentials, FS handles, the vault registry and a pure in-memory refcount in one 396-line file, because `eslint.config.js`'s `no-restricted-imports` ignores list named that one path as the only file allowed to import `dexie`) — the module is now `src/storage/cache/`: `db.ts` owns the Dexie class, `cacheInit()` and the row shapes and is the *only* dexie importer, with `files.ts` (cache CRUD, `CacheRecord`, the `dirty` ↔ `SyncStatus` mapping), `credentials.ts` (FS handle, access/refresh token, expiry) and `registry.ts` (vault list, active vault) reaching IndexedDB only through it. The in-flight write registry, which never touched Dexie at all, moved out to `src/storage/inFlight.ts`. The eslint `ignores` entry was narrowed to exactly `src/storage/cache/db.ts` — not widened to `src/storage/cache/**`, which would have dissolved the singleton guarantee with lint still green — and its message and comment now say so. No barrel was added: `cache/` is internal structure inside the `storage` module (like `editor/cm/`), so it doesn't become a nested module with its own boundary zone. Callers import the concern they use (`sync.ts` → `cache/files` + `inFlight`, `githubOAuth.ts` → `cache/credentials`, `vaultRegistry.ts` → all four), and the three test files that faked the old module now fake only the concerns they exercise — `sync.test.ts` drops its hand-written copy of the in-flight registry entirely and runs the real `inFlight.ts`, which has no Dexie to mock. Verified: `pnpm run build`/`lint` (0 errors, the same 12 ratcheted warnings)/`test:coverage` (79 files, 1060 tests, all thresholds met)/`knip` all stay green. #5 (`strict-type-checked` shipped in the installed plugin but wasn't enabled) — `eslint.config.js` now enables `no-unnecessary-condition` (with `allowConstantLoopConditions: true` for the deliberate `while (true)` retry loop in `storage/sync.ts`), `no-deprecated`, and `use-unknown-in-catch-callback-variable` in both the `src/` and `worker/src/` rule blocks. Each of the 84 flagged sites across 29 files was audited individually against the runtime source of the value rather than mechanically deleted: most were genuinely-redundant `?? []`/`|| []` fallbacks on fields the type registry already guarantees non-null (e.g. `tags`, `items`, `participants`) or exhaustive `if`/`else if` chains over a closed union where the last branch was always true; three sites in `test-utils/setup.ts` were kept with a targeted `eslint-disable` because the DOM lib types claim `matchMedia`/`ResizeObserver`/`scrollIntoView` are always defined while jsdom 29 doesn't implement them, so the guards are load-bearing polyfills, not redundant checks. Verified: `pnpm run build`/`lint`/`test:coverage` (1028 tests) and the worker's `typecheck`/`test`/`knip` all stay green. #7 (CI accepted lint warnings silently, and unused-disable reporting was switched off in both `eslint.config.js` blocks) — `package.json`'s `lint` script now runs with `--max-warnings=12` as a ratchet, and `reportUnusedDisableDirectives` is `'error'` in both blocks. Verified: `pnpm run lint` still exits 0 at exactly 12 warnings with zero unused-disable errors, and `pnpm run build` stays green. #8 (`NewEntrySeed` was defined twice, in `routes/` and `editor/`, with divergent types) — the `routes/` copy was deleted and it now imports the type from `@/editor`. Verified: `pnpm run build` stays green with no import-cycle error, and both files' tests still pass.

**Sequencing note.** #4 was the prerequisite for #3 and has landed: the cache is now split into `storage/cache/{db,files,credentials,registry}.ts` plus `storage/inFlight.ts`, so #3's tests can be written against those files directly rather than against a 396-line module that would have been rewritten under them. The remaining findings are independent.

---

### 3. The durability and credentials layer is `vi.mock`'d out of every test that touches it

- **Category** `testing`
- **Impact** 7
- **Breadth** 8 files — search: `grep -rl "storage/cache/\|'./cache/" src --include=*.ts --include=*.tsx` → `storage/{index,vaultRegistry,sync,githubOAuth}.ts` and 4 test files, of which `sync.test.ts`, `githubOAuth.test.ts` and `vaultRegistry.test.ts` all replace the cache with a fake
- **Recommended model** **Opus 5.** The hazard is that a naive "add tests for the cache" pass writes them against `fake-indexeddb` and proves nothing, because the semantics that actually matter are the *interactions* the fakes currently paper over: the refcounted in-flight registry versus `planReconcile`'s `status !== 'clean'` guards, and the `dirty: number` ↔ `SyncStatus` mapping whose whole justification is not migrating existing users' caches. Getting those wrong produces green tests over a broken reconcile — a silent failure, which is why this doesn't go down-tier.
- **Evidence** `src/storage/__tests__/sync.test.ts:44`:
  ```
  vi.mock('@/storage/cache/files', () => {
  ```
  …and the coverage report, re-measured after finding #4's split (the numbers moved between files; the substance didn't):
  ```
   src/storage/cache |     3.1 |        0 |       0 |    3.36 |
    credentials.ts   |       0 |        0 |       0 |       0 | 11-81
    db.ts            |   13.33 |        0 |       0 |   15.38 | 35-36,47-66
    files.ts         |    3.12 |        0 |       0 |     3.5 | 21-193
    registry.ts      |       0 |        0 |       0 |       0 | 8-40
  ```
  Zero branch and zero function coverage across the directory that persists every unsynced edit and every GitHub access/refresh token (`export async function tokenSave(vaultId: string, token: string): Promise<void> {`, `cache/credentials.ts:29`).
- **Problem** The one place that decides whether an offline edit survives a reload — and where OAuth tokens live — has no real test at all; every sync test asserts against a hand-written in-memory fake whose semantics can drift from Dexie's without a single test going red.
- **Fix** Add a `fake-indexeddb`-backed suite exercising the real Dexie paths (dirty/tombstone lifecycle, `applyRemoteBatch`, token round-trip), and give `cache/files.ts`, `cache/credentials.ts` and `cache/registry.ts` per-file thresholds in `vitest.config.ts` so they can't regress. In-flight refcounting no longer needs Dexie at all — `storage/inFlight.ts` is already exercised for real by `sync.test.ts`.

---

### 6. Entry editing costs eight files to follow, with `EditorShell` forwarding fifteen fields and adding nothing

- **Category** `architecture` `overengineering` `srp`
- **Impact** 5
- **Breadth** 8 files, 899 lines — `routes/_app.entry.$slug.tsx` (80), `routes/-entryTopbar.tsx` (48), `editor/useEntryEditor.ts` (294), `editor/useEntryDialogs.ts` (111), `editor/usePendingLinks.ts` (42), `editor/EditorShell.tsx` (60), `editor/EntryEditor.tsx` (271), `editor/DialogStack.tsx` (85), plus `editor/save.ts` (209). Search: import-chain walk from `_app.entry.$slug.tsx`
- **Recommended model** **Opus 5.** The hazard is `useEntryEditor`'s five deliberate refs (`bodyRef`, `flushLinksRef`, `entryRef`, `createdItemRef`, `autosaveTimerRef`), each carrying a comment explaining a specific stale-closure or remount bug it prevents — notably that `createdItemRef` is deliberately *not* stored on `entry.item` because `EntryEditor` derives `bodyKey` from that field and flipping it would remount CodeMirror under the user. Collapsing the layers without preserving those identities produces a version that passes every test and loses the user's cursor (or their body text) on a real autosave. That failure is invisible to the build and to the suite.
- **Evidence** `src/editor/EditorShell.tsx` destructures fifteen fields and re-passes each one individually, adding only a `<section>` and a sibling `<DialogStack>`:
  ```
      handleTypeChange, handleDoneToggle,
  ```
  …and `EntryEditor`'s own `Props` interface carries 21 members, ten of them optional callbacks. `editor/` is the #2 hottest directory in the repo (292 file-touches in 60 days), so each new editor feature pays this forwarding tax again.
- **Problem** Following one behaviour end to end — "what happens when the user types in the title" — requires opening the route, the hook, the shell, the presentational component and `save.ts`, and the shell layer in the middle contributes no behaviour, validation or error handling of its own to justify the hop.
- **Fix** Inline `EditorShell` into `_app.entry.$slug.tsx` (it is the only caller) and pass the `hooks` object through to `EntryEditor` as one prop rather than fifteen, keeping `useEntryEditor`'s ref identities exactly as they are.

---

### 9. 13 of 19 `storeBridge` exports are single-caller one-line forwarders

- **Category** `overengineering`
- **Impact** 3
- **Breadth** 1 file (`src/storeBridge.ts`), 6 consumers — search: per-export `grep -rlw <name> src --include=*.ts --include=*.tsx | grep -v storeBridge.ts | grep -v '\.test\.'`, which returns exactly 1 file for `getFom`, `getSyncError`, `getVaults`, `setActiveVaultId`, `setLastSyncedAt`, `setPendingReconnect`, `setSyncDirtyCount`, `setSyncError`, `setSyncInProgress`, `setSyncOffline`, `setVaultList`, `setVaultLoadProgress` and `setVaultLoading`
- **Recommended model** **Sonnet 5.** The hazard is that this is *not* purely dead indirection, and a fix that treats it as such breaks two real things: `src/storage/__tests__/sync.test.ts` and `vaultRegistry.test.ts` both `vi.mock('@/storeBridge')` wholesale as their store seam, and `setActiveVaultId` is the one forwarder with genuine behaviour (it fans out to four per-vault `load*` calls and resets them on null). Collapsing that one into a bare `setState` loses the fan-out with no test failure, since the tests mock the module rather than exercising it.
- **Evidence** `src/storeBridge.ts:19` is representative of the thirteen:
  ```
  export const setSyncDirtyCount   = (n: number)         => useStore.setState({ syncDirtyCount: n })
  ```
  Only `setData` (7 callers), `getSnapshot` (4), `getItems`/`getRoots`/`setUnreadableFiles` (3 each) and `getUnreadableFiles` (2) have more than one consumer.
- **Problem** Two thirds of the module is a named alias for a `useStore.setState` call with exactly one call site and no added behaviour, validation or error handling — an indirection layer sized for a variance that doesn't exist, and one that has to be extended by hand every time a store field is added.
- **Problem, honestly stated** The module does earn part of its keep as the test seam and as the enforcement point for the "only `store.ts` imports zustand" rule, which is why this ranks low rather than being a straight deletion.
- **Fix** Keep `setData`, `getSnapshot`, the multi-caller getters and `setActiveVaultId` (which has real behaviour); replace the thirteen single-caller setters with one `setStoreState(partial: Partial<MeridianStore>)` forwarder, preserving the mockable module boundary the storage tests rely on.
