## Next steps

- Fix build warnings while keeping hexagonal architecture intact
- Fix linter findings
- Check for react antipatterns / linter
- Fix contrast in mobile month view texts
- Show multiday events as bars spanning multiple days in month view
- Investigate more secure storage options
- Consider if name and logo are still good
- Post about Meridian in Obsidian forums
- Add vault retention period

# Meridian — Code Health Survey

### 5. GitHub personal access token stored in plaintext IndexedDB

- **Category:** `security`
- **Impact:** 5
- **Breadth:** `cache.ts` (`tokenSave`/`tokenLoad`) + `vaultRegistry.ts` (4 sites)
- **Fix effort:** M
- **Evidence:** `cache.ts:153` `tokenSave` writes the raw token to the Dexie `meta` table; `vaultRegistry.ts:111,148` read it back into `GitHubBackend`.
- **Problem:** The fine-grained PAT (repo write scope) sits unencrypted in IndexedDB, so any XSS or malicious dependency in this client-only PWA can exfiltrate a credential that can rewrite the user's repo. The UI hygiene is good (`type="password"`, `autoComplete="off"`) but storage is not.
- **Fix:** Wrap the token with a non-extractable WebCrypto key before persisting (the app already targets environments with full WebCrypto support per `vite.config.ts`), or at minimum document the trust boundary explicitly and scope guidance toward read-only tokens where possible.

# Code Health Report: Meridian

## Health verdict

This is a healthy, well-disciplined codebase — genuinely above average. The architecture rules in `CLAUDE.md` are real and machine-enforced: import boundaries are linted (barrels + `no-restricted-paths`), `model/` is a clean dependency-free domain core, the storage layer is properly abstracted behind a `StorageBackend` interface and a `persistencePort`, and routes are code-split with Suspense. There are zero `any` types, zero `dangerouslySetInnerHTML`, and no hardcoded secrets in app code.

The weakest areas are `store.ts` + `components/SettingsDialog.tsx` (where per-vault `localStorage` persistence is hand-rolled, duplicated across slices, and re-implemented a second time inside `SettingsDialog` so the same storage key has two independent owners) and the scattering of small domain primitives (duration parsing, midnight-truncation, the "is-tracked" check) that have no single home. The single biggest structural theme is **fragmented domain logic: low-level concepts that should each have one owner are open-coded inline across many files**.

## Coverage

- **Examined closely (~55–60% of non-generated, non-test source):** `eslint.config.js`, all 9 barrel `index.ts` files, `store.ts`, `storeOps.ts`, `persistencePort.ts`, `vaultActions.ts`, `storage/backend.ts` + `localBackend.ts` + `activeBackend.ts`, `format.ts`, `model/duration.ts`, `occView.ts`, `fileOccurrence.ts` (partial), all 7 `editor/dialogs/*`, `components/ui/responsive-modal.tsx`, `components/SettingsDialog.tsx` (partial), route files. Repo-wide greps for `any`, XSS vectors, `localStorage`, duration parsers, `setHours`, `done !== undefined`, empty catches, TODO markers.
- **Sampled only (headers/greps):** `model/expansion.ts` (579 lines), `calendar/` view internals, `editor/cm/*`, `storage/sync.ts` + `githubBackend.ts`.
- **Deliberately skipped:** `components/ui/**` (shadcn/generated), `debug/NodeInheritanceDebugger.tsx` (769 lines, separate `debug.html` entry, not in app bundle), all `__tests__`, `routeTree.gen.ts` (generated).
- **Unverified — flag for follow-up:** `model/expansion.ts` (recurrence expansion) and `storage/sync.ts` (conflict/collision sync) carry the most algorithmic complexity and were not traced; if correctness bugs exist, they are most likely there.

## Findings

