# UI-Layer Health Survey — Meridian

_Report generated 2026-07-24. Branch: `claude/ui-layer-health-survey-f0f5e9`. Companion to the survey brief in [health-survey-ui.md](health-survey-ui.md)._

## Scan plan (as executed)

**UI layer identified:** `src/routes/` (app shell + route composition), `src/components/` (shared components + `components/ui/` shadcn primitives), `src/calendar/` (agenda/day/month views), `src/editor/` (entry editor, dialogs, CodeMirror integration), `src/search/`, `src/onboarding/`, `src/hooks/`, plus the UI toolchain (`eslint.config.js`, `src/index.css`, `components.json`, `tailwindcss` v4, `vitest`/RTL setup). Excluded as out of scope: `model/`, `storage/`, `debug/` (dev-only, lint-exempt), and root non-UI utilities (`fileIO.ts`, `wikilinks.ts`, etc.), examined only where they cross into components.

Per category, beyond the listed examples I looked for: **(1)** domain math / persistence inline in JSX, god components (300+ lines / 10+ state), prop-drilling depth, derived-state-in-store; **(2)** hardcoded colors/spacing/z-index vs tokens, `cn` bypass, repeated class strings, shadcn fork drift; **(3)** missing loading/empty/error/pending states, touch-target sizes on a mobile PWA, focus management, clickable non-buttons; **(4)** threat model = user/file-derived markdown, frontmatter, wikilinks, filenames rendered — checked every injection path; **(5)** duplicated JSX/hook logic, dead exports, `any` in props; **(6)** whole-store subscriptions, unstable selectors, virtualization, code-splitting; **(7)** installed-vs-enabled lint rules (dry-ran jsx-a11y strict), test harness presence; **(8)** custom widgets duplicating installed radix/shadcn, and correct keep-custom cases.

**Gates run:** `pnpm run build` ✓ pass · `pnpm run lint` ✓ pass (2 warnings, both the documented `react-hooks/incompatible-library` on TanStack Virtual) · `pnpm test` ✓ 568 tests / 46 files pass · `pnpm knip` ✓ clean.

---

## 1. Health verdict

The UI layer is **healthy and unusually well-disciplined** — strong token system, coherent dialog/drawer abstraction, route-level code-splitting, virtualized lists, memoization backed by React Compiler, zero clickable-`div` a11y violations, and a genuinely exemplary lint config. The findings are refinements, not rot. The **single biggest structural theme is resilience & chrome consistency at the edges**: there is **no error boundary anywhere in the render tree** (a render throw white-screens the PWA), and the **always-visible top-bar chrome forks its own icon-button implementation** instead of using the purpose-built accessible `IconButton`, duplicating a class string across ~6 files at a sub-optimal touch-target size. The **weakest subsystems are `src/routes/` and the top-bar area** (missing error/loading fallbacks, duplicated day/month branches, forked icon buttons); everything downstream of them — `editor/`, `calendar/`, `model` boundary — is in good shape.

## 2. Coverage statement

- **Read closely:** app shell (`_app.tsx`, `__root.tsx`), all route modules, `EntryEditor`, `useEntryEditor`, `ItemsList`, `RepeatDialog`, `AgendaView`, `DayPane`, `OccurrenceRow`, `OccurrenceCard`, `MarkdownTaskCard`, `SyncButton`, `AddVaultWizard`, `SearchOverlay`, `CoachTour`, and the `components/ui/` primitives most relevant to findings (`button`, `icon-button`, `responsive-modal`, `sidebar`). Toolchain read in full.
- **Sampled (grep-swept, not fully read):** the remaining `calendar/` layout helpers, `editor/cm/*`, `SettingsDialog`/`VaultSettings`, the smaller `components/ui/` primitives, and `hooks/`. Swept globally for: hardcoded hex, inline styles, clickable divs, `dangerouslySetInnerHTML`, external links, z-index, unstable store selectors, touch-target sizes, Suspense fallbacks, error boundaries.
- **Excluded (out of scope):** `model/`, `storage/`, `debug/`, root non-UI utilities.
- **Fraction:** report rests on ~65–70% of the UI layer (essentially all high-traffic/high-risk surfaces read; low-risk leaf primitives sampled).
- **Unverified:** `MonthGrid`/`MonthView` and the carousel hooks (`useCarousel`, `snapCarousel`) were only skimmed — the multiday-lane math and swipe gesture handling there may hide complexity I did not audit closely. `VaultSettings`/`SettingsDialog` error states were sampled, not exhaustively traced.

