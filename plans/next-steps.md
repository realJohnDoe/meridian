## Next steps

- Make done tasks less prominent. The bright green checkmark is a bit distracting.
- Improve performance on fuzzy search.
- Use proper routing to fix wikilink following / back button navigation

## Results from last Quality Survey

1. Duplicated multiday-occurrence expansion & file-meta join across views
   Impact: High
   Evidence: AgendaView.tsx:29-51 and DayView.tsx:138-150 both re-implement the "scan standalones → generate virtual occurrences for each covered day → join roots meta" logic, including the literal fallback roots.get(i.fileSlug) ?? { title: '', tags: [], topics: [] }. That same join already exists privately as joinFileMeta in expansion.ts:672, and dedup logic is repeated again in DayView.tsx:189-194 and MonthView.tsx:46-51.
   Problem: The most subtle domain rule in the app (multiday rendering) is copy-pasted in 3+ places, so a fix or schema change must be made everywhere or views silently diverge.
   Fix: Export joinFileMeta and a single expandWithMultiday(items, roots, from, to) helper from expansion.ts and have all three views call it.
2. Interactive <div>s with no keyboard/ARIA support (systemic a11y)
   Impact: Medium
   Evidence: Click-only divs with no role, tabIndex, or key handler: MonthView.tsx:37 (cal-cell), DayView.tsx:59 (dv-aditem) and DayView.tsx:102 (dv-eblk), FilterOverlay.tsx:20 (occ-create-row), App.tsx:280 (sidebar scrim), and the Card in OccurrenceCard.tsx:102.
   Problem: Core navigation (open day, open event, create entry) is mouse/touch-only and invisible to keyboard and screen-reader users.
   Fix: Convert these to <button> or add role="button" tabIndex={0} + onKeyDown (Enter/Space) — ideally one shared <ClickableCell> wrapper.
3. Dead store actions and unused state field
   Impact: Medium
   Evidence: nsFilterVal/setNsFilterVal (store.ts:40-41, store.ts:90-91) are never read anywhere; setItems, setRoots (store.ts:73-74), setPendingDirReconnect, setSyncDirtyCount, setSyncFlash are defined but never called — code writes those keys via useStore.setState(...) directly instead (e.g. vault.ts:71).
   Problem: Seven dead store members plus an inconsistent two-way pattern (actions vs. raw setState) mislead readers about the intended API.
   Fix: Delete the unused actions and the nsFilterVal field, or route the existing setState calls through the actions — pick one convention.
4. Pervasive any and unsafe casts in the model/mutation layer
   Impact: Medium
   Evidence: saveNode(item, editScope, fields: any) (mutations.ts:77), (i: any) / (i as any).excluded (mutations.ts:151-152), entryFromItem(item: any) and openEntry((item: any …)) (App.tsx:35, App.tsx:106), as any in storeBridge.ts:9-10, and an entire eslint-disable no-explicit-any block over expansion.ts:164+.
   Problem: The most logic-heavy code (recurrence expansion, save path) has its type checking disabled, so schema mistakes surface at runtime instead of compile time.
   Fix: Type saveNode's fields as a SaveFields interface (it already has a fixed shape) and replace any store accessors with the existing StoreItem/PrimaryView unions.
5. Cache-write failures are silently swallowed
   Impact: High
   Evidence: vault.ts:42-44 writeEntityToCache and vault.ts:54-56 deleteFileFromDisk catch all errors and only console.error — unlike syncToDirectory which calls notify(...) (vault.ts:75). updateSyncUI also swallows with empty .catch(() => {}) (vault.ts:26).
   Problem: If an IndexedDB write fails, the user's edit is lost with zero feedback while the UI shows the change as saved — silent data loss.
   Fix: Call notify(...) (and avoid clearing dirty state) in these catch blocks, matching the sync path's error handling.
6. Day-view "now" line is computed once and never updates
   Impact: Medium
   Evidence: DayView.tsx:256-265 computes const now = new Date() inside the render IIFE; nothing schedules a re-render, and isToday/now are not on any timer.
   Problem: The current-time indicator is correct only at mount and then drifts, defeating its purpose in a calendar's primary day view.
   Fix: Add a useEffect with setInterval (e.g. every 60s) that bumps a state tick to re-render the line.
