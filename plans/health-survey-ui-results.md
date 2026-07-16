# UI-Layer Health Survey — Results

Surveyed at origin/main @ `b95e799` (2026-07-16). Survey prompt: [health-survey-ui.md](health-survey-ui.md).

## 1. Health verdict

This is one of the healthiest UI layers surveyed: quality gates all pass (build ✅, lint 0 errors ✅, 373 tests ✅, knip clean ✅), every store subscription uses a selector, long lists are virtualized, routes/editor/search are code-split, the React Compiler is enabled with the matching lint preset, and styling follows a documented token system that greps confirm is actually followed. The **worst two areas** are `editor/dialogs/` — where duration/date domain math, a duplicated number+unit widget, and duplicated segmented-control styling have accumulated inside dialog components — and the **vault-removal flow**, the one destructive action that discards unsynced data with no confirmation. The **single biggest structural theme** is that the codebase has excellent shared abstractions (`occurrenceActions`, `responsive-modal`, `occurrence-variants`, `model/`) but a handful of newer features stopped reaching for them, re-implementing store commits, duration serialization, and chip styling locally instead. Test coverage is the other systemic gap: the RTL harness exists and is used well in `editor/`, but `components/`, the calendar views, and search have zero component tests. Nothing found rises above impact 6; there is no systemic rot.

## 2. Coverage statement

