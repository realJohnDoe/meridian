## Next steps

- Fix agenda loading time
- Add overdue section in agenda

## Results from last Quality Survey

2. Cache-write failures are silently swallowed
   Impact: High
   Evidence: vault.ts:42-44 writeEntityToCache and vault.ts:54-56 deleteFileFromDisk catch all errors and only console.error — unlike syncToDirectory which calls notify(...) (vault.ts:75). updateSyncUI also swallows with empty .catch(() => {}) (vault.ts:26).
   Problem: If an IndexedDB write fails, the user's edit is lost with zero feedback while the UI shows the change as saved — silent data loss.
   Fix: Call notify(...) (and avoid clearing dirty state) in these catch blocks, matching the sync path's error handling.

3. Sort/layout helpers mutate their inputs on the render path
   Impact: Medium
   Evidence: sortOccs does arr.sort(...) on the passed array (presentation.ts:71) and is called during render in AgendaView.tsx:101 (sortOccs(g.items) on memoized group arrays); computeColumns writes ev.metadata.\_dh/\_endMs onto live occurrence objects (DayView.tsx:36-37).
   Problem: In-place mutation of memoized/store-derived data during render is a React anti-pattern that causes order-dependent bugs and makes memo comparisons unreliable.
   Fix: Make sortOccs return [...arr].sort(...) and have computeColumns carry layout values in a local map instead of on metadata.

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
