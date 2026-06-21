## Next steps

- Investigate conflicts in spite of single user
- Add participants combobox
- Convert duration into end date/time
- Update Tutorial vault with new features and 'Every item is a list' paradigm
- Add Solarized Light theme
- Investigate more secure storage options

# Meridian — Code Health Survey

## Health Verdict

Meridian is a **healthy, carefully-maintained codebase** — strong typing (one `any` in app code), zero `dangerouslySetInnerHTML`, a well-factored styling layer (`occurrence-variants.ts` with shared `TINT_CLASSES`), and genuinely good module-level documentation. Many findings from prior surveys have already been _fixed_ (the `cache.ts` init race now has a promise guard, `reconcileWithBackend` correctly skips dirty entries so the old data-loss bug is gone, `notify()` now delegates to sonner, the dead spread in `storeOps` is removed). The two weakest subsystems are the **`storage/github*` layer** (an unbounded secondary-rate-limit retry loop that can hang sync forever, and a permission check that only proves read access) and the **`editor/cm` body-decoration layer** (four CodeMirror plugins silently coordinate over disjoint document ranges with task-detection logic duplicated across two of them). The single biggest _structural_ theme is a **testing/observability gap**: all automated tests live in `model/` and `storage/`, while the entire `editor/`, `calendar/`, and `components/` UI — including the fragile decoration code that caused most recent bugs — has **zero tests**.

## Coverage Statement

- **Examined closely:** `package.json`, `types.ts`, `store.ts`, `storeBridge.ts`, `presentation.ts`, all of `storage/` (sync, githubBackend, githubApi, localBackend, fs, vaultRegistry, cache), `editor/` core (EditorShell, DialogStack, EntryBody, useEntryEditor, cm/taskDecorations, cm/markdownFormatting), `routes/__root` + `_app`, `components/OccurrenceCard`, `components/ui/occurrence-variants`. Repo-wide greps for `any`, `dangerouslySetInnerHTML`, inline styles, import conventions, lazy/Suspense, tests, error-string duplication.
- **Sampled only:** `model/expansion.ts` (614 lines, exports + key sections), `model/storeOps.ts`, `editor/dialogs/RepeatDialog.tsx` (559), `calendar/*`, `components/ui/*` shadcn primitives (vendored), `vaults/ManageVaultsDialog`, `search/*`, `onboarding/CoachTour`.
- **Skipped:** `components/ui/sidebar.tsx` (771 lines, generated shadcn), `debug/NodeInheritanceDebugger.tsx` (776 lines, separate dev entry, not imported by the app).
- **Fraction:** ~55–65% of `src` read directly; the rest grep-sampled.
- **Unverified:** (a) `model/expansion.ts` internals (614 lines — possible god file / SRP issues not fully audited); (b) `RepeatDialog.tsx` recurrence logic; (c) whether `debug/` is actually excluded from the production Vite build (assumed separate-entry, did not read `vite.config`).

## Findings

### 1. GitHub secondary-rate-limit handler retries forever

- **Category:** `error-handling`
- **Impact:** 6 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `src/storage/githubApi.ts:16-19` — `onSecondaryRateLimit: (...) => { console.warn(...); return true }`, vs `onRateLimit` above which caps at `retryCount < 2`.
- **Problem:** The secondary (abuse-detection) handler unconditionally returns `true`, so Octokit retries indefinitely; `runSync` never resolves and the user sees a permanently frozen sync spinner with no error.
- **Fix:** Return `retryCount < 2` (or similar cap) to bound retries and surface a failure after exhaustion.

### 4. `listedOn` re-implements `backlinksTo` — divergent matching, recomputed per card

- **Category:** `dry` `performance`
- **Impact:** 4 · **Breadth:** 2 implementations, runs per agenda card · **Fix effort:** M
- **Evidence:** `OccurrenceCard.tsx:76-78` does `Array.from(roots.entries()).filter(([,meta]) => meta.items.includes(\`[[${occ.fileSlug}]]\`))`inline & unmemoized, while`presentation.ts:182 backlinksTo`computes the same concept using`resolveWikilink(unwrapRef(raw), roots)`.
- **Problem:** Two "files that list this slug" implementations that disagree (naive string-includes vs. proper wikilink resolution), and the card version runs O(roots) inside render for every card in the agenda.
- **Fix:** Route both through one memoized `backlinksTo`/`listedOn` helper.

### 5. GitHub `ensurePermission` only proves read access

- **Category:** `error-handling` `ux`
- **Impact:** 4 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `githubBackend.ts:144-154` — `GET /repos/{owner}/{repo}` then `return 'granted'`; succeeds for a read-only token and never checks the configured branch.
- **Problem:** A read-scoped or wrong-branch token reports success at connect time, then the first `write()` during sync fails later with a confusing "Sync failed."
- **Fix:** Probe write capability (e.g. check `permissions.push` from the repo response, or verify the branch ref) before returning `'granted'`.