- **Read closely:** app shell (`__root.tsx`, `_app.tsx`, `main.tsx` sampled), `index.css` + theme system, `store.ts`, `occurrenceActions.ts`, all 10 shared components in `components/`, custom `components/ui/` additions (responsive-modal, surface-button, icon-button, occurrence-variants, TimeWheels, drawer, button), the 15 largest UI files (AgendaView, DayView, MonthView, RepeatDialog, DurationDialog, ItemsList, EntryEditor, EditorShell, useEntryEditor, OccurrenceCard, Sidebar, SettingsDialog, VaultSettings, EntryBody, WikilinkPopup), calendar row/section components, `search/` (2 of 3 files), routes (`entry.$slug`, `auth.callback`, `_app`), 5 of 9 hooks, `vite.config.ts`, `eslint.config.js`.
- **Sampled:** remaining `components/ui/` shadcn primitives (sidebar.tsx confirmed near-stock), OccurrenceList/OverdueSection/BacklogView, CoachTour (first 100 lines), AddVaultWizard (GitHub step).
- **Out of scope:** `model/`, `storage/` internals (checked only at the UI boundary), `worker/`, `fileIO.ts`, `wikilinks.ts`, `scripts/`. `debug/` skipped as dev-only (deliberately a11y-exempted in lint config — verified the exemption comment matches reality: it's never linked from the shipped app shell).
- **Quality gates:** `pnpm run build` ✅; `pnpm run lint` ✅ 0 errors / 2 warnings (both the known-unfixable `react-hooks/incompatible-library` on `useVirtualizer`); `pnpm test` ✅ 373/373; `pnpm knip` ✅ clean. Worker types were regenerated (`cf-typegen`) before linting per repo instructions.
- **Fraction:** roughly 70–75 % of the UI layer read line-by-line; the rest sampled. **Unverified:** `editor/cm/*` CodeMirror decoration internals (~800 lines, only entry points read) and the four smaller dialogs (DatePicker/TimePicker/Priority/SeriesDelete) — spot-checks suggest they match the read dialogs' quality, but not verified.

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Component architecture & boundaries | **findings: #1, #2, #9** |
| 2 | Styling system consistency | **findings: #5, #7** — otherwise exceptionally strong (documented convention in `index.css`, greps confirm ~zero hex/palette leakage outside 3 spots) |
| 3 | UX states & accessibility | **findings: #3** (+ two sub-minor: `ui/calendar.tsx` nav button and the `entry.$slug` not-found back button lack aria-labels — 18 of 20 icon buttons are labelled) |
| 4 | Security (UI-facing) | **clean** — threat model: vault markdown/frontmatter/wikilinks and GitHub-sourced content render only through React text nodes and CM6 text decorations; zero `dangerouslySetInnerHTML`/`innerHTML`; the only two `href`s are static GitHub URLs with correct `rel="noopener noreferrer"`; search params validated in `validateSearch`; build injects a strict CSP (`script-src 'self'`) |
| 5 | Code health & DRY | **findings: #4, #8** — knip clean, no `any` outside generated files |
| 6 | React performance | **clean** — all `useStore` calls use selectors (grep: zero bare `useStore()`), agenda/search virtualized, editor/search/settings lazy-loaded, React Compiler + hand-written domain-aware memo comparators where the compiler can't help (DaySection) |
| 7 | UI toolchain & feedback loops | **findings: #6, #10** — the config itself is a model: jsx-a11y recommended, react-hooks `recommended-latest` (compiler diagnostics), full type-checked TS, machine-enforced barrel/layer boundaries |
| 8 | UI dependencies & library fit | **clean** — no overlapping libraries (one icon set, one animation approach, one modal stack); **keep-custom verdicts**: `TimeWheels` (snap-scroll wheel with listbox a11y — no maintained radix equivalent), swipe-to-delete in `OccurrenceRow` (needs `passive:false` touchmove, correctly reasoned), `responsive-modal` (dialog/drawer switcher — this *is* the shadcn-recommended pattern), `CoachTour` (4 static steps; a tour library would be heavier than the component) |

## 4. Findings

### #1 — Store-commit and entity-construction logic inline in `ItemsList`

`component-architecture` `srp` · **Impact 5** · **Breadth 1** (grep `commitNext` in `.tsx`: only this file) · **Effort S**

- **Evidence:** `src/editor/ItemsList.tsx:201` — `commitNext({ items: [...allItems, newOcc], roots: getRoots() }, [occ.fileSlug])`, with `id: crypto.randomUUID()` constructing an `OccurrenceEntry` in the component (lines 187–200).
- **Problem:** the "re-open a done occurrence" operation builds store entities and commits them directly inside a React component, while every sibling operation (toggle, delete-with-undo) lives in `occurrenceActions.ts` — this is the only place in the UI that bypasses that layer.
- **Fix:** move `redoItem`'s store logic into `occurrenceActions.ts` (e.g. `reopenOcc(occ)`) beside `toggleOccDone`.

### #2 — Duration/date domain math implemented inside `DurationDialog`

`component-architecture` `dry` · **Impact 4** · **Breadth 2** (grep: `serialise(`/`endDateToDuration` in `DurationDialog.tsx`; `serialiseInterval` already exists in `model/repeat.ts`) · **Effort S**

- **Evidence:** `src/editor/dialogs/DurationDialog.tsx:62` — `` if (days % 365 === 0) { const y = days / 365; return `${y} ${y === 1 ? 'year'  : 'years'}` } ``
- **Problem:** `endDateToDuration`, `endDateTimeToDuration`, `fmtDurationCompact`, and a local `serialise` (duplicating `model`'s exported `serialiseInterval`) encode calendar-approximation rules (365-day years, 30-day months) inside a dialog, where they can silently diverge from `model/duration.ts`.
- **Fix:** move the four pure converters into `model/duration.ts` / `format.ts` and delete the local `serialise` in favor of `serialiseInterval`.

### #3 — "Remove vault" discards unsynced changes with no confirmation

`ux` · **Impact 6** · **Breadth 1** · **Effort S**

- **Evidence:** `src/components/VaultSettings.tsx:141` — `onClick={() => removeVault(vault.id)}`; `removeVault` calls `cacheDeleteAll(id)` (`src/storage/vaultRegistry.ts:315`), which drops the IndexedDB cache including dirty, never-synced edits.
- **Problem:** the app's most destructive action is one tap with no confirm and no undo, while the far less destructive entry deletion gets both a confirmation dialog and an undo toast — an inconsistent destructive-action pattern on a data-loss path.
- **Fix:** reuse the existing `alert-dialog`/`DeleteDialog` pattern, and mention pending unsynced changes (`syncDirtyCount`) in the prompt when the vault is active.

### #4 — `allParticipants` derivation copy-pasted into three components

`dry` · **Impact 4** · **Breadth 3** (grep `allParticipants` + read: identical Set-build-and-sort in `Sidebar.tsx:54`, `EntryEditor.tsx:122`, `VaultSettings.tsx:29`) · **Effort S**

- **Evidence:** `src/components/VaultSettings.tsx:29` — `const allParticipants = useMemo(() => { const set = new Set<string>()` … identical body in the other two files.
- **Problem:** the same derived index over `items` is rebuilt (once without memo, in EntryEditor's render body) in three features; a change to participant normalization (e.g. case-folding) must be made three times.
- **Fix:** a shared `useAllParticipants()` hook in `hooks/`, or a derived map computed once in `setData` beside `fom`/`backlinks`.

### #5 — Raw Tailwind palette colors bypass the theme system in 3 places

`styling` `a11y` · **Impact 4** · **Breadth 3** (grep `(text|bg|border)-(rose|yellow|indigo|…)-[0-9]` excluding `debug/`: exactly 3 hits) · **Effort S**

- **Evidence:** `src/calendar/OverdueSection.tsx:18` — `'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-yellow-500',`; also `src/components/ui/badge.tsx:13` (`bg-indigo-500/15 text-indigo-400`) and `src/routes/_app.entry.$slug.tsx:56` (`text-rose-400`).
- **Problem:** these fixed palette colors ignore the six-theme token system (violating `index.css` convention §3) and have poor contrast on the three light themes — `text-yellow-500` for the "Overdue" heading is near-illegible on Solarized Light, and semantic tokens (`--warning`, `--primary`, `--destructive`) already exist for all three.
- **Fix:** swap to `text-warning`, a token-based badge variant, and a token color for the favorited heart.

### #6 — No component tests outside `editor/`, despite a working harness

`testing` `toolchain` · **Impact 5** · **Breadth ~25 est.** (find `*.test.*`: `components/` 0 of 10 components, `calendar/` 0 component tests — only 2 pure-helper tests, `search/` 0, `onboarding/` 0, `hooks/` 0; `editor/` has 7) · **Effort L**

- **Evidence:** `find src -name "*.test.*"` → `3 src, 2 src/calendar, 5 src/editor, 1 src/editor/cm, 1 src/editor/dialogs, 11 src/model/__tests__, …` — nothing under `src/components` or `src/search`.
- **Problem:** the RTL + jsdom setup exists and works (`EditorShell.test.tsx`, `RepeatDialog.test.tsx` prove the pattern), but the most-reused component (`OccurrenceCard` — rendered by agenda, day, search, wikilink popup, and items list) and the entire calendar/search surface have zero regression coverage; the DaySection `propsAreEqual` comparator and `ItemsList` sort/exit-animation logic are exactly the kind of logic that silently breaks.
- **Fix:** start with `OccurrenceCard` (prop-matrix render test) and `DaySection.propsAreEqual`; grow outward from the highest-fan-in components rather than aiming for blanket coverage.

### #7 — Segmented-pill control styling duplicated instead of a `cva` variant

`styling` `dry` · **Impact 3** · **Breadth 2** (grep `data-[state=on]:bg-background`: `EntryEditor.tsx:245`, `DurationDialog.tsx:208`; container string `rounded-full p-0.75 border border-input` duplicated at both call sites too) · **Effort S**

- **Evidence:** `src/editor/dialogs/DurationDialog.tsx:208` — `'data-[state=on]:bg-background data-[state=on]:text-secondary-foreground data-[state=on]:[box-shadow:0_1px_4px_rgb(0_0_0/.35)]',`
- **Problem:** the app's signature segmented control (type selector, interval/end-date tabs) is two hand-copied multi-line class strings; the project's own convention (`index.css` §2) says repeated variant patterns become `cva` in `components/ui/` — RepeatDialog's hand-styled option buttons (lines 379–390) show a third spot already drifting from the pattern.
- **Fix:** a `segmentedGroup`/`segmentedItem` cva pair in `components/ui/` used by both ToggleGroups.

### #8 — "Number + unit" input block triplicated across dialogs

`dry` · **Impact 3** · **Breadth 2** (3 sites: RepeatDialog lines 307–332 and 442–467, DurationDialog lines 240–258 — same `value={n === 0 ? '' : n}`, `onFocus select`, `Math.max(1, parseInt)`, unit `Select`) · **Effort S**

- **Evidence:** `src/editor/dialogs/RepeatDialog.tsx:318` — `setIntervalNum(Math.max(1, parseInt(val, 10) || 1));` with the near-identical block at line 453 (`setCompletionNum(...)`) and DurationDialog:248.
- **Problem:** three hand-copied ~20-line "repeats every N units" widgets with subtly independent clamping/empty-state logic — a fix to one (e.g. the `0`-means-empty dance) won't reach the others.
- **Fix:** extract a `NumberUnitInput` component in `editor/dialogs/` (or `components/ui/`) taking `{n, unit, units, onChange}`.

### #9 — Imperative ref-channel plumbing between `useEntryEditor` and `EntryEditor`

`component-architecture` · **Impact 4** · **Breadth 3** (`useEntryEditor.ts`, `EditorShell.tsx`, `EntryEditor.tsx` — grep `getBodyRef|flushPendingLinksRef`) · **Effort M**

- **Evidence:** `src/editor/EntryEditor.tsx:92` — `useEffect(() => { if (getBodyRef) getBodyRef.current = () => viewRef.current?.state.doc.toString().trimEnd() ?? '' })` (an every-render effect assigning a mutable ref supplied by the hook two layers up).
- **Problem:** two write-back ref channels (`getBodyRef`, `flushPendingLinksRef`) threaded through a 17-prop component let the hook reach into CM6 state imperatively; it works, but it's the least declarative seam in the codebase and each new "the hook needs something from the editor" requirement adds another ref prop.
- **Fix:** invert once — have `EntryBody` report the doc through the existing `onChange`/`entryRef` path, or consolidate the channels into a single `editorApiRef` handle registered by `EntryBody`.

### #10 — React 19 modernization rules absent from an otherwise-complete lint setup

`toolchain` · **Impact 2** · **Breadth 18** (grep `forwardRef` in `src`: 18 files; dry run below) · **Effort M** (largely auto-fixable)

- **Evidence:** dry-run of the installed `@eslint-react/eslint-plugin` `recommended-type-checked` preset via a temporary config (removed afterwards): **115 findings — 68 `no-forward-ref`, 7 `no-use-context`, 3 `no-context-provider`**, rest noise/overlap with already-enabled rules.
- **Problem:** the project targets React 19 (`reactCompilerPreset({ target: '19' })` in vite.config) where `forwardRef` is obsolete (ref-as-prop), but the curated rule list doesn't include the modernization rules, so new components keep copying the legacy pattern from `components/ui/`.
- **Fix:** enable `@eslint-react/no-forward-ref` (autofix handles most of the 68) — or explicitly document the "stay on forwardRef until shadcn upstream migrates" decision; either resolves the drift. No Tailwind class-sorting plugin is installed, and adding one is **not** recommended: class strings here are hand-grouped semantically (layout / state / theme) with explanatory comments, which sorting would destroy.

---

**Known suspects:** none were listed, so no suspect verdicts to report.

**Sub-minor observations** (not top-10 worthy): `SyncButton` styles status colors via `style={{ color: 'var(--warning)' }}` where `text-warning` exists (works, just off-convention); `drawer.tsx`'s comment "No drag handle" sits directly above the code that renders one; `DayView.tsx` ends with a stale comment referencing a no-longer-existing `App.tsx`.
