## Next steps

- Add overdue section in agenda
- Add CodeMirror 6 for markdown editing
- Make layout tablet-friendly
- Convert duration into end date/time
- Add Solarized Light theme

## Results from last Quality Survey

### Custom Prompt on Opus

1. AppLayout (\_app.tsx) is a god-component owning ~7 unrelated concerns
   Category: srp architecture
   Impact: 5
   Evidence: \_app.tsx:40-245 — one component handles topbar + day-nav, sidebar/vault list, sync-status color/title logic (:59-66), search bar, filter overlay, entry overlay, and the add-vault dialog, plus inline vaultIcon/navItems building.
   Problem: Any change to the sidebar, sync indicator, or search bar forces edits to a single 245-line layout file with intertwined state (filterQuery, sidebarOpen, addVaultOpen).
   Fix: Extract <Sidebar>, <SyncButton>, and <SearchBar> components, each owning its own state and store selectors.

2. exampleRef literal hand-rolled 4× in vault.ts
   Category: dry
   Impact: 3
   Evidence: Identical { id: 'example', name: 'Example data', kind: 'example' } at vault.ts:177, :283, :328, :358 (last one with as const).
   Problem: The canonical example vault descriptor is duplicated; renaming "Example data" means four edits and the variants already drift (typed vs as const).
   Fix: Export one EXAMPLE_VAULT_REF constant and reference it.
3. onOpen = navigate(entryRoute(...)) duplicated across route files
   Category: dry
   Impact: 3
   Evidence: Same callback at \_app.day.$date.tsx:18, \_app.index.tsx:42, \_app.tsx:90.
   Problem: The open-entry handler is re-declared in every route that lists occurrences.
   Fix: A small useOpenEntry() hook returning the memoized callback.
4. Stateful toast scheduler lives as module globals inside mutations.ts
   Category: srp architecture
   Impact: 4
   Evidence: mutations.ts:206-231 — let \_toastTimer, let \_pendingCommit, showDeleteToast with setTimeout/clearTimeout, all in the same file as the pure edit API.
   Problem: Module-level mutable singletons make mutations.ts non-pure and the undo-commit timing untestable in isolation; "apply edit" and "manage a 4s undo timer" are unrelated responsibilities.
   Fix: Move the undo-toast scheduler into its own module (e.g. undoToast.ts) that mutations.ts calls.
5. Editor handler prop-drilling through three layers
   Category: architecture dry
   Impact: 3
   Evidence: ~18 handlers from useEntryEditor are destructured and re-passed individually in EditorShell.tsx:23-71 and again declared as 16 props in DialogStack.tsx:14-31.
   Problem: Adding one dialog field means editing the hook return, EditorShell, the DialogStack props interface, and the call site — four touch points for one wire.
   Fix: Pass the hooks object (or a grouped dialogHandlers) straight through rather than spreading every callback by hand.
6. Dead no-op spread + unused binding in updateRoot
   Category: dead-code
   Impact: 2
   Evidence: storeOps.ts:140-147 — const existing = next.get(fileSlug) then ...(existing ? {} : {}), a spread that is a no-op in both branches; existing is otherwise unused.
   Problem: Misleading code suggesting a merge that never happens (comment even says "merge if needed").
   Fix: Delete the existing binding and the dead spread.
7. initApp() is an empty no-op still wired into the root
   Category: dead-code
   Impact: 1
   Evidence: vault.ts:373-375 — body is only a comment; called at \_\_root.tsx:16.
   Problem: A do-nothing function called on boot implies an init step that doesn't exist.
   Fix: Remove initApp and its call.
8. GitHub backend only sees the repo root and keys files by name, not path
   Category: architecture error-handling
   Impact: 4
   Evidence: githubBackend.ts:50-65 requests path: '' and stores tokens.set(item.name, item.sha); statAll never recurses into subdirectories.
   Problem: Vaults with files in subfolders silently won't sync/round-trip via GitHub, unlike the local backend — an inconsistent boundary contract between two StorageBackend implementations.
   Fix: Use the Git Trees API (recursive=1) and key by full path to match LocalBackend's semantics.
9. No global loading/error UI while the vault restores
   Category: ux
   Impact: 3
   Evidence: \_\_root.tsx:15-18 fires restoreVaults() in an effect; the agenda renders against empty items until it resolves (\_app.index.tsx:34-40 even has a comment about scrolling "against an empty agenda").
   Problem: On a slow GitHub/FS load the user sees an empty app with no spinner, and there's no surfaced state distinguishing "loading" from "empty vault."
   Fix: Add a loading flag to the store, set it around restoreVaults, and render a skeleton/spinner.
