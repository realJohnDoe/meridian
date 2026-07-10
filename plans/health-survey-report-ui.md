# UI-Layer Health Survey — Meridian

## 1. Health verdict

The UI layer is in genuinely good shape — unusually disciplined: a documented oklch token system with six themes, a `cva`-based occurrence-variant system shared across all views, virtualized agenda rendering, React Compiler + route code-splitting wired in, fine-grained zustand selectors everywhere (zero whole-store subscriptions found), and error toasts on every sync/save/vault failure path. Security is clean: no `innerHTML`, file content renders only as escaped React text, a strict CSP is injected at build, and the single `target="_blank"` carries `rel="noopener noreferrer"`. The worst area by far is **UI test coverage**: of 78 component files, not one has a render test — the only jsdom test in the repo exercises a hook — so every regression class found below ships unguarded. The second-worst area is the **shared primitive inventory (`components/ui/`) and the editor dialogs**, where drift has set in: a dead shadcn `Input` next to nine files of hand-rolled inputs, two divergent scroll-wheel implementations (one dead), and theme-preview swatches that have already drifted from the real tokens. The structural theme running through nearly every finding: **this codebase documents its conventions well but machine-enforces only some of them** — import boundaries and hooks rules are enforced and hold; the styling scale, a11y patterns, and dead-code detection for `components/ui/` are documented-but-unenforced, and that is exactly where the violations cluster.

## 2. Coverage statement

**Read closely** (~25 files): app shell (`routes/__root.tsx`, `routes/_app.tsx`, `routes/_app.entry.$slug.tsx`), `store.ts`, `index.css` (full theme system), all 10 files in `src/components/`, `components/ui/` custom files (`responsive-modal`, `surface-button`, `occurrence-variants`, `TimeWheels`, `ScrollColumn`), editor core (`EntryEditor`, `EditorShell`, `ItemsList`, `useEntryEditor`, `DialogStack`, `save.ts`, `RepeatDialog`), calendar (`DayView`, `AgendaView`, `MonthView`), hooks (`useFlipReorder`, plus barrel), boundary files (`occurrenceActions.ts`, `storeCommit.ts`, `persistencePort.ts`), and the full toolchain (`eslint.config.js`, `vite.config.ts`, `vitest.config.ts`, `knip.json`, `package.json`).

**Sampled**: `search/` (MobileSearchOverlay read, others skimmed — all ≤73 lines), `onboarding/CoachTour.tsx` (head), `debug/` (via lint dry-run only), stock shadcn files in `components/ui/` (import-traced, not line-read), `editor/dialogs/` beyond RepeatDialog (grep-sampled), `editor/cm/` (not read).

**Out of scope**: `model/`, `storage/` internals, `fileIO.ts`, `wikilinks.ts`, `worker/` — non-UI per the brief; their UI boundary (toasts, persistence port) was checked.

