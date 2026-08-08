# Codebase health survey — results

Run: 2026-08-08 · commit `b7fdc5b` · branch `claude/codebase-health-survey-ldpr9j`

## 1. Health verdict

Meridian is a healthy, unusually well-tended codebase: every quality gate passes (build, lint, 79 test files, coverage 62.5% against a 57% floor, knip, `pnpm audit --audit-level=high`), the documented architecture invariants are genuinely machine-enforced by custom `import-x` zones rather than just asserted, dependencies are current in both workspaces with zero unaddressed major gaps, and the security posture (PKCE + `state`, worker holding the client secret, no `innerHTML` anywhere, scheme-guarded link widget) is correct. The two weakest areas are **the YAML parse boundary** — `types.ts` plus the coercion path it owns, where the domain types promise more than the parser delivers — and **`storage/cache.ts`**, the durability-and-credentials layer, which is simultaneously the repo's most concern-crowded module (32 exports over five unrelated jobs) and its least-covered one (3.7% statements, `vi.mock`'d away in every test that touches it).

The single biggest structural theme is **underengineering at exactly one seam — the boundary between untrusted file bytes and typed domain data** — while the rest of the codebase is, if anything, slightly over-abstracted. `parseToStoreItems` is wrapped in a careful per-file quarantine that reports failures to the user, but the coercion it feeds emits `string[]` types holding numbers and `boolean` types holding strings; one hand-authored `items: [42]` in any vault file therefore escapes the quarantine and throws in `buildBacklinkIndex`, taking the whole vault load down. Against that, the overengineering pressure is real but mild and localised: an `EditorShell` that forwards fifteen fields and adds a `<section>`, thirteen single-caller one-line forwarders in `storeBridge.ts`, and an entry-editing concern that costs eight files to follow end to end. Neither theme is systemic enough to call the codebase unhealthy — this is a "fix the parse boundary, then thin two seams" report, not a restructuring one.

## 2. Coverage statement

