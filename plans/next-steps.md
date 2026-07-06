## Next steps

- Maybe use a dark on-primary color in dark themes to ensure visibility on yellow bg
- Fix contrast in mobile month view texts
- Fix metadata dropdown look
- Show multiday events as bars spanning multiple days in month view
- Show +X in Month view only if space is not enough, not always after 3
- Add border around wikilink chips in light themes in agenda/items/filter overlay section
- Day view does not use localized times
- Check if all clickable components are at least 44x44 px
- Investigate split second hang when toggling tasks
- Turn day view into buttons like in Google Calendar
- Consider if name and logo are still good
- Post about Meridian in Obsidian forums
- Add vault retention period

## Recommend Linters from Fable

1. Enable the react-hooks v7 recommended preset (zero new dependencies)
   You have eslint-plugin-react-hooks 7.1.1 installed, which ships the React Compiler's diagnostics as lint rules — but eslint.config.js:33 enables only the two classic rules (rules-of-hooks, exhaustive-deps). Switching to reactHooks.configs['recommended-latest'].rules activates purity, refs, set-state-in-effect, set-state-in-render, immutability, preserve-manual-memoization, and friends.
   I dry-ran that preset on your codebase (via a temp config, deleted afterwards): 39 findings in 19 files, and the distribution is informative:
   24 × react-hooks/refs — 18 of them in useExpandWithMultiday.ts, which mutates cacheRef.current during render. That's your deliberate expansion-cache pattern, but it's exactly the pattern that breaks under the React Compiler and concurrent rendering. The remaining 6 are scattered ref-during-render reads worth individual review.
   12 × react-hooks/set-state-in-effect — synchronous setState in effect bodies (e.g. CoachTour.tsx:71), which cause cascading double-renders. For someone who cares about performance, this rule alone pays for the effort — these are real wasted render passes, mostly in editor/dialogs/.
   2 × purity, 1 × incompatible-library.
   Practical rollout: enable the preset at warn severity first, fix the 12 set-state-in-effect hits and the stray refs ones, and make a deliberate decision about useExpandWithMultiday — either refactor the cache to a compiler-safe shape or add one targeted disable with a comment. Conveniently, that file is the same one flagged in the health report (React hook inside model/), so one refactor addresses both.
   The strategic payoff: once this preset is clean, you're React Compiler–ready — the lint preset is literally the compiler's own analysis. Adopting babel-plugin-react-compiler in Vite then gets you automatic memoization, which replaces most manual useMemo/useCallback work across calendar/ and editor/.