| #   | Title                                                        | Category          | Impact | Breadth                 | Effort |
| --- | ------------------------------------------------------------ | ----------------- | :----: | ----------------------- | :----: |
| 1   | Per-vault `localStorage` persistence duplicated + dual-owned | dry, architecture |   6    | ~5 files / 9 sites      |   M    |
| 2   | Manual midnight-truncation reimplemented 23×                 | dry               |   3    | 23 callsites / 10 files |   S    |
| 3   | Duration-string parsing fragmented, disagreeing grammars     | dry, architecture |   5    | 2 parsers / ~8 files    |   M    |
| 4   | `SettingsDialog.tsx` god-component                           | srp, layout       |   4    | 1 file (539 lines)      |   L    |
| 5   | `ResponsiveModal` abstraction inconsistently applied         | dry, styling      |   3    | 3 dialog files          |   M    |
| 6   | "Is-tracked" check open-coded as `done !== undefined`        | dry, naming       |   2    | 6 callsites             |   S    |
| 7   | "Reset state on open" effect copy-pasted across dialogs      | dry               |   2    | ~5 dialogs              |   S    |
| 8   | `CLAUDE.md` references renamed file (`occState.ts`)          | naming            |   1    | 1 doc line              |   S    |

---

### 6. "Is-tracked task" check open-coded as `metadata.done !== undefined`

- **Category:** dry, naming
- **Impact:** 2 — **Breadth:** 6 callsites — **Fix effort:** S
- **Evidence:** `done !== undefined` appears in `calendar/DayView.tsx:99`, `components/KindIcon.tsx:22`, `components/OccurrenceCard.tsx:110`, `editor/save.ts:74`, and twice in `occView.ts:7` — with no named predicate, even though `occView.ts` already exports `occKind`/`occState`.
- **Problem:** A domain concept ("this occurrence is a tracked task") is expressed via a magic comparison repeated across layers, obscuring intent and inviting inconsistent variants.
- **Fix:** Add `isTracked(occ)` to `occView.ts` and replace the six callsites.

### 7. "Reset local state when dialog opens" effect copy-pasted across dialogs

- **Category:** dry
- **Impact:** 2 — **Breadth:** ~5 dialogs — **Fix effort:** S
- **Evidence:** `useEffect(() => { if (open) setX(...) }, [open, ...])` recurs in `PriorityDrawer.tsx:36`, `TimePickerDialog.tsx:32`, `DatePickerDialog.tsx:40`, `DurationDialog.tsx:126`, `RepeatDialog.tsx:247` — three of them needing an `eslint-disable exhaustive-deps`.
- **Problem:** The same controlled-dialog reset pattern is duplicated, and several copies suppress the deps lint, masking real dependency mistakes.
- **Fix:** Extract a `useResetOnOpen(open, value, setter)` hook (or a `seed` prop) so the reset logic and its deps live in one place.

### 8. `CLAUDE.md` directory doc references a renamed file (`occState.ts` → `occView.ts`)

- **Category:** naming, dead-code
- **Impact:** 1 — **Breadth:** 1 doc line (the file is imported as `@/occView` in 6 files) — **Fix effort:** S
- **Evidence:** `CLAUDE.md:66` lists "`format.ts`, `fileOccurrence.ts`, `occState.ts`" as the root view-model helpers, but no `occState.ts` exists — the file is `occView.ts` (it exports `occState` as a _function_).
- **Problem:** The architecture doc that agents and contributors rely on names a file that doesn't exist, eroding trust in the (otherwise accurate) doc.
- **Fix:** Update the line to `occView.ts`.

---

## What was NOT found (clean signals)

No `any`, no XSS sinks, no client-exposed secrets, no circular/upward imports past the lint-sanctioned feature mesh, no missing route code-splitting, and loading/skeleton states are present on the primary flows. The 15 empty `catch {}` blocks are intentional `localStorage`/`JSON.parse` guards, not swallowed errors.

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

List the **top 10 findings**. Include all findings that make the top 10 regardless of their impact score — if a 1/10 ranks in (high breadth, trivial fix), include it and let its low Impact score speak for itself.

Do not pad to reach 10 — if fewer than 10 clear issues exist, stop there.

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