## 3. Category verdicts

1. **Component Architecture & Boundaries** — findings: #6, #8 (model/UI boundary is clean and lint-enforced; no god components; domain math correctly extracted to `model/` and `calendar/` helpers)
2. **Styling System Consistency** — findings: #4, #5, #7 (tokens otherwise excellent; hex only in dev-only `debug/`)
3. **UX States & Accessibility** — findings: #1, #2, #3
4. **Security (UI-facing)** — **clean.** Threat model: user/file-derived markdown, frontmatter, wikilinks, and filenames are rendered via CodeMirror decorations and React chips — never `innerHTML` (zero occurrences). The one link-opening path (`markdownFormatting.ts:66`) is scheme-allowlisted (`/^(https?|mailto):/i`) with `noopener,noreferrer`; the one external `<a>` in `AddVaultWizard` uses `rel="noopener noreferrer"`. Nothing to report.
5. **Code Health & DRY** — findings: #2, #3, #4, #7, #8, #9
6. **React Performance** — **clean.** All store reads use selectors (zero whole-store subscriptions; zero selectors constructing new arrays/objects), lists are virtualized, `OccurrenceRow` is `memo`'d with a documented compare, React Compiler is enabled. Nothing worth reporting.
7. **UI Toolchain & Feedback Loops** — **clean** (with two refutations). jsx-a11y `recommended` is correctly chosen: dry-run shows `strict` adds **no new rules**, only marginally tighter options that would trade for false positives. Tailwind class-sorting is not adopted, correctly — `eslint-plugin-tailwindcss` doesn't support Tailwind v4 and there's no Prettier in the project. The `IconButton` label-enforcement gap is real but belongs to finding #2.
8. **UI Dependencies & Library Fit** — findings: #2, #9. **Keep-custom verdicts (correct as-is):** `responsive-modal` (dialog/drawer switch — right call), `OccurrenceRow` swipe-to-delete (no library fits a virtualized list cleanly), the CodeMirror editor integration, and TanStack Virtual usage.

---

## 4. Findings

### 4. Duplicated "dimmable card shell" across the two task-card components

- **Category:** `dry` `styling`
- **Impact:** 4
- **Breadth:** 2 files (`OccurrenceCard.tsx`, `MarkdownTaskCard.tsx`)
- **Fix effort:** M
- **Evidence:** `src/components/MarkdownTaskCard.tsx:27` — `bg-card border border-input rounded-lg transition-colors hover:bg-accent …` + `:28` `style={{ background: 'var(--done-overlay)' }}`; near-identical shell + overlay + `opacity-60` dim at `src/components/OccurrenceCard.tsx:160` / `:163` / `:173`.
- **Problem:** Both cards independently re-implement the same visual contract (surface, border, hover, `done` overlay via `--done-overlay`, dimmed opacity), so a change to the card look must be made in two places and can drift.
- **Fix:** Extract a `DimmableCard` (or a `cva` card variant carrying `dimmed`/`overlay`) and compose both cards from it.

### 5. Z-index layering has no scale — ad-hoc escalating magic numbers

- **Category:** `styling`
- **Impact:** 3
- **Breadth:** 6 files (`grep 'z-\[[0-9]+\]'`): values `z-[1]`, `z-[24]`, `z-[25]`, `z-[26]`, `z-[300]`, `z-[9002]`, intermixed with Tailwind's `z-10/20/50`.
- **Fix effort:** M
- **Evidence:** `src/onboarding/CoachTour.tsx:110` — `className="fixed z-[9002] …"`; `src/search/SearchOverlay.tsx:92` — `z-[24]` / `:94` `z-[25]`; `src/components/ui/alert-dialog.tsx:37` — `z-[300]`.
- **Problem:** Stacking order is expressed as arbitrary literals with no shared reference, so `z-[9002]` (tour) vs `z-[300]` (dialog) vs `z-[24-26]` (search) can only be reasoned about by grepping, and the next overlay will guess another number.
- **Fix:** Define a small set of layer tokens in `@theme` (e.g. `--z-overlay`, `--z-dialog`, `--z-tour`) and reference those instead of raw values.

### 6. Duplicated day/month branches in the app-shell top bar