This report rests on close reading of roughly **60% of UI-layer code by volume**, with the remainder grep-surveyed. **Unverified**: runtime focus behavior of the drawer/dialog stack on mobile (nested drawers are handled via `forceDialog`, but I didn't drive a browser); the `editor/cm/` CodeMirror decoration layer; touch-gesture hooks (`useHorizontalSwipe`, swipe-delete) on real devices.

**Known suspects**: none were listed.

**Security threat model** (category 4, no finding survived): user/file-supplied content (titles, wikilinks, participants, tags from vault markdown or a GitHub repo) renders exclusively through JSX text nodes; grep found zero `dangerouslySetInnerHTML`/`innerHTML`, all `href`s are constants, and the OAuth token field is `type="password"`. Status quo is correct.

## 3. Findings

### 1. No component test harness in use — 78 components, zero render tests

- **Category:** `testing` `toolchain`
- **Impact:** 6 · **Breadth:** 78 files (`find src -name "*.tsx" | grep -v test`) · **Fix effort:** L
- **Evidence:** `vitest.config.ts` pins `environment: 'node',` and its coverage floors guard only non-UI modules: `'src/model/collapse.ts': { statements: 90, branches: 80, functions: 95, lines: 90 },`. `@testing-library/react` 16.3 and `jsdom` are installed, but `grep -rl "@testing-library" src` matches exactly one file — `src/editor/useEntryDialogs.test.ts`, a hook test.
- **Problem:** The entire rendered UI — dialogs, editor, calendar views, undo toasts — has no automated regression net, so behavior like the delete-undo flow in `occurrenceActions.ts` or `RepeatDialog`'s state reverse-engineering can only break silently.
- **Fix:** Stand up an RTL smoke suite for the highest-risk flows first (EntryEditor save/autosave, RepeatDialog round-trip, delete+undo toast), and add a coverage floor for `src/editor/` once it exists.

### 3. Arbitrary pixel values bypass the documented type/spacing scale — including duplicates of tokens that already exist

- **Category:** `styling` `toolchain`
- **Impact:** 5 · **Breadth:** 15 files for font sizes (`grep -rlE "text-\[[0-9.]+px\]"`); 86 font-size + 70 spacing occurrences · **Fix effort:** M
- **Evidence:** `src/index.css:16` declares the convention — `* 4. Spacing/radius             → Tailwind scale snapped to nearest step; no arbitrary px.` — and defines `--text-2xs: 0.625rem;  /* 10px */`. Yet the codebase has 86 `text-[Npx]` occurrences (30× `text-[11px]`, 23× `text-[13px]`, 20× `text-[14px]`), of which 17 are `text-[10px]`/`text-[8px]` — literal duplicates of the existing `text-2xs`/`text-3xs` tokens (e.g. `src/editor/dialogs/RepeatDialog.tsx:275` `className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground"`). Spacing likewise: `src/components/Sidebar.tsx:105` `className="gap-[14px] px-3 py-[11px] h-auto text-[14px] font-medium rounded-none"`.
- **Problem:** The type scale fragments into ad-hoc pixel values (9 distinct sub-`sm` sizes in use), so a future size/density change can't be made in one place — precisely what the convention block was written to prevent.
- **Fix:** Add the missing scale steps as `@theme` tokens (11/13/14px have no Tailwind default), migrate mechanically, and enforce with a lint rule (e.g. `eslint-plugin-tailwindcss`'s `no-arbitrary-value` scoped to font-size/spacing, or better-tailwindcss's equivalent).

### 4. shadcn `Input` is dead code while 9 files hand-roll `<input>` with duplicated class soup

- **Category:** `dry` `library-fit` `dead-code`
- **Impact:** 4 · **Breadth:** 9 files + 1 dead file (`grep -rln "<input"` minus `ui/input.tsx`; `grep -rl "ui/input'"` → 0) · **Fix effort:** M
- **Evidence:** `src/components/ui/input.tsx` has zero importers. Meanwhile `src/editor/dialogs/RepeatDialog.tsx:309` repeats `className="w-20 bg-secondary border border-border/50 focus:border-primary focus:outline-none rounded-lg px-3 h-control text-xs font-mono text-foreground transition-colors"` twice in one file, with near-identical strings in DurationDialog, TimePickerDialog, and a different hand-rolled style in AddVaultWizard (`className="w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"` ×3).
- **Problem:** Two competing text-input stylings drift independently, and the primitive that should own them ships dead weight.
- **Fix:** Either restyle `ui/input.tsx` to the house style and migrate the 9 files to it, or delete it — currently it's the worst of both.

### 5. Two divergent scroll-wheel implementations — the exported one is dead, and `knip.json` makes `components/ui/` invisible to dead-code detection

- **Category:** `dead-code` `dry` `toolchain`
- **Impact:** 4 · **Breadth:** 3 files (ScrollColumn.tsx, TimeWheels.tsx, knip.json; usage traced via `grep -rn "ScrollColumn"`) · **Fix effort:** S
- **Evidence:** `src/components/ui/ScrollColumn.tsx:18` exports a 120-line generic wheel (`export function ScrollColumn<T extends string | number>({`) with **zero importers**; `src/components/ui/TimeWheels.tsx:13` defines its own private 40px-row variant (`function ScrollColumn({ items, value, fmt, onChange }: ScrollColumnProps) {`) with different snap logic. `pnpm knip` exits clean because `knip.json` lists `"src/components/ui/**/*.{ts,tsx}"` as an **entry** pattern — every ui primitive is presumed alive by definition. The dead one also hardcodes `bg-white/5 border border-white/10`, which would break on the three light themes if ever revived.
- **Problem:** A whole directory of primitives is exempt from the repo's own dead-code tooling, and it's already accumulated two dead files (this and `input.tsx`) plus a fork of itself.
- **Fix:** Delete `ScrollColumn.tsx` (or make TimeWheels consume it), and narrow the knip entry to the barrel-consumed surface so unused primitives get flagged.

### 6. Theme-preview swatches hardcode token values — and have already drifted from the real themes

- **Category:** `styling` `dry` `ux`
- **Impact:** 3 · **Breadth:** 2 files · **Fix effort:** S
- **Evidence:** `src/components/SettingsDialog.tsx:87` previews Rosé Pine Dawn's task color as `'#6a8c3a',  // task (olive green)` but `src/index.css:272` defines `--task:         #5b7932;   /* olive green, darkened */`; Solarized's preview says `'#859900',  // task (green)` vs the real `--task: #657400`. (Tokyo Night/Dracula/Tokyo Day still match — this is drift, not a deliberate "base-hue" preview, or it would be consistent.)
- **Problem:** The theme picker shows colors the themes no longer use, and every future theme tweak must be made twice.
- **Fix:** Render each preview button with the theme's own class (`<button className="rose-pine-dawn">` + `bg-task` swatches) so the CSS tokens are the single source.

### 7. `@eslint-react` is installed but only 4 of its 65 recommended rules are enabled — the gap includes a few real-bug classes

- **Category:** `toolchain` `performance`
- **Impact:** 3 · **Breadth:** 38 files flagged by dry-run (most low-value; ~6 real-signal) · **Fix effort:** S
- **Evidence:** `eslint.config.js` enables exactly `'@eslint-react/no-leaked-conditional-rendering': 'error',` plus three others. **Dry-run** of the installed plugin's `recommended-type-checked` preset: 117 problems — but 67 are `no-forward-ref` React-19 modernization nags in stock shadcn files and 7 are `no-use-context` style. The real-signal residue: `web-api-no-leaked-timeout` in `src/calendar/DayView.tsx:139` and `OccurrenceRow.tsx:116`, `web-api-no-leaked-event-listener` in `useFlipReorder.ts:42`, and `no-nested-component-definitions` ×3 in `ui/calendar.tsx`.
- **Problem:** The enabled subset was hand-picked well, but the leak-detection rules (`web-api/*`, `no-nested-component-definitions`) catch genuine unmount-leak bugs this codebase already has in mild form, at near-zero noise.
- **Fix:** Add the `web-api` config and `no-nested-component-definitions`/`static-components` to the existing rule block; skip the full preset (the forwardRef/useContext noise isn't worth it until a React-19 idiom migration is actually wanted).

### 8. Saving with an empty title silently does nothing

- **Category:** `ux` `error-handling`
- **Impact:** 2 · **Breadth:** 2 files (`grep -n "missing-title" src/editor`) · **Fix effort:** S
- **Evidence:** `src/editor/save.ts:105` `if (!title) return 'missing-title'`; the caller `src/editor/useEntryEditor.ts:121` does `if (result === 'saved') goBack()` — on `'missing-title'` the Save button (and every autosave) is a no-op with no feedback.
- **Problem:** A user who types a body but no title and hits "Save occurrence" gets nothing — no navigation, no toast, no field highlight — and may believe the entry was saved.
- **Fix:** On `'missing-title'`, focus the title textarea and show its placeholder in the destructive color (or a small inline hint).

### 9. 19 icon-only controls rely on `title=` alone for their accessible name

- **Category:** `a11y`
- **Impact:** 2 · **Breadth:** 19 occurrences across ~8 files (`grep -rn 'title="' src | grep -v aria-label`) · **Fix effort:** S
- **Evidence:** `src/components/Sidebar.tsx:171` `<button disabled={idx === 0} onClick={() => reorderFavorites(idx, idx - 1)} className="disabled:opacity-30 hover:text-sidebar-foreground" title="Move up"><ChevronUp size={13} /></button>` — while sibling code (e.g. `_app.tsx`'s nav chevrons) correctly uses `aria-label`.
- **Problem:** `title` is unreliable as an accessible name (and invisible on touch), so the same codebase exposes two different icon-button conventions, one of them broken for screen readers.
- **Fix:** Mechanical pass converting icon-only `title=` to `aria-label` (keeping `title` where hover hint is wanted); `jsx-a11y` from finding 2 won't catch this, so fold it into the same sweep.

### 10. The app shell derives view state by string-parsing `pathname` instead of using router matches

- **Category:** `component-architecture`
- **Impact:** 2 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `src/routes/_app.tsx:49` `const isEntryView  = pathname.startsWith('/entry')` followed by `const dvDate = isDayView ? new Date(pathname.split('/')[2] + 'T00:00:00') : null` — hand-parsing route params the router already validated, in the layout component.
- **Problem:** The topbar's identity (label, nav buttons, portal slot) is coupled to URL string shapes; a route rename or a new `/entry-*` path silently breaks it, and date parsing is duplicated against the route's own param handling.
- **Fix:** Use TanStack Router's `useMatches`/child-route context (the `-topbarSlot` portal already exists — let each route declare its topbar instead of the shell inferring it).

---

**Deliberate custom UI that is right (keep-custom verdicts):** the `responsive-modal` dialog/drawer switcher (well-factored over radix + vaul, with the nested-drawer `forceDialog` escape hatch), the `occurrence-variants` cva system (exemplary — documented AA-contrast rationale, one source for three views), `SurfaceButton` (purpose-built to fix exactly the clickable-div problem, and used consistently in calendar views), the DayView timeline and CM6 editor integration (no library covers these), and the agenda virtualizer setup. The dependency set is lean with no overlap — one icon set, one animation approach (`tw-animate-css` + CSS keyframes), and every UI dependency in `package.json` traced to real usage.