### 6. Editor handler prop-drilling through three layers

- **Category:** `architecture` `dry`
- **Impact:** 3 · **Breadth:** 3 files · **Fix effort:** M
- **Evidence:** `useEntryEditor.ts:121-143` returns 21 keys; `EditorShell.tsx:24-37` destructures ~18; `DialogStack.tsx:14-31` re-declares 16 of them as a props interface.
- **Problem:** Adding one dialog field means touching the hook return, `EditorShell`, the `DialogStack` props interface, and the callsite — four edits for one wire.
- **Fix:** Pass the `hooks` object (or a grouped `dialogHandlers`) straight through instead of spreading each callback by hand.

### 7. Mixed import conventions — `@/` alias vs relative `../`, often in the same file

- **Category:** `naming` `layout`
- **Impact:** 2 · **Breadth:** ~40 files (89 `@/` imports vs many relative) · **Fix effort:** S (codemod/lint)
- **Evidence:** `routes/_app.tsx:11-17` mixes `import EntryOverlay from '@/editor/EntryOverlay'` with `import { Button } from '../components/ui/button'` in adjacent lines.
- **Problem:** No consistent path convention across the codebase makes imports noisy and moves harder to reason about.
- **Fix:** Pick one (the `@/` alias) and add an ESLint `no-restricted-imports`/`import/no-relative-parent-imports` rule to enforce it.

### 8. Core generic types live in deep `model/expansion.ts` but are imported upward by top-level `types.ts`

- **Category:** `architecture` `layout`
- **Impact:** 3 · **Breadth:** `types.ts` + every `Occurrence`/`StoreItem` consumer · **Fix effort:** M
- **Evidence:** `types.ts:57` — `import type { OccurrenceEntry, RepeatPattern } from './model/expansion'`; these interfaces are defined at `expansion.ts:404` and `:419`, a 614-line module that also holds heavy expansion logic.
- **Problem:** Foundational, broadly-used type definitions sit inside a deeply-nested, heavyweight implementation file — a depth mismatch that forces the top-level types module to depend downward into `model/`.
- **Fix:** Move `OccurrenceEntry`/`RepeatPattern` into `types.ts` (or a `model/types.ts`) and have `expansion.ts` import them.

### 9. `reconcileWithBackend` re-parses the entire cache on every change

- **Category:** `performance`
- **Impact:** 3 · **Breadth:** 1 file (hot path) · **Fix effort:** M
- **Evidence:** `sync.ts:159` — after pulling `changed`, it calls `parseFiles(Array.from(cacheMap.values()))` over **all** cached files, then `setData` replaces the whole store, even when one file changed.
- **Problem:** Every sync tick that touches a single file re-parses and re-expands the full vault, which scales poorly as vaults grow.
- **Fix:** Parse only the changed/deleted slugs and merge into existing `items`/`roots` rather than rebuilding from scratch.

### 10. Error-string formatting duplicated across the storage layer

- **Category:** `dry` `error-handling`
- **Impact:** 2 · **Breadth:** ~8 callsites · **Fix effort:** S
- **Evidence:** `sync.ts:225,264,278`, `vaultRegistry.ts` (×4), `ManageVaultsDialog.tsx` — `notify('Sync failed: ' + ((e as Error).message || (e as Error).name))`; the `(e as Error).message || .name` idiom is copy-pasted everywhere errors surface.
- **Problem:** The same unsafe cast + fallback formatting is repeated, so any change to error presentation must be made in eight places.
- **Fix:** A single `notifyError(prefix, e)` helper that owns the formatting.

### 11. No route- or feature-level code-splitting

- **Category:** `performance`
- **Impact:** 3 · **Breadth:** all routes · **Fix effort:** M
- **Evidence:** `grep "lazy(\|Suspense"` → `0`; `EntryOverlay`, the full CM6 editor + all dialogs, and the calendar views are statically imported into the initial bundle (`_app.tsx:11`).
- **Problem:** The CodeMirror editor stack (a large dependency) and the dialog tree load on first paint even though the editor opens only on demand.
- **Fix:** Lazy-load `EntryOverlay`/editor and calendar route components behind `React.lazy` + `Suspense`.

### 12. Subdirectory files are silently ignored by both backends