10. Occurrence visual state is stringly-typed and decoded by ad-hoc maps
    Category: types naming
    Impact: 3
    Evidence: presentation.ts:191 occState(): string returns magic strings ('task-p1', 'event-future'…) consumed via untyped Record<string,string> maps \_ccBarMap/\_dvBlkMap (:231, :249) with ?? 'event' fallbacks hiding typos.
    Problem: A renamed state or typo'd map key fails silently to the fallback class instead of a compile error.
    Fix: Make occState return a string-literal union and type the maps as Record<OccState, string>.
11. Navigation hard-bound to window.history.back()
    Category: architecture
    Impact: 2
    Evidence: storeBridge.ts:14 — navigateBack = () => window.history.back(), used by the mutation layer instead of the router's history.
    Problem: Bypasses the TanStack router abstraction (used elsewhere via router.history.back() in useEntryEditor.ts:62), giving two inconsistent back-navigation paths and coupling non-UI code to the global window.
    Fix: Route all back-navigation through the router and remove the window.history shim (folds into finding #1).
12. notify() builds error strings by hand and re-implements an auto-dismiss timer
    Category: error-handling dry
    Impact: 2
    Evidence: storeBridge.ts:17-24 hand-rolls a setTimeout dismiss; callers across vault.ts repeat notify('… failed: ' + ((e as Error).message || (e as Error).name)) (vault.ts:135, :148, :170).
    Problem: The error-banner timer logic and the (e as Error).message || .name formatting are duplicated, and the timer mechanism overlaps with the toast timer in mutations.ts (two bespoke dismiss schedulers).
    Fix: A single notifyError(prefix, e) helper plus one shared transient-message scheduler.
13. EntryEditor repeats the metadata-chip button five times
    Category: dry
    Impact: 2
    Evidence: EntryEditor.tsx:224-257 — Date/Time/Duration/Priority/Repeat are five near-identical badgeVariants({variant:'chip'}) buttons differing only in icon, label, value text, and onClick.
    Problem: Each new metadata chip is another copy of the same markup; styling/aria tweaks must be applied five times.
    Fix: Extract a <PropChip icon label value pressed onClick className?> component and map over a small config array.

### /code-review with Opus

🟠 Medium — deletes bypass the offline staging model
src/vault.ts:139-150 — deleteFileFromDisk writes through to the backend immediately (\_activeBackend.delete(path)), while edits are staged in cache and synced later. Also reached implicitly when a file is emptied (vault.ts:125).

Failure scenario: user is offline (or GitHub token is rate-limited). An edit succeeds (staged dirty), but a delete immediately throws → "Delete failed" banner, and unlike edits it can't be retried via the sync button. The two operations have inconsistent durability/offline semantics. Consider staging deletes as a tombstone flushed by syncToDirectory too.

🟠 Medium — GitHub ensurePermission only proves read access
src/storage/githubBackend.ts:141-151 — it does GET /repos/{owner}/{repo} and returns 'granted' on success, but that succeeds for a read-only token and doesn't check the configured branch.

Failure scenario: user adds a GitHub vault with a read-scoped (or wrong-branch) token. addGitHubVault reports success and saves the vault; the first write() during sync 403s/404s later with a confusing "Sync failed" rather than being caught at connect time.

🟡 Low — redundant in-place mutation of shared metadata
src/mutations.ts:112 — o.metadata.done = !o.metadata.done mutates the occurrence object directly "for optimistic UI", but setData(next) runs synchronously on the next line and re-renders from freshly-expanded items. The mutation is dead for its stated purpose and risks mutating an object that expansion may share/cache. Drop it.

🟡 Low — cleanup
src/model/storeOps.ts:146 — ...(existing ? {} : {}) spreads an empty object on both branches: dead code, and the "merge if needed" comment describes behavior that doesn't exist. Remove it or implement the merge.
src/storeBridge.ts:17-24 — notify auto-clears after 5s by comparing errorNotification === msg. Two identical messages in a row share the key, so the first timer can clear the second banner ~early. A token/id would be more robust.
src/index.css:347 (the PR under review) — the banner now hardcodes color:#fff for text and close button instead of a theme token. Fine on the opaque destructive background, but inconsistent with the token-based styling everywhere else.

### /code-review with Sonnet

[
{
"file": "src/vault.ts",
"line": 77,
"summary": "reconcileWithDisk silently overwrites unsaved local edits on vault activation",
"failure_scenario": "User edits a note (dirty=1, version='local:…'), closes the tab without syncing. On next load, reconcileWithDisk fires: entry.version ('local:…') never equals the disk token, so the file is added to 'changed' and cacheBulkWriteClean overwrites it with the remote version at dirty:0. The local edit is permanently gone — no merge, no conflict prompt, no undo."
},
{
"file": "src/cache.ts",
"line": 47,
"summary": "cacheInit assigns db before db.open() resolves; concurrent caller gets an un-opened Dexie instance",
"failure_scenario": "Two callers hit cacheInit() concurrently. The first enters the IIFE and sets db = new MeridianDB() synchronously before the first await. The second caller arrives in the next microtask, takes the 'if (db) return db' fast-path (line 44), and receives a MeridianDB whose open() has not completed. Any subsequent Dexie operation on that instance throws DatabaseClosedError, breaking the entire cache layer."
},
{
"file": "src/storage/githubApi.ts",
"line": 16,
"summary": "onSecondaryRateLimit always returns true, causing infinite retry with no cap",
"failure_scenario": "A sync burst triggers GitHub's abuse-detection secondary rate limit. Unlike onRateLimit which caps at retryCount < 2, this handler unconditionally returns true. Octokit retries after retryAfter seconds each time; GitHub re-triggers the limit; the loop never exits. syncToDirectory hangs indefinitely and the user sees no error — only a frozen spinner."
},
{
"file": "src/storage/githubBackend.ts",
"line": 52,
"summary": "statAll uses path:'' which only lists the repo root; files in subdirectories are silently skipped",
"failure_scenario": "A GitHub vault with any .md/.yaml file in a subdirectory (e.g. journal/2025-01.md) will never appear in statAll(). The file is absent from the sync tokens map, is never read into the cache, and is never displayed in the UI. There is no error — the files simply vanish silently on first load."
},
{
"file": "src/storeBridge.ts",
"line": 19,
"summary": "notify() clears a still-active notification when two calls fire with identical message strings",
"failure_scenario": "Two rapid save failures both call notify('Save failed: NetworkError'). Each arms a 5-second timer. The first timer fires at T+5s, sees errorNotification === msg → true, clears the banner. Even if the user was still reading it (second timer hasn't expired yet), the notification is gone. With high-frequency failures (e.g. repeated sync errors) the banner can flash and vanish repeatedly."
},
{
"file": "src/model/storeOps.ts",
"line": 146,
"summary": "Dead spread ...(existing ? {} : {}) in updateRoot always spreads an empty object",
"failure_scenario": "The spread is a no-op in both branches — existing is never used. The comment 'merge if needed — for now full replace from form' invites a future developer to add merge logic in the wrong place, believing this line already guards it. Any field-preserving merge intent is silently absent."
},
{
"file": "src/presentation.ts",
"line": 106,
"summary": "fileOccurrenceMap materialises a full 3-year backward occurrence array just to reverse-iterate it",
"failure_scenario": "expandRange(items, roots, BACK, TODAY) allocates an array of all past occurrences (up to 3 years of daily recurrences — potentially tens of thousands of objects) even when the forward pass already filled every slug. On a large vault viewed on a low-memory device, this causes a measurable GC pause on every cache miss."
},
{
"file": "src/constants.ts",
"line": 5,
"summary": "TODAY is computed once at module load and never refreshed; items appear in wrong time bucket after midnight",
"failure_scenario": "As a PWA, Meridian stays open across midnight. After midnight, TODAY still holds yesterday's date. fileOccurrenceMap anchors AHEAD/BACK from the stale TODAY, so the new calendar day's occurrences fall into the 'most-recent past' backward-pass bucket instead of the 'upcoming' forward-pass bucket — wrong representative occurrences in the item picker and wikilink targets until next reload."
}
]
Summary by severity:

# File Severity Kind

1 vault.ts:77 Critical Data loss — unsaved edits silently overwritten on restart
2 cache.ts:47 High Race — un-opened DB returned to concurrent caller
3 githubApi.ts:16 High Correctness — infinite retry hangs sync indefinitely
4 githubBackend.ts:52 High Correctness — subdirectory files silently invisible
5 storeBridge.ts:19 Medium Race — notification cleared prematurely on duplicate messages
6 storeOps.ts:146 Low Cleanup — dead spread, misleading comment
7 presentation.ts:106 Low Efficiency — unnecessary full backward array allocation
8 constants.ts:5 Low Staleness — wrong date bucket after midnight in long-running PWA

## Survey Prompt

Survey this codebase for code health issues across the categories below.

For each finding, output:

- **Title** — short label
- **Category** — one or more tags from: `architecture` `layout` `dry` `srp` `dead-code` `types` `error-handling` `styling` `ux` `performance` `security` `dependencies` `naming`
- **Impact** — a score from 1–10 (10 = catastrophic/systemic, 1 = trivial/cosmetic)
- **Evidence** — at least one specific file path + line number or code snippet
- **Problem** — one sentence: what is wrong and why it matters
- **Fix** — one sentence: what the concrete fix looks like

List the **top 20 findings** ranked by: (impact score × breadth of occurrence) ÷ estimated fix effort.
**Strongly prefer systemic and structural issues over isolated, line-level ones.** A finding that affects 10 files beats one that affects 1 function. Cite real code — no generic observations.

Include all findings that make the top 20 regardless of their impact score — if a 1/10 ranks in the top 20, include it and make the low score visible so the reader can decide whether to act on it.

---

Categories to scan — **ranked by priority**:

The category ranking is a tiebreaker, not a filter. A serious finding in any category always outranks a minor finding in a higher-priority category — never omit a high-impact issue because its category ranks lower.

**1. Architecture & Domain Separation** _(highest weight — prefer findings here)_

- Domain leakage — logic belonging to one domain (auth, billing, data-fetching, UI state) leaking into another layer or domain
- Wrong abstraction level — a component or module that owns too many concerns, or a concern split across too many files with no clear owner
- Missing or misplaced boundaries — absence of a clear API surface between subsystems (e.g., feature modules that import directly from each other's internals)
- Circular or upward dependencies — lower-level modules importing from higher-level ones
- God files — single files accumulating logic from unrelated domains

**2. Directory & File Layout** _(high weight)_

- Co-location violations — files that always change together but live far apart; or files co-located that have no logical relationship
- Depth mismatch — a module's position in the directory tree should reflect its dependency footprint: broadly used or broadly dependent code belongs at a higher level (e.g. `lib/`, `shared/`, or a feature root), while code with a single consumer or a single dependency should live within or directly beside that consumer's subdirectory; flag modules that are either too shallow for how narrowly they're used, or too deeply nested for how widely they're shared
- Inconsistent module conventions — some features use `feature/index.ts` barrel exports, others do not; or naming conventions differ across domains without reason
- Layout that fights the framework — e.g., route files that aren't co-located with their route, server-only code inside `components/`, shared utilities scattered across feature folders
- Flat directories that should be split, or deeply nested directories that should be flattened

**3. Security**

- XSS vectors: `dangerouslySetInnerHTML`, unescaped user input rendered as HTML
- Sensitive values hardcoded or exposed to the client bundle
- Security-relevant logic only enforced client-side

**4. Code Health & DRY**

- DRY violations — duplicated logic that should be a shared utility or hook, especially across feature boundaries
- SRP violations — functions/components doing too many unrelated things
- Overly defensive coding - checking for the same risks in multiple layers without a clear strategy
- Naming — misleading, ambiguous, or inconsistent names across a module boundary (e.g. the same concept called different things in different layers, or a name that no longer reflects what the code does)
- Dead code — unreachable paths, unused exports, or unused imports at module boundaries (not just individual variables)
- Type safety — pervasive use of `any`, missing return types on public API surfaces, unsafe casts

**5. Styling & UX**

- Shadcn component available but bypassed in favour of a custom re-implementation
- Raw CSS / inline styles where Tailwind classes would suffice, or Tailwind used where plain CSS is clearly better
- UX anti-patterns: missing loading/error states, non-accessible interactive elements (no keyboard nav, missing ARIA)

**6. Performance**

- React anti-patterns: object/array literals in JSX props, missing `useMemo`/`useCallback`/`memo` at component boundaries (not fine-grained)
- Missing lazy-loading / code-splitting at route or feature boundaries
- N+1 or waterfall data fetching patterns

**7. Dependencies & Maintainability**

- Significantly outdated or abandoned dependencies
- Functionality duplicated across two libraries

---

**Scoring guidance:** A finding that reveals a structural pattern affecting the whole codebase (e.g., "every feature imports from `lib/` internals instead of going through a public API") scores higher than a finding about a single misused hook. Skip findings that are purely stylistic or affect a single isolated callsite — they belong in a lint rule, not a health report.

If you find a significant issue in a category not listed above, include it.
Do not pad to reach 20 — if fewer than 20 clear issues exist, stop there.