**Read closely** (full file or all significant sections): `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `eslint.config.js`, `vitest.config.ts`, `knip.json`, `vite.config.ts` (build/plugin sections), all four `.github/workflows/*.yml`, `worker/package.json`, `worker/wrangler.toml`, `worker/src/{index,cors,oauthToken}.ts`, `src/types.ts`, `src/store.ts`, `src/storeBridge.ts`, `src/storeCommit.ts`, `src/persistencePort.ts`, `src/fileIO.ts`, `src/wikilinks.ts`, `src/fileOccurrence.ts`, `src/occView.ts`, `src/model/{storeItems,nodeSchema}.ts` + the parse walker in `expansion.ts`, `src/storage/{backend,activeBackend,index,cache,sync,githubOAuth}.ts`, `src/editor/{save,state,useEntryEditor,EditorShell,EntryEditor}.tsx?`, `src/routes/{_app.entry.$slug.tsx,-entryRoute.ts}`, `src/calendar/{useExpandWithMultiday,undatedOccs,UndatedListView,BacklogView,NotesView,viewState,OccurrenceList}.tsx?`, `src/lib/matching.ts`, `src/hooks/index.ts`, `src/onboarding/*`, `src/editor/cm/markdownFormatting.ts` (link/widget path).

**Sampled** (grep/structure/interface level, not line by line): the remaining `src/calendar/*` views, `src/components/*` and `src/components/primitives/*`, `src/search/*`, `src/editor/dialogs/*`, `src/editor/cm/*` beyond the link path, `src/storage/{githubBackend,githubApi,fs,localBackend,exampleBackend,vaultRegistry,notifications}.ts`, `src/model/{collapse,inheritance,repeat,duration,dateUtils,expansionCache,roundTripCheck,storeOps}.ts`, the test suite (mock strategy and file inventory rather than assertions).

**Skipped, with reason:** `src/components/ui/**` (vendored shadcn registry — deliberately excluded from coverage and knip, and `shadcn diff` is the right check for it, not this one); `src/routeTree.gen.ts` (generated); `src/debug/NodeInheritanceDebugger.tsx` (780 lines, developer-only tooling never shipped to users, already lint-exempted for a11y); `blog/`, `public/`, `plans/`, `scripts/process-icon.mjs` (not application code); `pnpm-lock.yaml`.

**Quality gates — all run once, all green:**

| Gate | Command | Result |
|---|---|---|
| Build | `pnpm run build` | ✅ pass (exit 0) |
| Lint | `pnpm run lint` | ✅ pass (exit 0) — **0 errors, 12 warnings** (see finding #7) |
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
| 1 | Architecture & Domain Separation | findings: **#2, #4, #6** — barrel invariants, `model/` purity and port usage all verified clean by grep; the two god modules are the real issue |
| 2 | Simplicity & Overengineering | findings: **#5, #6, #9** |
| 3 | Directory & File Layout | **clean** — co-change analysis over 120 days produced no cross-directory pair above 3 co-occurrences; the root-resident list in CLAUDE.md matches the actual import graph (spot-checked all 12); `-`-prefixed non-route files in `routes/` are correctly placed beside their only consumers |
| 4 | Security | **clean** — threat model and evidence below the table |
| 5 | Testing & Error Handling | findings: **#1, #3** — error *strategy* is otherwise consistent and good (see note below) |
| 6 | Code Health & DRY | findings: **#1, #8** |
| 7 | Toolchain & Developer Feedback Loops | findings: **#5, #7** |
| 8 | Dependencies & Library Fit | **clean** — measured verdicts below the table |
| 9 | Styling & UX | **clean** — 33 inline `style={{}}` uses, all dynamic values Tailwind can't express (measured positions, CSS custom properties, virtualizer transforms); no custom re-implementation of an installed shadcn component; `jsx-a11y/recommended` is enabled and passing with one justified `no-autofocus` disable |
| 10 | Performance | **clean** — React Compiler enabled at target 19, three virtualized lists, route-level `lazy()` on every heavy view, an LRU expansion cache with correct vault-change reset wiring (verified `resetCalendarOnVaultChange` → `resetExpansionCache` is called from `routes/_app.tsx:56`) |

**Category 4 — threat model and why it is clean.** Everything but the OAuth token exchange is client-side: vault bytes live in the browser's IndexedDB (Dexie) and on the user's disk or GitHub repo; the only server is a Cloudflare Worker holding `GITHUB_CLIENT_SECRET`. Untrusted input is (a) vault markdown/YAML, possibly authored by someone else in a shared repo, and (b) the OAuth redirect's query string. Checks run: zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` across `src/`; the one variable `href` is a module constant (`GITHUB_APP_INSTALL_URL`); `LinkWidget.toDOM` uses `textContent` and gates navigation on `/^(https?|mailto):/i.test(this.url)`, so `[x](javascript:…)` in a note body renders inert; `completeGitHubSignIn` validates `state !== storedState` and uses S256 PKCE; the worker never echoes the client secret and gates CORS response-reading on a single origin, with a correct written rationale for why executing the exchange from any origin is safe under PKCE; tokens sit in IndexedDB (appropriate for an offline-first PWA — `sessionStorage` holds only the short-lived verifier). `pnpm audit --audit-level=high` is clean and `pnpm-workspace.yaml` carries documented, CVE-cited overrides plus `minimumReleaseAge: 1440`.

**Category 5 — the error *strategy* is a keep.** `storage/githubBackend.ts` routes every failure through one `mapGitHubError` classifier; `sync.ts` quarantines per-file parse failures and surfaces them via `reportParseFailures` toasts rather than `console.warn` alone. Only three empty `catch` blocks exist repo-wide (`src/store.ts:27`, `src/storage/exampleBackend.ts:446`, `src/onboarding/tourState.ts:8`) and all three wrap `localStorage` access, where swallowing is correct. Findings #1 and #3 are about a gap the strategy doesn't reach, not about the strategy.

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
| 1 | Malformed YAML array elements escape the parse quarantine and crash the whole vault load | **Opus 5** (Sonnet 5 if the round-trip constraint is named in the task) |
| 2 | `types.ts` is a god module: domain types + YAML parse runtime + storage + UI vocabulary, imported by 105 files | **Opus 5 in plan mode, multi-PR** |
| 3 | The durability + credentials layer is mocked out of every test it appears in (3.7% coverage) | **Opus 5** |
| 4 | `storage/cache.ts` holds five unrelated concerns because one lint rule forces them together | **Opus 5** |
| 5 | `strict-type-checked` ships in the installed plugin but isn't enabled; `no-unnecessary-condition` alone flags 81 checks the types already rule out | **Sonnet 5** |
| 6 | Entry editing costs eight files to follow, with `EditorShell` forwarding fifteen fields and adding nothing | **Opus 5** |
| 7 | CI accepts lint warnings silently, and unused-disable reporting is switched off in both blocks | **Haiku 4.5** |
| 8 | `NewEntrySeed` is defined twice, in `routes/` and `editor/`, with divergent types | **Haiku 4.5** |
| 9 | 13 of 19 `storeBridge` exports are single-caller one-line forwarders | **Sonnet 5** |

**Sequencing note.** #1 and #2 both edit `src/types.ts` — land **#1 first** (a surgical change to `parseInlineField` / `extractFileMetadata`), then #2 moves the finished coercion code into `model/` wholesale. #3 and #4 both target `src/storage/cache.ts`: land **#4 first** (splitting the module gives #3 a smaller, mockable-in-isolation surface to write real tests against), otherwise the new tests get rewritten when the split lands. #5 and #1 overlap in `src/types.ts` and `src/editor/save.ts` — run #5 *after* #1, since fixing the coercion changes which conditions the rule considers unnecessary. Everything else is independent.

---

### 1. Malformed YAML array elements escape the parse quarantine and crash the whole vault load

- **Category** `error-handling` `types` `architecture`
- **Impact** 8
- **Breadth** 4 files (`src/types.ts`, `src/fileOccurrence.ts`, `src/wikilinks.ts`, `src/storage/sync.ts`) — search: `grep -rn "Array.isArray(fields" src/types.ts` plus `grep -rl "meta\.items\|metadata\.items\|meta\.tags" src --include=*.ts --include=*.tsx | grep -v test`
- **Recommended model** **Opus 5.** The hazard is that the obvious fix — filter non-string elements out during coercion — silently deletes user data on the next save, which is precisely the bug class the data-integrity survey already fixed with the `extra` bag and `malformedKnownFields`. Any fix must route rejected elements into `extra` so `roundTripLoss` stays silent, and must not perturb `absentFieldValue`, which `collapse.ts` uses to decide whether a key is safe to omit. *If the task explicitly states "coerce per element, and route rejected elements into the `extra` bag so the round-trip stays lossless", **Sonnet 5** is sufficient* — that names the invariant that otherwise fails quietly.
- **Evidence**

  `src/types.ts:349` — the array coercion checks the container, never the elements:
  ```
      tags:  Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
  ```
  `src/types.ts:278` — `boolean` and `priority` are returned verbatim, whatever shape they arrived in:
  ```
      case 'boolean':     return raw === null ? undefined : raw
  ```
  `src/wikilinks.ts:89` — the consumer assumes the type is honest:
  ```
    const m = stored.match(/^\[\[(.+)\]\]$/)
  ```
  `src/storage/sync.ts:75` — the quarantine that is supposed to contain this only wraps `parseToStoreItems`, which succeeds here:
  ```
        failures.push({ path, slug: pathToSlug(path), message })
  ```
  `src/store.ts:161` — the crash site sits outside every `try`:
  ```
        const backlinks = roots === prevRoots ? prevBacklinks : buildBacklinkIndex(roots)
  ```

  **Reproduced this session** with a temporary vitest probe (since deleted). A file containing `items:` / `  - 42` / `  - [[real]]` parses cleanly, then:
  ```
  PARSED root.items = [42,[["real"]]] typeof[0]= number
  buildBacklinkIndex threw: stored.match is not a function
  ```
  A second probe with `tags: [7]`, `done: yes-please`, `priority: urgent` yielded `root.tags = [7]` and `{"done":"yes-please","participants":[],"priority":"urgent"}` — a `string[]` holding a number, a `boolean` holding a string, and a `Priority` union holding a value outside it.
- **Problem** One hand-authored vault file whose `items:` or `tags:` list contains a non-string takes down the entire vault load, bypassing the per-file quarantine that exists specifically to isolate bad files — and the same gap lets `done`/`priority` carry values their declared types forbid, so every downstream `if (priority === 'high')` silently mis-branches instead of failing loudly.
- **Fix** Coerce array elements (`scalarToString` per item) and validate `boolean`/`priority` against their unions inside `parseInlineField`, routing every rejected raw value into the `extra` bag through `malformedKnownFields` so the file still round-trips byte-for-byte on save.

---

### 2. `types.ts` is a god module: domain types, YAML parse runtime, storage refs and UI vocabulary in one 425-line file

- **Category** `architecture` `layout`
- **Impact** 7
- **Breadth** 105 importing files — search: `grep -rl "from '@/types'\|from './types'\|from '\.\./types'" src --include=*.ts --include=*.tsx | wc -l` → 105, of which 25 import runtime *values*, not just types (`grep -rhoE "^import \{[^}]*\} from '(@|\.|\.\.)/types'" src | grep -v "import type" | wc -l` → 25)
- **Recommended model** **Opus 5 in plan mode, for a plan spanning multiple PRs.** This needs a product/architecture decision the user should make, not a mechanical move: `model/` is lint-restricted to importing only `@/types`, `@/fileIO` and `@/wikilinks`, so moving the coercion registry *into* `model/` requires reversing that dependency for six files, and moving it into `fileIO.ts` instead collides with CLAUDE.md's stated scope for that file ("YAML/frontmatter parse+serialize" — arguably the right home, but that is a call to make explicitly). The invariant that fails quietly if this is done piecemeal is the `no-restricted-imports` block in `eslint.config.js`, whose ordering comment already warns that flat config replaces rule options wholesale — a half-move leaves `model/` importing a module it is supposed to be independent of, with lint still green.
- **Evidence** `src/types.ts` declares itself as types (`// ── MERIDIAN DOMAIN TYPES ───`) but line 27 of `eslint.config.js` shows the lint layer treating it as a leaf, while the file itself holds the runtime parse registry:
  ```
  const INLINE_FIELDS: readonly InlineFieldSpec[] = [
    { key: 'title',        kind: 'string',      level: 'file',       required: true },
  ```
  …alongside `deepEqual`, `unknownKeys`, `parseInlineField`, `malformedKnownFields`, `extractFileMetadata`, `extractOccurrenceMetadata`, `scalarToString` — and, unrelated to any of that, `VaultRef`/`GitHubVaultRef` (storage domain), `LocalePrefs` (user prefs), and `OccState` (view styling vocabulary). `vitest.config.ts` already concedes this is logic, not types, by giving it a coverage floor: `'src/types.ts': { statements: 90, branches: 80, functions: 85, lines: 90 },`
- **Problem** CLAUDE.md justifies `types.ts` at root as "domain types used by every layer", but the file is now also the YAML parse runtime — the exact responsibility CLAUDE.md assigns to `model/` — so the domain core's parsing lives outside the domain core, and no lint rule stops it growing further.
- **Fix** Split into `types.ts` (pure type declarations, no runtime), a `model/fieldRegistry.ts` owning `INLINE_FIELDS` + all coercion, and leaf homes for `VaultRef`/`LocalePrefs`/`OccState`; then add an `import-x/no-restricted-paths` zone or a `no-restricted-syntax` rule that keeps runtime exports out of `types.ts` permanently.

---

### 3. The durability and credentials layer is `vi.mock`'d out of every test that touches it

- **Category** `testing`
- **Impact** 7
- **Breadth** 8 files — search: `grep -rl "storage/cache'\|'./cache'" src --include=*.ts --include=*.tsx` → `storage/{index,vaultRegistry,sync,githubOAuth}.ts` and 4 test files, of which `sync.test.ts`, `githubOAuth.test.ts` and `vaultRegistry.test.ts` all replace it with a fake
- **Recommended model** **Opus 5.** The hazard is that a naive "add tests for cache.ts" pass writes them against `fake-indexeddb` and proves nothing, because the semantics that actually matter are the *interactions* the fakes currently paper over: the refcounted in-flight registry versus `planReconcile`'s `status !== 'clean'` guards, and the `dirty: number` ↔ `SyncStatus` mapping whose whole justification is not migrating existing users' caches. Getting those wrong produces green tests over a broken reconcile — a silent failure, which is why this doesn't go down-tier.
- **Evidence** `src/storage/__tests__/sync.test.ts:45`:
  ```
  vi.mock('@/storage/cache', () => {
  ```
  …and the coverage report from this session's `pnpm run test:coverage` run:
  ```
    cache.ts         |    3.73 |        0 |       0 |    4.06 | ...85-240,265-395
  ```
  Zero branch and zero function coverage across a 396-line module that persists every unsynced edit and every GitHub access/refresh token (`export async function tokenSave(vaultId: string, token: string): Promise<void> {`, line 300).
- **Problem** The one module that decides whether an offline edit survives a reload — and where OAuth tokens live — has no real test at all; every sync test asserts against a hand-written in-memory fake whose semantics can drift from Dexie's without a single test going red.
- **Fix** Add a `fake-indexeddb`-backed suite exercising the real Dexie paths (dirty/tombstone lifecycle, `applyRemoteBatch`, in-flight refcounting, token round-trip), and give `cache.ts` a per-file threshold in `vitest.config.ts` so it can't regress.

---

### 4. `storage/cache.ts` holds five unrelated concerns because one lint rule forces them together

- **Category** `architecture` `srp`
- **Impact** 6
- **Breadth** 2 files (`src/storage/cache.ts`, `eslint.config.js`) with 8 downstream importers — search: `grep -c "^export " src/storage/cache.ts` → 32
- **Recommended model** **Opus 5.** The trap is the lint rule itself: `eslint.config.js` names `src/storage/cache.ts` in an `ignores` list for `no-restricted-imports` on `dexie`, so splitting the file without updating that list makes every new module fail lint — and updating it carelessly (e.g. widening to `src/storage/**`) silently dissolves the singleton guarantee the rule exists to enforce, with lint still green. The in-flight registry can move for free (it touches no Dexie), but the token/handle/vault-ref stores cannot.
- **Evidence** `eslint.config.js` scopes Dexie to exactly one file:
  ```
    ignores: ['src/store.ts', 'src/storage/cache.ts', 'src/calendar/viewState.ts'],
  ```
  and the resulting file mixes the file cache with credentials, FS handles, the vault registry, and an in-memory registry that has nothing to do with IndexedDB at all — `src/storage/cache.ts:264`:
  ```
  export function markInFlight(path: string): void {
    _inFlightPaths.set(path, (_inFlightPaths.get(path) ?? 0) + 1)
  }
  ```
- **Problem** A well-intentioned "exactly one file may import dexie" rule has quietly become a "everything persistence-adjacent lives in one 396-line file" rule, so the token store, the FS-handle store, the vault registry and a pure in-memory refcount all share a module — and, per finding #3, share its 3.7% coverage.
- **Fix** Move `markInFlight`/`clearInFlight`/`getInFlightPaths` to their own `storage/inFlight.ts` immediately (no Dexie involved, no lint change needed), then split the Dexie surface into `cache/files.ts`, `cache/credentials.ts` and `cache/registry.ts` behind a shared `cache/db.ts`, and narrow the eslint `ignores` entry to that single `db.ts`.

---

### 5. `strict-type-checked` ships in the installed plugin but isn't enabled — `no-unnecessary-condition` alone flags 81 checks the types already rule out

- **Category** `toolchain` `overengineering`
- **Impact** 6
- **Breadth** 22 non-test files (29 including tests) for the `no-unnecessary-condition` subset — from the dry run below
- **Recommended model** **Sonnet 5.** The hazard is that `no-unnecessary-condition` reports "always truthy" *because the type lies*, not because the check is dead — finding #1 is the proof. Deleting a guard the type wrongly says is redundant re-hides a real bug class, and nothing breaks at build time. Sonnet 5 is sufficient **because the ordering constraint is nameable**: land #1 first, then enable only the three rules named below, and audit each `??`/`||` site against the *runtime* source of the value before deleting it. Enabling the whole preset blind would be an Opus-tier judgment call, which is exactly why the recommendation is a subset.
- **Evidence** `eslint.config.js:27` enables only the recommended tier:
  ```
    ...tsPlugin.configs['flat/recommended-type-checked'][1].rules,
  ```
  Inspection of the *installed* `@typescript-eslint/eslint-plugin@8.65.0` (not assumed from the version number) shows 134 rules available and 27 in `strict-type-checked` beyond `recommended-type-checked`. **Dry run** with a temporary config layering only those 27 rules over the existing config, across `src` + `worker/src` (temp config since deleted):
  ```
  TOTAL errors: 647 across 131 files
  312  @typescript-eslint/no-non-null-assertion
  249  @typescript-eslint/no-confusing-void-expression
   81  @typescript-eslint/no-unnecessary-condition
    2  @typescript-eslint/use-unknown-in-catch-callback-variable
    1  @typescript-eslint/no-deprecated
    1  @typescript-eslint/no-unnecessary-type-conversion
    1  @typescript-eslint/no-unnecessary-boolean-literal-compare
  ```
  The two large counts are noise for this codebase's idioms (`m[1]!` after a regex match; `onClick={() => setX()}`). The valuable signal is concentrated: `src/editor/save.ts` (14), `src/debug/NodeInheritanceDebugger.tsx` (10), `src/editor/ItemsList.tsx` (7), `src/model/expansion.ts` (7), `src/model/storeOps.ts` (5) — plus `src/calendar/agendaSections.ts:339` flagged as *"the types have no overlap"* (a condition that can never be true) and `src/editor/EntryBody.tsx:21` on `MutableRefObject is deprecated. Use RefObject instead`.
- **Problem** An installed, already-paid-for lint tier that would mechanically catch a whole class of defensive-code-for-impossible-states — and one genuinely unreachable condition — is switched off, while the same codebase writes `m.title || ''` against a field typed `string` in dozens of places because the author (correctly, per finding #1) doesn't trust the type.
- **Fix** After landing #1, enable exactly `no-unnecessary-condition`, `no-deprecated` and `use-unknown-in-catch-callback-variable` (leaving `no-non-null-assertion` and `no-confusing-void-expression` off, with a comment saying why), and fix the ~20 files they flag.

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

### 7. CI accepts lint warnings silently, and unused-disable reporting is switched off in both config blocks

- **Category** `toolchain`
- **Impact** 4
- **Breadth** 3 files (`package.json`, `eslint.config.js`, `.github/workflows/build.yml`)
- **Recommended model** **Haiku 4.5.** The only trap is that adding `--max-warnings=0` outright turns 12 currently-passing warnings into a red build, so the change must be `--max-warnings=12` (a ratchet) or the 12 must be resolved first — and either way the failure is loud and immediate at CI time, never silent. That makes it safe to hand down-tier.
- **Evidence** `package.json:14`:
  ```
      "lint": "eslint src worker/src",
  ```
  No `--max-warnings`, and `.github/workflows/build.yml` runs it bare (`- run: pnpm run lint`), so this session's run exited 0 with `✖ 12 problems (0 errors, 12 warnings)`. Separately, `eslint.config.js` disables unused-directive reporting in *both* config blocks (lines 45 and 218):
  ```
        reportUnusedDisableDirectives: false,
  ```
  A dry run with `--report-unused-disable-directives` found none today across the 7 files carrying disables — so this is a rot-prevention gap, not existing rot.
- **Problem** Warnings are invisible to CI, so a new one lands with a green check and joins the existing 12 in the noise floor; and `eslint-disable` comments can go stale indefinitely without anything noticing.
- **Fix** Add `--max-warnings=12` to the lint script as a ratchet (lowering it as warnings are resolved) and flip `reportUnusedDisableDirectives` to `'error'` in both blocks.

---

### 8. `NewEntrySeed` is defined twice, in `routes/` and `editor/`, with divergent types

- **Category** `dry` `types` `naming`
- **Impact** 3
- **Breadth** 2 files — search: `grep -rn "NewEntrySeed" src --include=*.ts --include=*.tsx`
- **Recommended model** **Haiku 4.5.** The one thing to get right is import direction: `editor/` may import `@/routes` (it already does, for `newEntryRoute`), but `routes/` importing `@/editor` would risk the cycle the `vite.config.ts` `CYCLIC_CROSS_CHUNK_REEXPORT` guard throws on. Name that direction in the task and the fix is mechanical, with a build failure as the safety net if it's wrong.
- **Evidence** `src/routes/-entryRoute.ts:7`:
  ```
    itemType?: 'task' | 'event' | 'note'
  ```
  versus `src/editor/useEntryEditor.ts:22`, the same four fields with `itemType?: ItemType` — where `ItemType` is that identical literal union, declared a third time in `src/editor/state.ts:4`.
- **Problem** One concept (the seed values for a brand-new entry) has two independent declarations across a module boundary, so adding a seed field silently only reaches half the call path and the literal union is spelled out twice instead of referencing `ItemType`.
- **Fix** Delete the `routes/` copy, import `NewEntrySeed` from `@/editor`, and have `editor/useEntryEditor.ts` reference `ItemType` from `./state` rather than restating the union.

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