2. Worth adding: @eslint-react/eslint-plugin
   Modern, TypeScript-aware, flat-config-native (the successor to legacy eslint-plugin-react for setups like yours). The rules that fit your priorities:
   no-leaked-conditional-rendering (type-aware) — catches {count && <X/>} rendering a literal 0
   no-unstable-context-value / no-unstable-default-props — re-render churn from inline objects
   no-array-index-key — would flag e.g. the key={${o.fileSlug}-${o.date}-${i}} in DayView.tsx:81
   the hooks-extra group: no-unnecessary-use-memo / no-unnecessary-use-callback
   Not worth it
   eslint-plugin-react-perf — largely obsoleted by the compiler rules above, and noisy.
   Legacy eslint-plugin-react — mostly redundant given TypeScript + the two above.
   eslint-plugin-jsx-a11y — only if accessibility becomes a goal; you already hand-write aria-labels consistently, so it would mostly confirm what you do.
   My suggested order: preset first (it's free and its findings are the most substantive), fix the ~21 non-cache findings, decide on the expansion cache, then add @eslint-react in a second pass. Want me to wire up the preset at warn and triage the findings?

## From the Cloudflare auth flow

- Got an error message, but on second try, it worked.
- No dedup against already-connected repos. The picker shows all installed repos, including ones already connected as a vault. If the user picks a repo they've already connected, addGitHubVaultOAuth creates a second, duplicate VaultRef pointing at the same repo — confusing, not destructive, but not great.
- Re-doing the full OAuth redirect is heavier than it needs to be. Adding a second vault currently means going through the whole GitHub consent screen again, even though we already hold a valid access token from the first sign-in. A nicer flow would skip straight to the repo picker using the existing token, only falling back to a real redirect if there's no valid session yet.

# Meridian code health report

## 1. Health verdict

This is a disciplined, well-above-average codebase: import boundaries are actually enforced by lint (not just documented), there is essentially zero `any`, the OAuth flow is done properly (PKCE + state + server-side secret in the worker), routes are code-split, and the domain core in `model/` is genuinely pure and well-tested — with one exception noted below. The two weakest areas are the **architecture documentation (CLAUDE.md), which has drifted from the code it governs**, and the **root-level view-model helper layer (`occView.ts`, `format.ts`, plus the expansion cache hook), which contains the most branch-heavy pure logic in the app with zero test coverage**. The biggest structural theme is _convention decay at the root_: the "cross-cutting root residents" rule is eroding — the documented list names a file that no longer exists, files sit at root with a single consumer directory, and `model/` purity has its first React leak. None of this is rot; it's early-stage drift in an otherwise well-defended architecture, and almost all of it is cheap to fix.

## 2. Coverage statement

**Read closely (~35 files, ~40% of hand-written source lines):** entry points (`src/main.tsx`, `src/routes/__root.tsx`, `src/routes/_app.tsx`, `src/debug/main.tsx`); all root residents (`types.ts`, `store.ts`, `occurrenceActions.ts`, `storeCommit.ts`, `occView.ts`, `format.ts`, `fileOccurrence.ts`); `model/` (expansion, storeOps, useExpandWithMultiday, index); `storage/` (sync, vaultRegistry, githubOAuth); `editor/` (save, ItemsList, RepeatDialog, useEntryEditor — partial for the large ones); `calendar/` (DayView); `components/` (OccurrenceCard); `hooks/` (useCalendarFilter); `search/` (SearchResults); `onboarding/` (tourState); `worker/` (index); `lib/` (vaultStorage); `eslint.config.js`; all 14 test files by name, 4 by content.

**Sampled via greps and heads:** remaining routes, debug/NodeInheritanceDebugger (head only), storeItems, the import graph of every root file (measured, not guessed), `any`/catch/XSS/console/lazy-loading sweeps across the whole tree.

**Skipped:** `components/ui/**` (27 shadcn-vendored files, incl. the 771-line sidebar.tsx), `routeTree.gen.ts` (generated), `pnpm-lock.yaml`, `public/`, `scripts/process-icon.mjs`, `plans/`.

**Unverified (flagging, no budget):** `storage/cache.ts` Dexie layer and the three backend implementations (`githubBackend`, `localBackend`, `exampleBackend` — only their tests and call sites were read); the `editor/cm/` CodeMirror decoration layer (6 files, only 1 has tests — plausible second test-gap hotspot); `calendar/AgendaView` virtualization/scroll-restore logic.

Overall the report is based on direct reading of roughly 40% of the source and grep-level evidence over ~95% of it.

## 3. Findings

---

### 1. CLAUDE.md architecture doc has drifted from the code it governs

- **Category:** `architecture` `layout`
- **Impact:** 5 · **Breadth:** 1 doc, with claims falsified against 6+ source files (verified by `Glob src/occState.ts`, importer greps for `undoToast`/`notifications`, `ls src/*/index.ts`) · **Fix effort:** S
- **Evidence:** `CLAUDE.md` — `` `format.ts`, `fileOccurrence.ts`, `occState.ts` — view-model helpers split from a former `presentation.ts` `` (no `src/occState.ts` exists; the file is `occView.ts`). Also: "A future barrel PR will add `index.ts` files to each directory to formalize the public API surface." — all 9 feature dirs already have barrels, enforced by eslint. Also: `` `occurrenceActions.ts` + `undoToast.ts` — user-action orchestration; used by `editor/` and `calendar/` `` — `undoToast.ts` is imported by exactly one file, `src/occurrenceActions.ts:7`. The list also omits five actual root residents (`occView.ts`, `notifications.ts`, `vaultActions.ts`, `storeCommit.ts`, `persistencePort.ts`).
- **Problem:** This doc is the contract that agents and contributors are told OVERRIDES default behavior, and its root-resident inventory, file names, and rationale are all stale — so placement decisions get justified against fiction.
- **Fix:** Rewrite the root-residents table from the measured import graph, delete the "future barrel PR" paragraph, and correct `occState.ts` → `occView.ts`.

---

### 2. The root view-model layer has zero test coverage despite dense branching

- **Category:** `testing`
- **Impact:** 5 · **Breadth:** 3 files (grep of `occState|formatDurationChip|hasSameStructure|useExpandWithMultiday|durationToEndDate` across `*.test.ts` returns no hits; only `updateFileOccurrenceMap` is covered, in `linking.test.ts`) · **Fix effort:** M
- **Evidence:** `src/model/useExpandWithMultiday.ts:47` — `if (JSON.stringify(ai.repeat) !== JSON.stringify(bi.repeat)) return false` — this `hasSameStructure` function decides when the calendar may reuse a cached expansion instead of recomputing; a false positive silently renders stale data on every view. Same story for `occState` in `src/occView.ts` (9-way state derivation with time-of-day edge cases) and the duration math in `src/format.ts`.
- **Problem:** Model and storage are well-tested, but the pure functions that decide what the user actually sees — occurrence state coloring, duration chips, and the expansion-cache invalidation predicate — are untested, and cache-invalidation bugs fail silently.
- **Fix:** Add vitest suites for `hasSameStructure` (one case per structural field), `occState` (each branch + midnight/duration boundaries), and the `format.ts` duration helpers — all pure functions, no mocking needed.

---

### 4. DayView silently hides timed events outside 07:00–22:00

- **Category:** `ux`
- **Impact:** 5 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `src/calendar/DayView.tsx:260` — `return h >= SH && h <= EH` (with `const SH = 7` / `const EH = 22` hardcoded at the top). The all-day strip only catches untimed occurrences (`allDay = sorted.filter(o => !fmtT(o.time))`).
- **Problem:** An event at 23:00 or 06:00 is filtered out of the timeline and doesn't appear in the all-day strip either — user data becomes invisible on a primary view with no indicator it exists.
- **Fix:** Clamp out-of-window events to the timeline edges (or extend the window dynamically to cover the day's earliest/latest event) instead of filtering them out.

---

### 5. Root files that violate the project's own placement rule

- **Category:** `layout`
- **Impact:** 3 · **Breadth:** 2 files (importer greps: `notifications` → only `storage/sync.ts` + `storage/vaultRegistry.ts`; `undoToast` → only `occurrenceActions.ts`) · **Fix effort:** S
- **Evidence:** `src/storage/sync.ts:18` — `import { notify, warn, notifyError } from '@/notifications'` — the only two importers of `notifications.ts` are both in `storage/`. CLAUDE.md's own rule: "a file moves into a subdirectory only when every caller already lives in that subdirectory".
- **Problem:** Root level is documented as reserved for files imported by three or more unrelated layers, but `notifications.ts` (1 consumer dir) and `undoToast.ts` (1 consumer file) sit there anyway, diluting the convention that makes root residency meaningful.
- **Fix:** Move `notifications.ts` into `storage/` and fold `undoToast.ts` into `occurrenceActions.ts` (or move it beside it), updating the CLAUDE.md table in the same PR.

---

### 6. `store.ts` hand-rolls the same persisted-slice pattern four times

- **Category:** `dry` `srp`
- **Impact:** 3 · **Breadth:** 1 file (4 repetitions: favorites, defaultParticipants, participantFilter, showTasks) · **Fix effort:** M
- **Evidence:** `src/store.ts:161` — `const next = participantFilter.includes(name) ? participantFilter.filter(s => s !== name) : [...participantFilter, name]` — structurally identical to `toggleFavorite` at line 130; each slice repeats the load-from-vault-key / write-on-change / toggle triad. `loadShowTasks` even bypasses the `vaultStorage` helper and calls ``localStorage.getItem(`meridian_show_tasks_${vaultId}`)`` raw.
- **Problem:** Every new per-vault preference re-implements the same persistence choreography by hand, and the fourth copy has already diverged from the helper convention (raw `localStorage` + inline `JSON.parse`).
- **Fix:** Extract a small `persistedVaultSlice(keyPrefix, default)` factory (or at minimum a `readVaultJSON` counterpart to `writeVaultJSON`) and define the four slices declaratively.

---

### 7. Three near-identical vault-connection flows in `vaultRegistry.ts`

- **Category:** `dry`
- **Impact:** 3 · **Breadth:** 1 file (3 blocks: `addLocalVault`, `addGitHubVault`, `addGitHubVaultOAuth`, plus the local/github activation branches duplicated between `restoreVaultsInner` and `setActiveVault`) · **Fix effort:** M
- **Evidence:** `src/storage/vaultRegistry.ts:225` — `await updateVaultRefs(existing => [...existing, ref])` followed by `const files = await backend.readAll()` / `await cacheBulkWriteClean(id, files)` / `await activateWritableVault(backend)` — the same four-step tail appears verbatim in `addGitHubVault` (l. 225–229) and `addGitHubVaultOAuth` (l. 269–273), and `addLocalVault` repeats it with reordered steps.
- **Problem:** The connect-a-vault sequence (register ref → seed cache → activate) exists in three copies whose only real difference is token persistence, so a fix to one flow (e.g. ordering of cache seed vs. activation) can silently miss the others.
- **Fix:** Extract a `registerAndActivate(ref, backend)` helper and reduce the three `add*` functions to credential-specific preambles.

---

### 8. Occurrence matching by ±60 s tolerance is copy-pasted six times through the expansion engine

- **Category:** `dry`
- **Impact:** 3 · **Breadth:** 1 file (`grep -c "Math.abs" src/model/expansion.ts` → 6, plus two hand-rolled year/month/day equality triplets) · **Fix effort:** M
- **Evidence:** `src/model/expansion.ts:262` — `if (Math.abs(o.ms - jsDate.getTime()) < 60000) return o` — the same minute-tolerance match recurs at lines 311, 330, 342, 363, 367, alongside repeated `od.getFullYear() === jsDate.getFullYear() && od.getMonth() === jsDate.getMonth() && od.getDate() === jsDate.getDate()` day comparisons.
- **Problem:** The single most intricate file in the repo encodes its core identity rule ("these two occurrences are the same slot") as six inlined copies of a magic-number comparison, so any change to the matching rule (e.g. timezone handling) must be found and applied six times.
- **Fix:** Extract `sameMinute(a, b)` and `sameCalendarDay(a, b)` helpers in `dateUtils.ts` and use them throughout `expansion.ts` (behavior-preserving, protected by the existing model test suite).

---

### 9. `model/index.ts` exports symbols with zero external consumers

- **Category:** `dead-code`
- **Impact:** 2 · **Breadth:** 2 files (per-symbol grep across `src/` excluding `model/`: `buildRoot`, `parseYamlToStoreItems`, `serializeRawNode`, `hasRepeat`, `multidayCoversDate` → 0 non-model, non-test importers; `dayBefore`/`treeHasOccurrences`/`displayValue`/`buildEffectiveTree` are used only by the debug tool) · **Fix effort:** S
- **Evidence:** `src/model/index.ts:7` — `export { parseToStoreItems, buildRoot, effectiveNodeToStoreItems, parseYamlToStoreItems } from './storeItems'` — `buildRoot` and `parseYamlToStoreItems` are consumed only inside `storeItems.ts` itself.
- **Problem:** The barrel is supposed to be the deliberate public API surface of the domain core, but roughly a third of its exports have no consumer, which makes the real API illegible and every internal refactor look like a breaking change.
- **Fix:** Drop the unconsumed exports from the barrel (keep them as plain module exports for the debug tool where needed) so the barrel reflects the actual API.

---

### 10. `OccurrenceCard` gates its meta row on tags it never renders

- **Category:** `dead-code` `ux`
- **Impact:** 2 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `src/components/OccurrenceCard.tsx:134` — `const hasTagsContent      = showTagsParticipants && (tags.length > 0 || listedOn.length > 0)` — but the meta row only renders `listedOn.map(label => (<TagChip …` ; `tags` appears nowhere in the JSX.
- **Problem:** An occurrence with tags but no time/date/backlinks renders an empty meta row (layout gap), and the dead `tags` wiring suggests tag chips were removed from the card without cleaning up the gating logic.
- **Fix:** Either render the tag chips or remove `tags` from `hasTagsContent` and the destructuring.

---

**Also noted (below top-10 cutoff):** the docstring on `extractFileMetadata` in `src/types.ts:172` claims "Migrates legacy `topics` to `items`" but the implementation never reads `fields.topics` — no migration exists anywhere (grep `topics` → comments only). One-line docstring fix, same "docs claim things the code doesn't do" theme as finding 1.

# Codebase Health Survey

Survey this codebase for code health issues across the categories below.

## Process

- **Scan first, write second.** State your scan plan before you start, complete the full scan, and only then write the report. Do not draft the verdict early and select findings to confirm it.
- Evaluate the code on its merits. Treat claims in CLAUDE.md, READMEs, or architecture docs (e.g. "this exception is deliberate", "a refactor is planned") as hypotheses to verify against the code, not as settled exceptions — if a documented rationale no longer holds, that is a finding.

## Budget

- Skim the full directory tree (listings + file names) so nothing is invisible to you.
- Read closely: the entry points, the most-imported modules (measure this — don't guess), the 15 largest source files, and at least 2–3 representative files from every feature directory.
- Sample the rest. Do not skip a directory entirely without recording it in the coverage statement.

## Output structure

### 1. Health verdict (~5 sentences)

A plain-language summary of the repo's overall health. Name the **worst one or two areas** (by directory or subsystem, e.g. "the `auth/` layer" — not individual findings) and the **single biggest structural theme** running through the findings. This is the headline answer; the list below is the supporting evidence.

### 2. Coverage statement

- Which directories/files you examined closely, which you only sampled, and which you skipped — with the reason (irrelevant, generated, vendored, too large, ran out of budget, etc.).
- Roughly what fraction of the codebase this report is based on.
- Any area you suspect has issues but did not have budget to investigate — flag it as "unverified."

### 3. Findings

For each finding, output:

- **Title** — short label
- **Category** — one or more tags from: `architecture` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `ux` `performance` `security` `dependencies` `naming`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = e.g. a DRY violation duplicated across ~4 files, or a missing error state on a primary user flow; 1 = trivial/cosmetic)
- **Breadth** — number of **files** affected. Counts must come from an actual search (grep/glob), and you should be able to name the search you ran; if you estimated instead, write "est." next to the number.
- **Fix effort** — S / M / L (S = localized edit; M = touches a few files or needs a small refactor; L = structural change across the codebase)
- **Evidence** — at least one file path plus a short **verbatim code quote** from that file (line number optional). The quote must be copy-pasted, not paraphrased — I will spot-check by grepping for it.
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

### 4. Testing & Error Handling

- Core domain logic with no test coverage at all, or coverage concentrated on trivial code while the risky paths go untested
- Tests that can't fail meaningfully — over-mocked tests, snapshot rot, assertions on implementation details
- Swallowed errors — empty or log-only `catch` blocks, unhandled promise rejections, errors caught without surfacing to the user or a recovery path
- No consistent error strategy — each layer inventing its own mix of throw / return-null / silent-default

### 5. Code Health & DRY

- DRY violations — duplicated logic that should be a shared utility or hook, especially across feature boundaries
- SRP violations — functions/components doing too many unrelated things
- Overly defensive coding — checking for the same risks in multiple layers without a clear strategy
- Naming — misleading, ambiguous, or inconsistent names across a module boundary (e.g. the same concept called different things in different layers, or a name that no longer reflects what the code does)
- Dead code — unreachable paths, unused exports, or unused imports at module boundaries (not just individual variables)
- Type safety — pervasive use of `any`, missing return types on public API surfaces, unsafe casts

### 6. Styling & UX

- Shadcn component available but bypassed in favour of a custom re-implementation
- Raw CSS / inline styles where Tailwind classes would suffice, or Tailwind used where plain CSS is clearly better
- UX anti-patterns: missing loading/error states, non-accessible interactive elements (no keyboard nav, missing ARIA)

### 7. Performance

- React anti-patterns: object/array literals in JSX props, missing `useMemo`/`useCallback`/`memo` at component boundaries (not fine-grained)
- Missing lazy-loading / code-splitting at route or feature boundaries
- N+1 or waterfall data fetching patterns

### 8. Dependencies & Maintainability

- Significantly outdated or abandoned dependencies
- Functionality duplicated across two libraries

---

**Scoring guidance:** A finding that reveals a structural pattern affecting the whole codebase (e.g., "every feature imports from `lib/` internals instead of going through a public API") scores higher than a finding about a single misused hook. Skip findings that are purely stylistic or affect a single isolated callsite — they belong in a lint rule, not a health report.
