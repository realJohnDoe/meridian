## Next steps

- Convert duration into end date/time
- Add filter by participants in side bar
- Update Tutorial vault with new features and 'Every item is a list' paradigm
- Investigate how to change EntryEditor: Own endpoint / Top bar visible
- Add nice readme
- Add Solarized Light theme
- Add option to show dates formatted european / first day of the week config
- Investigate more secure storage options

# Meridian — Code Health Survey

## 1. Health verdict

Meridian is a **well-engineered codebase** with unusually disciplined lower layers: `model/` and
`storage/` are pure, dependency-correct (they never import upward into UI), heavily commented with
intent, and backed by real unit tests. The type system is genuinely strong — there is not a single
`: any` or `as any` in `src/`. The weakest area is the **`src/` root directory itself**, which has
become a flat catch-all of ~12 unrelated domain modules (DOM toasts, IndexedDB cache, YAML I/O,
presentation logic, global Zustand state, wikilink parsing) with no layering, and within it
**`presentation.ts`**, a 268-line god module spanning five unrelated concerns. The single biggest
structural theme is **hidden global mutable state and hand-choreographed side effects**: a
`mutate → warmSlugInFOM → setData → writeEntityToCache` sequence is manually repeated at ~8 call
sites, and module-level mutable caches (`_fomCache`, `_shas`, `_syncing`) are invalidated by
convention rather than by the type system. None of this is catastrophic — the app works and is
tested — but the root layer's lack of boundaries is where future bugs will hide.

---

## 2. Coverage statement

**Read in full (~55%):** `store.ts`, `storeBridge.ts`, `types.ts`, `presentation.ts`, `cache.ts`,
`items.ts`, `wikilinks.ts`, `events.ts`, `fileIO.ts`, `occurrenceActions.ts`; all of `storage/`
except backend impls (`sync.ts`, `backend.ts`, `githubBackend.ts`, `githubApi.ts`,
`vaultRegistry.ts` read fully); `model/storeOps.ts`, `model/dateUtils.ts`, `model/types`;
`editor/` core (`EntryEditor`, `EntryOverlay`, `EditorShell`, `DialogStack`, `useEntryEditor`,
`save.ts`, `state.ts`); `calendar/DayView`, `AgendaView`, `OccurrenceRow`;
`components/OccurrenceCard`; `routes/_app.tsx`, `_app.index.tsx`; `vaults/ManageVaultsDialog`;
`vite.config.ts`.

**Sampled (headers/greps only):** `model/expansion.ts` (580 LOC — read only the header/public
surface), `RepeatDialog.tsx` (559), `NodeInheritanceDebugger.tsx` (777), `components/ui/*`
(shadcn-generated — checked for bypass, not audited).

**Deliberately skipped:** `components/ui/*` internals (vendored/generated), all `__tests__/`,
`model/inheritance|collapse|repeat|storeItems`, `editor/cm/*` (CodeMirror decoration plumbing),
`onboarding/CoachTour`, `search/`, `MonthView`, `SettingsDialog`, `Sidebar`. Reasons: generated,
or lower-risk leaf code, or budget.

**Unverified (suspected issues, not investigated):** `model/expansion.ts` is the algorithmic core
(580 LOC) and the most likely home of an undiscovered god-function/complexity problem — flag as
unverified.

This report is based on roughly **55–60%** of the application source (excluding tests and generated UI).

---

## 3. Findings

### 5. GitHub personal access token stored in plaintext IndexedDB

- **Category:** `security`
- **Impact:** 5
- **Breadth:** `cache.ts` (`tokenSave`/`tokenLoad`) + `vaultRegistry.ts` (4 sites)
- **Fix effort:** M
- **Evidence:** `cache.ts:153` `tokenSave` writes the raw token to the Dexie `meta` table; `vaultRegistry.ts:111,148` read it back into `GitHubBackend`.
- **Problem:** The fine-grained PAT (repo write scope) sits unencrypted in IndexedDB, so any XSS or malicious dependency in this client-only PWA can exfiltrate a credential that can rewrite the user's repo. The UI hygiene is good (`type="password"`, `autoComplete="off"`) but storage is not.
- **Fix:** Wrap the token with a non-extractable WebCrypto key before persisting (the app already targets environments with full WebCrypto support per `vite.config.ts`), or at minimum document the trust boundary explicitly and scope guidance toward read-only tokens where possible.

---

### 6. No feature public-API surface — deep cross-feature internal imports

- **Category:** `architecture` `layout`
- **Impact:** 4
- **Breadth:** Many (no `index.ts` barrels anywhere)
- **Fix effort:** L
- **Evidence:** `debug/NodeInheritanceDebugger.tsx:23-28` imports `@/editor/save`, `@/editor/useEntryEditor`, `@/editor/dialogs/RepeatDialog`, `@/editor/DialogStack` directly; storage internals are imported the same way across the app.
- **Problem:** Every consumer reaches into a feature's private files, so there is no boundary to refactor behind — moving `editor/save.ts` breaks unrelated debug + UI code.
- **Fix:** Add per-feature `index.ts` barrels exposing the intended surface, and lint against deep imports (`eslint-plugin-import` is already installed).

---

### 11. `OccurrenceCard` reads the store non-reactively during render

