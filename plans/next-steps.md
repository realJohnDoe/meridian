## Next steps

- Fix agenda loading time and scroll behavior
- Add GitHub Vault support
- Add CodeMirror 6 for markdown editing
- Add overdue section in agenda
- Add Solarized Light theme

## Results from last Quality Survey

1. ISO-date helpers reimplemented in dialogs, duplicating existing model utils
   Impact: Medium
   Evidence: Identical isoToDate / dateToIso / startOfToday appear in src/components/DatePickerDialog.tsx:9 and src/components/RepeatDialog.tsx:63, while src/model/expansion.ts:31 already exports fmtISO (== dateToIso) and parseDateString (== isoToDate).
   Problem: Three copies of local-timezone date↔ISO conversion exist, two of which re-derive a utility the model layer already ships, risking subtle off-by-one timezone divergence.
   Fix: Delete the local copies and import fmtISO / parseDateString from model/expansion.

2. Icon-only buttons have no accessible name
   Impact: Medium
   Evidence: src/routes/\_app.tsx:81 day prev/next <button className="ib"><ChevronLeft/></button> have neither title nor aria-label; same for the search clear/add buttons at src/routes/\_app.tsx:161 and src/routes/\_app.tsx:165 (lucide icons render aria-hidden).
   Problem: Multiple primary navigation/action controls announce only "button" to screen readers and fail keyboard/AT discoverability.
   Fix: Add aria-label (e.g. "Previous day", "Clear search", "New entry") to each icon-only button.

3. Horizontal swipe-navigation gesture duplicated in DayView and MonthView
   Impact: Medium
   Evidence: src/components/DayView.tsx:167 and src/components/MonthView.tsx:107 contain the same touchstart/touchend handler (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)\*1.5, ref-tracked current date/month, passive listeners, identical cleanup).
   Problem: Identical low-level touch-gesture logic is maintained twice, so threshold/axis-lock tweaks must be made in parallel.
   Fix: Extract a useHorizontalSwipe(ref, onPrev, onNext) hook and call it from both views.

4. sortOccs mutates memoized arrays in place during render
   Impact: Medium
   Evidence: src/presentation.ts:158 returns arr.sort(...) (in-place); callers pass memoized data, e.g. src/components/AgendaView.tsx:72 items={sortOccs(g.items)} sorts the memoized groups[k].items array during render.
   Problem: A render-path call reorders cached/memoized state as a side effect, which breaks referential assumptions (e.g. DaySection.propsAreEqual compares items by index) and is impure.
   Fix: Have sortOccs copy first (return [...arr].sort(...)).

5. fileOccurrenceMap runs two ±3-year expansions on the navigation path
   Impact: Medium
   Evidence: src/presentation.ts:76 calls expandRange(items, roots, TODAY, AHEAD) and expandRange(..., BACK, TODAY) across a 6-year window; it's invoked on every entry open and wikilink resolve (src/routes/entry.$fileSlug.tsx:37).
   Problem: A full 6-year recurrence expansion runs synchronously on the first read after any mutation, scaling with series count and recomputing far more than the nearest occurrence actually needs.
   Fix: Narrow the default window (e.g. ±1yr) with a lazy widen-on-miss fallback, or build the map incrementally rather than via two full-range expansions.

6. Cache-write failures are silently swallowed
   Impact: High
   Evidence: vault.ts:42-44 writeEntityToCache and vault.ts:54-56 deleteFileFromDisk catch all errors and only console.error — unlike syncToDirectory which calls notify(...) (vault.ts:75). updateSyncUI also swallows with empty .catch(() => {}) (vault.ts:26).
   Problem: If an IndexedDB write fails, the user's edit is lost with zero feedback while the UI shows the change as saved — silent data loss.
   Fix: Call notify(...) (and avoid clearing dirty state) in these catch blocks, matching the sync path's error handling.

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
- Typescript React / Shadcn / TanStack / Tailwind antipatterns

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