- **Category:** `error-handling` `ux`
- **Impact:** 3 · **Breadth:** 2 files · **Fix effort:** M
- **Evidence:** `githubBackend.ts:52` requests `path: ''` (repo root only) and keys by `item.name`; `fs.ts:43` iterates only `dh.entries()` (no recursion). _Note: consistent across both backends — the prior survey's "GitHub diverges from local" framing is inaccurate; both are flat-by-design._
- **Problem:** Any `.md`/`.yaml` in a subfolder never appears in `statAll`, is never cached, and vanishes from the UI with no error.
- **Fix:** Recurse directories (FS) / use the Git Trees API `recursive=1` (GitHub) and key by full path, or explicitly validate flat-vault-only.

### 13. `presentation.ts` duplicates its 3-step occurrence-fill logic

- **Category:** `dry`
- **Impact:** 3 · **Breadth:** 2 functions in 1 file · **Fix effort:** M
- **Evidence:** `fileOccurrenceMap` (`presentation.ts:89-136`) and `computeSlugOccurrence` (`:138-167`) implement the identical "expand-forward → expand-back → standalone fallback → series-anchor fallback" sequence.
- **Problem:** The batch and single-slug variants must be kept in lockstep by hand; a fix to the fill ordering in one can silently diverge from the other.
- **Fix:** Express `computeSlugOccurrence` in terms of a shared per-slug primitive that `fileOccurrenceMap` also calls.

### 14. Arbitrary pixel values bypass the Tailwind scale across card components

- **Category:** `styling`
- **Impact:** 2 · **Breadth:** ~5 files · **Fix effort:** M
- **Evidence:** `OccurrenceCard.tsx:39,46,100,144` — `text-[14px]`, `gap-[9px]`, `pl-[8px] pr-[14px] py-[8px]`, `text-[11px]`, `text-[9px]` scattered as one-off arbitrary values (also in `OccurrenceRow`, `DayView`).
- **Problem:** Spacing/typography are hardcoded per-component rather than drawn from the Tailwind scale or design tokens, so visual consistency is manual and drift-prone.
- **Fix:** Map these to the nearest scale steps or define semantic tokens (e.g. `text-card-title`, `gap-card`).

### 15. Storage layer reaches into UI state via mutable global singletons

- **Category:** `architecture`
- **Impact:** 3 · **Breadth:** `sync.ts`, `vaultRegistry.ts` · **Fix effort:** L
- **Evidence:** `sync.ts:15` imports `getItems, getRoots, setData, notify, setSyncDirtyCount, setSyncError` from `storeBridge` and calls `setData`/`notify` directly inside sync logic.
- **Problem:** The data/sync domain is coupled to the UI store and toast system through a global bridge, so storage can't be exercised or reused without the Zustand store and sonner present.
- **Fix:** Have sync functions return results/events and let a thin app-layer adapter push them into the store, rather than the storage layer writing UI state itself.

### 16. `any` and unchecked casts at the cache/persistence boundary

- **Category:** `types`
- **Impact:** 2 · **Breadth:** ~6 callsites · **Fix effort:** S
- **Evidence:** `cache.ts:25` `value: any` on `MetaRecord`, then unchecked reads like `record?.value as FileSystemDirectoryHandle` (`cache.ts:143`), `as VaultRef[]` (`:184`), `store.ts:75` `parsed as string[]`.
- **Problem:** Everything read back from IndexedDB/localStorage is cast without validation, so a corrupted or schema-drifted record fails at an arbitrary later point instead of at the boundary.
- **Fix:** Give `MetaRecord` a discriminated value type (or per-key typed accessors) and validate on read.

---

## Notes on prior-survey findings

- **Already fixed (excluded):** `vault.ts:77` data-loss, `cache.ts:47` init race, `storeBridge` notify timer, `storeOps:146` dead spread.
- **Overstated (see #12):** the "GitHub keys by name not path / diverges from local" finding — both backends are flat by design, so it's a consistent limitation, not an inter-backend divergence.

_Stopped at 16 — remaining candidates are single-callsite or lint-level; padding to 20 would dilute the signal._

# Codebase Health Survey

Survey this codebase for code health issues across the categories below.

**Before you start**, state your scan plan, then at the end report what you actually covered. I need to trust the verdict, which means knowing what you _didn't_ look at.

## Output structure

### 1. Health verdict (write this first, ~5 sentences)

A plain-language summary of the repo's overall health. Name the **worst one or two areas** (by directory or subsystem, e.g. "the `auth/` layer" — not individual findings) and the **single biggest structural theme** running through the findings. This is the headline answer; the list below is the supporting evidence.

### 2. Coverage statement

- Which directories/files you examined, and which you deliberately skipped or only sampled (with the reason: irrelevant, generated, vendored, too large, ran out of budget, etc.).
- Roughly what fraction of the codebase this report is based on.
- Any area you suspect has issues but did not have budget to investigate — flag it as "unverified."

### 3. Findings

For each finding, output:

- **Title** — short label
- **Category** — one or more tags from: `architecture` `layout` `dry` `srp` `dead-code` `types` `error-handling` `styling` `ux` `performance` `security` `dependencies` `naming`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = e.g. a DRY violation duplicated across ~4 files, or a missing error state on a primary user flow; 1 = trivial/cosmetic)
- **Breadth** — number of files (or callsites) affected; cite a count, not an adjective
- **Fix effort** — S / M / L (S = localized edit; M = touches a few files or needs a small refactor; L = structural change across the codebase)
- **Evidence** — at least one specific file path + line number or code snippet
- **Problem** — one sentence: what is wrong and why it matters
- **Fix** — one sentence: what the concrete fix looks like