- **Category:** `performance` `architecture`
- **Impact:** 3
- **Breadth:** 1 component (rendered per row)
- **Fix effort:** S
- **Evidence:** `components/OccurrenceCard.tsx:76` `const roots = getRoots()` (a `storeBridge` getter) inside the component body, then `useMemo([occ.fileSlug, roots])`.
- **Problem:** The card bypasses the Zustand subscription and relies on the parent always re-rendering it when `roots` changes; the `useMemo` key is a fresh getter result, so the memo's reactivity is incidental, not guaranteed.
- **Fix:** Pass `roots` in as a prop (the parent already subscribes) or use `useStore(s => s.roots)`.

---

### 12. `OccurrenceCard` prop explosion (7 display flags)

- **Category:** `srp` `architecture`
- **Impact:** 3
- **Breadth:** 1 component, 3 call sites
- **Fix effort:** M
- **Evidence:** `OccurrenceCardProps` carries `taskCheckbox`, `eventNoteIcon`, `showTime: 'inline'|'badge'|'none'`, `showDate`, `showTagsParticipants` — and the body has nested ternaries (`OccurrenceCard.tsx:118-132`) to reconcile them.
- **Problem:** One component encodes several distinct card layouts via boolean combinations, making valid/invalid combinations implicit and the render logic hard to follow.
- **Fix:** Split into a couple of presentational variants or a single `variant` enum prop.

---

### 13. `NodeInheritanceDebugger` (777 LOC) duplicates editor wiring; `debug/` depends on `editor/` internals

- **Category:** `dead-code` `architecture`
- **Impact:** 3
- **Breadth:** 1 file (dev-only)
- **Fix effort:** M
- **Evidence:** `debug/NodeInheritanceDebugger.tsx` is the largest file in the repo, served only via the dev-only `debugPagePlugin` (`vite.config.ts:19`), and re-implements editor/dialog glue by importing `@/editor/save`, `useEntryEditor`, `DialogStack`.
- **Problem:** A 777-line dev tool reaches into editor internals and reimplements their choreography, so it must be maintained in lockstep with the real editor despite never shipping.
- **Fix:** Either delete it or have it mount the real `EditorShell`/`useEntryEditor` instead of duplicating their wiring.

---

### 14. Autosave effect fires on every `entry` change via suppressed exhaustive-deps lint

- **Category:** `error-handling` `performance`
- **Impact:** 3
- **Breadth:** 1 file
- **Fix effort:** S
- **Evidence:** `editor/EntryEditor.tsx:103-108` `useEffect(... , [entry])` with `// eslint-disable-next-line react-hooks/exhaustive-deps`, calling `onAutoSave` whenever any entry field changes.
- **Problem:** Autosave triggers on unrelated state changes (type toggles, dialog-driven field edits), not just body edits, risking redundant saves/network writes; the disabled lint rule hides the over-broad dependency.
- **Fix:** Trigger autosave from the specific change handlers (body/title) rather than a catch-all effect on the whole `entry`.

---

### 15. Imperative DOM-style manipulation for swipe-to-delete

- **Category:** `styling` `srp`
- **Impact:** 2
- **Breadth:** 1 file (~80 lines)
- **Fix effort:** M
- **Evidence:** `calendar/OccurrenceRow.tsx:42-112` sets `row.style.transform`, `hintL.style.filter/opacity`, queries `querySelector('svg')`, and drives animation timers manually.
- **Problem:** Animation state lives entirely outside React in mutated inline styles, which is hard to test and reason about. The `preventDefault` need is legitimate; the style choreography is the smell.
- **Fix:** Keep the raw `touchmove` listener but drive transforms via CSS custom properties or class toggles rather than direct multi-element style writes.

---

### 16. Occurrence view-model derivation split across `types.ts` and `presentation.ts`

- **Category:** `architecture` `naming`
- **Impact:** 3
- **Breadth:** 2 files, many consumers
- **Fix effort:** S
- **Evidence:** `types.ts:204-211` owns `occKind`/`occIsRecur`/`isStandaloneOcc`; `presentation.ts:235` owns `occState` and `sortOccs` — both derive display semantics from an `Occurrence`.
- **Problem:** The rules that classify an occurrence for display are spread between the type module and the presentation module, so "how is a task-vs-event decided" has no single home.
- **Fix:** Consolidate all occurrence-display derivations into one `occView.ts`.

---

### 17. Empty `<Suspense>` fallback for the lazy editor overlay

- **Category:** `ux`
- **Impact:** 2
- **Breadth:** 1 route
- **Fix effort:** S
- **Evidence:** `routes/_app.tsx:141` `<Suspense>` with no `fallback` wrapping the `lazy(EntryOverlay)`.
- **Problem:** On a cold chunk load the editor overlay renders nothing until the chunk arrives — no spinner/skeleton on a primary user flow (opening an entry).
- **Fix:** Provide a lightweight skeleton fallback (the agenda already has `AgendaSkeleton`/`Skeleton`).

---

### 18. `storeBridge.ts` mixes store accessors with DOM toast notifications

- **Category:** `srp` `architecture`
- **Impact:** 3
- **Breadth:** 1 file, imported by storage + actions
- **Fix effort:** S
- **Evidence:** `src/storeBridge.ts` exports `getItems`/`setSyncError`/`setActiveVaultId` **and** `notify`/`warn`/`notifyError` (sonner toasts) from the same module.
- **Problem:** The storage layer's "bridge to global state" also owns user-facing notifications, coupling pure state plumbing to a UI toast library and giving the module two reasons to change.
- **Fix:** Move `notify`/`warn`/`notifyError` into a `notifications.ts` (UI layer) and keep `storeBridge` to state access only.

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