- **Category:** `dry` `component-architecture`
- **Impact:** 3
- **Breadth:** 1 file (`src/routes/_app.tsx`, the app shell)
- **Fix effort:** M
- **Evidence:** `src/routes/_app.tsx:125-149` — the `isDayView` and `isMonthView` blocks are structurally identical (mobile Menu button + ellipsized label + prev/next chevron `<Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" aria-label="Previous day">` / `"Previous month"`), differing only in the `navigate` target and label text.
- **Problem:** The two ~12-line JSX branches drift independently (they already diverge subtly in label derivation), inflating the most-central file in the app and making top-bar changes error-prone.
- **Fix:** Extract a `<PagedTopbar label prevLabel nextLabel onPrev onNext />` used by both, parameterized by unit.

### 7. Conditional classNames built by string concatenation, bypassing `cn`

- **Category:** `styling` `dry`
- **Impact:** 2
- **Breadth:** 7 files (`grep 'className={`'`with conditionals):`MarkdownTaskCard`, `OccurrenceCard`, `SearchBar`, `WikilinkPopup`, `SearchOverlay`, `DayPane`, plus `OccurrenceCard`'s array-join.
- **Fix effort:** S
- **Evidence:** `src/components/OccurrenceCard.tsx:146-151` — `const cardCls = [ … , dimmed ? 'overflow-hidden' : '' ].filter(Boolean).join(' ')`; `src/components/MarkdownTaskCard.tsx:56` — ``className={`… ${done ? 'line-through' : 'text-foreground'}`}``.
- **Problem:** The project standardizes on `cn()` (clsx + tailwind-merge) and uses it almost everywhere, but a handful of hot components hand-roll template-literal / array-join class logic, losing conflict-resolution and consistency — and it's not machine-enforced.
- **Fix:** Convert these to `cn(...)`; optionally add a lint rule flagging template-literal `className` containing a ternary.

### 8. `RepeatDialog` state sprawl — 10 `useState` hooks shadowing a `DialogState` type

- **Category:** `component-architecture` `srp`
- **Impact:** 3
- **Breadth:** 1 file (`src/editor/dialogs/RepeatDialog.tsx`, 528 lines — the largest non-vendored component)
- **Fix effort:** M
- **Evidence:** `src/editor/dialogs/RepeatDialog.tsx:223-232` — ten separate `useState` calls (`freq`, `wdays`, `monthly`, `endType`, `endVal`, `intervalNum`, `completionNum`, `completionUnit`, `endCalOpen`, `endCalMonth`); `initState` already returns a single `DialogState` object (`:88`) which is then torn apart into 8 setters (`:238-247`).
- **Problem:** The dialog defines a `DialogState` interface but doesn't hold state as one object, so `initState`/reset logic must fan out into eight setter calls kept in sync by hand — the model-mapping helpers (`buildRepeat`, `defaultWdays`) are cleanly extracted, but the in-component state management is the fragile part.
- **Fix:** Collapse the related fields into a `useReducer` (or a single `DialogState` object with one setter) so `initState` seeds it in one assignment.

### 9. Vendored shadcn `sidebar.tsx` is ~60% unused surface area

- **Category:** `dead-code` `library-fit`
- **Impact:** 2
- **Breadth:** 1 file (`src/components/ui/sidebar.tsx`, 722 lines — the single largest UI file)
- **Fix effort:** S
- **Evidence:** The app imports 10 of ~28 exports (`src/components/Sidebar.tsx:13-24`); `SidebarMenuBadge`, `SidebarMenuAction`, `SidebarMenuSub*`, `SidebarMenuSkeleton`, `SidebarInput`, `SidebarInset`, `SidebarRail`, `SidebarGroupAction`, `SidebarGroupContent`, `SidebarTrigger`, `SidebarFooter` have zero app callers (`grep` outside `ui/sidebar.tsx` → none).
- **Problem:** A 722-line vendored primitive carries a large unused API; `knip.json` explicitly excludes `src/components/ui/**` from export-checks, so this dead surface is invisible to the dead-code gate. (It is tree-shaken from the bundle, so runtime impact is nil — hence low impact; the cost is maintenance/reading surface.)
- **Fix:** Either accept it as standard whole-component vendoring (document that decision on the file) or trim to the used subset; if trimmed, drop the knip exclusion so future drift is caught.

---

**Note on what's deliberately right:** the `model/`→UI boundary (lint-enforced, verified clean), the `responsive-modal` dialog/drawer switch, virtualized agenda/search lists, selector-based store reads, the swipe-to-delete custom gesture, and the jsx-a11y `recommended`/Tailwind-v4 toolchain choices are all correct as-is and should not be "fixed."