Rank findings by a rough `(impact × breadth) ÷ effort` intuition — but report Impact, Breadth, and Fix effort as the separate fields above rather than collapsing them into one number, so the reader can re-sort by what they care about.

**Strongly prefer systemic and structural issues over isolated, line-level ones.** A finding that affects 10 files beats one that affects 1 function. Cite real code — no generic observations.

List the **top 20 findings**. Include all findings that make the top 20 regardless of their impact score — if a 1/10 ranks in (high breadth, trivial fix), include it and let its low Impact score speak for itself.

Do not pad to reach 20 — if fewer than 20 clear issues exist, stop there.

---

## Categories to scan — ranked by priority

The category ranking is a tiebreaker, not a filter. A serious finding in any category always outranks a minor finding in a higher-priority category — never omit a high-impact issue because its category ranks lower.

### 1. Architecture & Domain Separation _(highest weight — prefer findings here)_

- Domain leakage — logic belonging to one domain (auth, billing, data-fetching, UI state) leaking into another layer or domain
- Wrong abstraction level — a component or module that owns too many concerns, or a concern split across too many files with no clear owner
- Missing or misplaced boundaries — absence of a clear API surface between subsystems (e.g., feature modules that import directly from each other's internals)
- Circular or upward dependencies — lower-level modules importing from higher-level ones
- God files — single files accumulating logic from unrelated domains

### 2. Directory & File Layout _(high weight)_

- Co-location violations — files that always change together but live far apart; or files co-located that have no logical relationship
- Depth mismatch — a module's position in the directory tree should reflect its dependency footprint: broadly used or broadly dependent code belongs at a higher level (e.g. `lib/`, `shared/`, or a feature root), while code with a single consumer or a single dependency should live within or directly beside that consumer's subdirectory; flag modules that are either too shallow for how narrowly they're used, or too deeply nested for how widely they're shared
- Inconsistent module conventions — some features use `feature/index.ts` barrel exports, others do not; or naming conventions differ across domains without reason
- Layout that fights the framework — e.g., route files that aren't co-located with their route, server-only code inside `components/`, shared utilities scattered across feature folders
- Flat directories that should be split, or deeply nested directories that should be flattened

### 3. Security

- XSS vectors: `dangerouslySetInnerHTML`, unescaped user input rendered as HTML
- Sensitive values hardcoded or exposed to the client bundle
- Security-relevant logic only enforced client-side

### 4. Code Health & DRY

- DRY violations — duplicated logic that should be a shared utility or hook, especially across feature boundaries
- SRP violations — functions/components doing too many unrelated things
- Overly defensive coding — checking for the same risks in multiple layers without a clear strategy
- Naming — misleading, ambiguous, or inconsistent names across a module boundary (e.g. the same concept called different things in different layers, or a name that no longer reflects what the code does)
- Dead code — unreachable paths, unused exports, or unused imports at module boundaries (not just individual variables)
- Type safety — pervasive use of `any`, missing return types on public API surfaces, unsafe casts

### 5. Styling & UX

- Shadcn component available but bypassed in favour of a custom re-implementation
- Raw CSS / inline styles where Tailwind classes would suffice, or Tailwind used where plain CSS is clearly better
- UX anti-patterns: missing loading/error states, non-accessible interactive elements (no keyboard nav, missing ARIA)

### 6. Performance

- React anti-patterns: object/array literals in JSX props, missing `useMemo`/`useCallback`/`memo` at component boundaries (not fine-grained)
- Missing lazy-loading / code-splitting at route or feature boundaries
- N+1 or waterfall data fetching patterns

### 7. Dependencies & Maintainability

- Significantly outdated or abandoned dependencies
- Functionality duplicated across two libraries

---

**Scoring guidance:** A finding that reveals a structural pattern affecting the whole codebase (e.g., "every feature imports from `lib/` internals instead of going through a public API") scores higher than a finding about a single misused hook. Skip findings that are purely stylistic or affect a single isolated callsite — they belong in a lint rule, not a health report.

If you find a significant issue in a category not listed above, include it.
