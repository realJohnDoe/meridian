## Next steps

- Fix font / occurrence size in month view on large screens
- Investigate conflicts in spite of single user
- Convert duration into end date/time
- Add filter by participants in side bar
- Update Tutorial vault with new features and 'Every item is a list' paradigm
- Investigate how to change EntryEditor: Own endpoint / Top bar visible
- Add nice readme
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