7. No loading or empty/error state while a vault loads
   Impact: Medium
   Evidence: loadFilesFromDisk (vault.ts:81-99) awaits disk reads then setData; the views render items=[] meanwhile, and AgendaView (AgendaView.tsx:87) has no empty/loading branch — it just renders a bare "Today" section.
   Problem: During async vault load (or parse failure) the user sees a blank screen with no spinner or "no items" messaging, indistinguishable from a broken app.
   Fix: Add an isLoading flag to the store and render skeleton/empty-state UI in the primary views.
8. App.tsx is a god-component
   Impact: Medium
   Evidence: App.tsx is 388 lines holding 6 useStates, ~15 dialog/entry callbacks (App.tsx:130-205), sync-button color/title derivation (App.tsx:71-78), and the full markup for topbar, sidebar, 4 views, search bar, and 7 dialogs.
   Problem: Entry-editing orchestration, navigation chrome, and dialog wiring are all in one file, making any change high-risk and hard to test.
   Fix: Extract a useEntryEditor() hook (entry state + its callbacks) and a <DialogStack> component, leaving App as layout only.
9. Sort/layout helpers mutate their inputs on the render path
   Impact: Medium
   Evidence: sortOccs does arr.sort(...) on the passed array (presentation.ts:71) and is called during render in AgendaView.tsx:101 (sortOccs(g.items) on memoized group arrays); computeColumns writes ev.metadata.\_dh/\_endMs onto live occurrence objects (DayView.tsx:36-37).
   Problem: In-place mutation of memoized/store-derived data during render is a React anti-pattern that causes order-dependent bugs and makes memo comparisons unreliable.
   Fix: Make sortOccs return [...arr].sort(...) and have computeColumns carry layout values in a local map instead of on metadata.
10. MonthView redefines TODAY instead of using the shared constant
    Impact: Medium
    Evidence: MonthView.tsx:10 const TODAY = new Date(); TODAY.setHours(0,0,0,0) shadows the canonical constants.ts:5 TODAY that every other view imports.
    Problem: Two independent "today" definitions can disagree (and a local one captured at module load won't match an app that's been open past midnight), an avoidable correctness/consistency hazard.
    Fix: Delete the local constant and import { TODAY } from '../constants' like the other views.

## Survey Prompt

Survey this codebase for code health issues across the categories below.

For each finding, output:

- **Title** — short label
- **Impact** — one of: Critical / High / Medium (don't include Low)
- **Evidence** — at least one specific file path + line number or code snippet
- **Problem** — one sentence: what is wrong and why it matters
- **Fix** — one sentence: what the concrete fix looks like

List the **top 10 findings** ranked by: (severity × breadth of occurrence) ÷ estimated fix effort.
Prefer systemic issues over isolated ones. Cite real code — no generic observations.

---

Categories to scan:

**Architecture & Code Health**

- Dead code (unreachable, unexported, unused imports/exports)
- DRY violations — duplicated logic that should be a shared utility or hook
- SRP violations — files/functions doing too many unrelated things
- File/directory layout — is co-location logical? Are abstractions at the right level?
- Type safety — use of `any`, missing return types, unsafe casts (TypeScript)
- Error handling — inconsistent, swallowed, or missing error paths

**Styling & UX**

- Shadcn component available but bypassed in favour of a custom re-implementation
- Raw CSS / inline styles where Tailwind classes would suffice, or Tailwind used where plain CSS is clearly better
- Dead or duplicated style code
- UX anti-patterns: missing loading/error states, non-accessible interactive elements (no keyboard nav, missing ARIA), layout that breaks at common breakpoints

**Performance**

- React anti-patterns: object/array literals in JSX props, missing or incorrect `useMemo`/`useCallback`/`memo`, effects that run too often, unnecessary re-renders
- Large synchronous computations on the render path
- Missing lazy-loading / code-splitting opportunities
- N+1 or waterfall data fetching

**Security**

- XSS vectors: `dangerouslySetInnerHTML`, unescaped user input rendered as HTML
- Sensitive values hardcoded or exposed to the client bundle
- Overly permissive CORS, missing auth guards, or security-relevant logic only enforced client-side

**Dependencies & Maintainability**

- Significantly outdated or abandoned dependencies
- Dependencies imported but unused, or functionality duplicated across two libraries

---

If you find a significant issue in a category not listed above, include it.
Do not pad to reach 10 — if fewer than 10 clear issues exist, stop there.
