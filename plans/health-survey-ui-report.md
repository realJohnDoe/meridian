# Meridian — UI-Layer Health Survey (Report)

_Survey of the UI layer per `plans/health-survey-ui.md`. All three quality gates run green at time of
writing: build ✅ · lint ✅ (0 errors, 2 documented warnings) · test ✅ (53 files, 642 tests). `knip` also
run and clean. Branch `claude/ui-layer-health-survey-292999`._

## 1. Health verdict

This is an unusually well-tended UI layer: the styling system is genuinely single-source (8 themes,
~10 non-token color classes in the whole tree, all of them upstream shadcn overlays), security is
clean by inspection, the store/view-state split holds exactly as documented, and the architectural
invariants in `CLAUDE.md` are machine-enforced by a serious import-boundary lint config. The weakest
areas are **`src/editor/dialogs/`** — where `RepeatDialog.tsx` (543 lines) carries both a hand-rolled
second copy of `DatePickerDialog` and ~130 lines of `Repeat`↔UI-state marshalling that belongs in
`model/repeat.ts` — and **the `components/ui/` + toolchain boundary**, where 11 first-party components
and every route are excluded from coverage under a "shadcn primitives and route registration are
boilerplate" rationale that stopped being true as the directory grew.

The single structural theme running through nearly every finding: **the load-bearing invariants live
in comments, not in the toolchain.** The comments are excellent — often the best documentation in a
repo this size — but they assert contracts nothing checks. So when the ground moved, they silently
went stale: `babel-plugin-react-compiler` was switched on and MonthGrid's "this partition reruns on
every render, so `new Date()` here is exactly as fresh as the wall clock" is now false;
`components/ui/` accumulated first-party components while the coverage exclusion still calls it
boilerplate; the "430px column" that `--backdrop` and `drawer.tsx` both document no longer exists;
`resetCalendarViewState()` was written as the single vault-change entry point and only the tests ever
adopted it. The fix pattern is consistent — promote each comment to a rule, a test, or a single API —
and finding #1 alone would mechanically catch two of the others.

## 2. Coverage statement

**Read closely (full file):** `routes/` — `__root.tsx`, `_app.tsx`, all 6 page routes,
`-entryRoute.ts`, `-entryTopbar.tsx`, `index.ts`, `main.tsx`. `components/` — every file except
`AddVaultWizard.tsx` (skimmed). All 11 first-party `components/ui/` files, plus `button`, `badge`,
`input`, `checkbox`, `dialog`, `drawer`, and the load-bearing parts of `sidebar.tsx`. `calendar/` —
`AgendaView`, `DayPane`, `MonthGrid`, `MonthView`, `OccurrenceList`, `OccurrenceRow`, `BacklogView`,
`NotesView`, `ListEmptyState`, `AgendaHeaderRow`, `useCalendarFilter`, `useExpandWithMultiday`,
`viewState`. `editor/` — `EntryEditor`, `EditorShell`, `EntryBody`, `useEntryEditor`,
`useEntryDialogs`, `DialogStack`, `RepeatDialog`, `DatePickerDialog`, `TimePickerDialog`,
`PriorityDrawer`, `DeleteDialog`, `SeriesDeleteDialog`, `ItemsList` (first 140 lines + exported sort
key). All of `search/`, all of `onboarding/`, all of `hooks/`, `store.ts`, `index.css` (all 929 lines).

**Toolchain read in full:** `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`,
`components.json`, `knip.json`, `package.json` UI dependency inventory. Installed rule sets probed
directly from `node_modules` (not from memory) for `@eslint-react/eslint-plugin`,
`eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`; `@eslint-react`'s `recommended-type-checked`
preset dry-run against `src/` via a temporary config (removed afterwards, tree verified clean).

**Sampled only:** `AddVaultWizard.tsx`, `DurationDialog.tsx`, `NumberUnitInput.tsx`,
`ParticipantsRow.tsx`, `ListedOnRow.tsx`, `WikilinkPopup.tsx`, `ItemsList.tsx` lines 140–380,
`DayView.tsx`, `useCarousel.ts`, `useVirtualFlip.ts`, `useAgendaScrollRestore.ts`, the remaining 22
shadcn-registry files in `components/ui/`.

**Excluded as out of scope:** `model/`, `storage/`, `worker/`, `fileIO.ts`, `wikilinks.ts`,
`types.ts`, `lib/matching.ts`, `lib/vaultStorage.ts` — non-UI internals. `editor/cm/*` parsing
internals excluded except at the rendering boundary (`markdownFormatting.ts`'s widget `toDOM`,
`wikilinkDecorations.ts`, `taskDecorations.ts` — all read for the security threat model).
`src/debug/` sampled but not audited: dev-only tooling, never shipped, and `eslint.config.js`
deliberately disables jsx-a11y there — its three `bg-[#hex]` classes are the only hardcoded colors in
the tree and are correctly not a finding.

**Fraction:** roughly 70–75% of UI-layer lines read in full, ~95% at least sampled. No UI directory
skipped.

**Gates (all run once):** `pnpm run build` **pass** (exit 0; one chunk-size warning, `editor` chunk
725 kB / 245 kB gzip — correctly code-split behind the entry route, inherent CM6 weight, not reported
as a finding). `pnpm run lint` **pass** (exit 0, 2 warnings, both the documented-and-expected
`react-hooks/incompatible-library` on the two virtualizers). `pnpm test` **pass** (53 files, 642
tests). `pnpm knip` **pass** (no unused files or exports). Worker types regenerated before linting as
instructed; no spurious type-resolution flood.

**Unverified — flagging for the record:**

- `AddVaultWizard.tsx`'s GitHub-connect flow has multi-step async state (token save, repo pick, OAuth
  return) that was only skimmed for error/loading states; it appears to handle both, but not every
  branch was traced.
- `useCarousel.ts` + `snapCarousel.ts` + Embla interaction under rapid swipes — the unit tests cover
  the pure math, not the integration.
- No runtime render counts were measured; all performance findings are static reasoning plus the
  build artifact, not profiling.

## 3. Category verdicts

| #   | Category                            | Verdict                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Component Architecture & Boundaries | **findings: #3, #5, #7, #8**                                                                                                                                                                                                                                                                                                 |
| 2   | Styling System Consistency          | **clean** — full scan executed: 8 non-token color classes tree-wide (7 are upstream shadcn `bg-black/80` overlays), 11 arbitrary-value classes total, `cn` used universally, `cva` used where warranted, no `@apply`, no raw CSS file outside `index.css`. Two sub-threshold items noted below but not worth a report entry. |
| 3   | UX States & Accessibility           | **findings: #6, #9**                                                                                                                                                                                                                                                                                                         |
| 4   | Security (UI-facing)                | **clean** — see threat model below.                                                                                                                                                                                                                                                                                          |
| 5   | Code Health & DRY                   | **findings: #7, #10**                                                                                                                                                                                                                                                                                                        |
| 6   | React Performance                   | **findings: #3, #4**                                                                                                                                                                                                                                                                                                         |
| 7   | UI Toolchain & Feedback Loops       | **findings: #1, #2, #3**                                                                                                                                                                                                                                                                                                     |
| 8   | UI Dependencies & Library Fit       | **findings: #6, #7, #9** — plus explicit keep-custom verdicts below.                                                                                                                                                                                                                                                         |

### Category 4 threat model

File-supplied content that reaches the DOM is (a) frontmatter values — title, participants, tags,
duration, priority — rendered as React text children; (b) Markdown body text rendered through
CodeMirror 6 decorations; (c) wikilink targets and file slugs; (d) inline `- [ ]` task text.

Findings: zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, or
`insertAdjacentHTML` anywhere in `src/`. Every CM6 widget writes user content via `span.textContent`,
never markup (`markdownFormatting.ts:61,83,95`). Every `href` in the app is a compile-time constant;
the one dynamic navigation is scheme-allowlisted before opening — `const safe =
/^(https?|mailto):/i.test(this.url)` — and uses `window.open(this.url, '_blank',
'noopener,noreferrer')`. The one static `target="_blank"` carries `rel="noopener noreferrer"`. The
build injects a strict CSP with `script-src 'self'` and `object-src 'none'`. Nothing to report.

### Category 8 keep-custom verdicts (status quo is correct)

- **`TimeWheels`** — a scroll-snap time wheel with momentum-settle recovery has no Radix equivalent
  and the touch behavior is domain-specific; keep.
- **`FlipList`** — WAAPI FLIP with an explicit, documented reason for not using CSS transitions; no
  maintained primitive covers the virtualizer-aware variant; keep.
- **`floating-combobox-list`** — deliberately portals _outside_ Radix's layer system with a
  documented `pointer-events` fix for exactly that; a Radix Popover would reintroduce the problem it
  solves; keep.
- **`IconButton` / `SurfaceButton` / `DimmableCard`** — thin, well-scoped wrappers over shadcn
  `Button`/`Card`, not duplicates.
- `embla-carousel-react`, `vaul`, `cmdk`, `react-day-picker`, `next-themes`, `sonner`,
  `tailwind-merge`, `class-variance-authority` all earn their place with a single clear owner each;
  no two libraries overlap. One icon set (`lucide-react`), one animation approach.

### Sub-threshold styling items (noted, not reported)

`decoration-indigo-400/60` bypasses the theme in 2 files (`TagChip.tsx:35`,
`wikilinkDecorations.ts:55`) and `checkbox.tsx:32` uses `stroke-white` where a `--*-foreground` token
exists; and `index.css`'s `.meridian` block restates `:root` verbatim for ~57 lines while the three
light themes each repeat identical `--shadow-float`/`--shadow-float-focus` pairs. Both are real but
are single-callsite/single-file items that belong in a lint rule or a cleanup pass.

Also noted and not reported: the "430px column" documented in `index.css:117` and `drawer.tsx:27` no
longer exists — `#app` carries `margin: 0 auto` with no `max-width` to center against, and views cap
at `lg:max-w-3xl`. Cosmetic staleness, but a further instance of the report's main theme.

## 4. Findings

### Summary table

| #   | Finding                                                                                  | Recommended model                 |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | `@eslint-react` used as a 13-rule subset of an installed 66-rule preset                  | **Sonnet 5**                      |
| 2   | `components/ui/` + `routes/` exempt from coverage as "boilerplate"                       | **Opus 5 in plan mode, multi-PR** |
| 3   | React Compiler enabled; render-phase impurity and stale "reruns every render" rationales | **Opus 5**                        |
| 4   | Backlog and Notes render every row unvirtualized                                         | **Opus 5**                        |
| 5   | Calendar cache-reset API fragmented; single entry point is test-only and has drifted     | **Sonnet 5**                      |
| 6   | Overlay dismissal handled ad hoc — one overlay has none, another duplicates Radix        | **Opus 5**                        |
| 7   | `RepeatDialog` hand-rolls a second date picker; `DatePickerDialog.forceDialog` is dead   | **Sonnet 5**                      |
| 8   | Repeat/series domain rules embedded in editor components                                 | **Opus 5**                        |
| 9   | Global `Cmd/Ctrl+B` steals bold inside the Markdown editor                               | **Haiku 4.5**                     |
| 10  | Duplicated UI constants and dead `data-tour` markup                                      | **Haiku 4.5**                     |

### Sequencing notes

- Land **#1 before #3** — enabling `@eslint-react/purity` surfaces two of the exact sites #3 fixes,
  so the rule becomes the regression test rather than a second pass over the same files.
- Land **#3 before #5** — both touch `calendar/useExpandWithMultiday.ts`, and #3 changes where the
  cache write happens, which is what #5's consolidated reset API has to reset.
- Land **#7 before #8** — both touch `RepeatDialog.tsx`; deleting the inline picker first drops ~75
  lines, so the extraction in #8 works on a much smaller file.
- Land **#10 after #8** — both touch `EntryEditor.tsx`, and #8 rewrites the region around the
  duplicated `PRIORITY_CLASS`.

---

### 2. `components/ui/` and `routes/` are exempt from coverage as "boilerplate" — but a third of `components/ui/` is first-party

- **Category** `testing` `toolchain`
- **Impact** 6
- **Breadth** 11 first-party files in `components/ui/` (of 33 total, counted via `git ls-files
'src/components/ui/*'`) + 16 files in `src/routes/`; 78 of 88 non-test, non-debug `.tsx` files have
  no direct test (counted by globbing for a sibling `.test.tsx`)
- **Recommended model** **Opus 5 in plan mode, for a plan spanning multiple PRs.** Two reasons this
  can't be handed down. First it's a product decision the user owns: which of the 11 first-party
  primitives deserve a coverage floor versus which stay exempt, and whether route components get a
  smoke-test harness at all. Second, the hazard in the mechanical part fails silently:
  `ResponsiveModal` branches on `useMediaQuery("(min-width: 768px)")`, and jsdom's `matchMedia`
  returns `matches: false` with no listener support unless stubbed — a test written without that stub
  passes while only ever exercising the drawer branch, so the desktop Dialog path stays untested _and
  looks covered_. Same trap for `IconButton`'s `hit="expand"` mode, which is a `::before`
  pseudo-element that jsdom does not compute, so a naive assertion on hit-area size passes vacuously.
- **Evidence** `vitest.config.ts`:

  ```
        // shadcn primitives and route registration are boilerplate, not
        // application logic worth a coverage floor.
        'src/components/ui/**',
        'src/routes/**',
  ```

  But `components/ui/` now holds 11 files that are not shadcn primitives: `TimeWheels.tsx`,
  `responsive-modal.tsx`, `icon-button.tsx`, `surface-button.tsx`, `dimmable-card.tsx`,
  `segmented-group.tsx`, `occurrence-variants.ts`, `continuation-chevron.tsx`,
  `floating-combobox-list.tsx`, `entry-skeleton.tsx`, `page-skeleton.tsx`. `TimeWheels.tsx` alone
  carries a documented geometry contract with no test behind it:

  ```
  // The column geometry is load-bearing and must stay consistent: the viewport is
  ```

  ```
  // exactly three rows tall (h-30 = 120px), rows and spacers are one row (h-10),
  ```

- **Problem** The exclusion's stated rationale ("boilerplate") is false for a third of the directory,
  so the most reused, hardest-to-eyeball UI logic in the app — the responsive drawer/dialog switch
  every property dialog depends on, the touch-target strategy, the scroll-wheel picker — is
  structurally invisible to both the coverage floor and the test suite.
- **Fix** Split the exclusion: keep `src/components/ui/**` excluded only for the shadcn-registry files
  (an explicit list, or move first-party ones to `src/components/primitives/`), then add RTL tests for
  `ResponsiveModal`, `IconButton`, and `TimeWheels` with a `matchMedia` stub in
  `test-utils/setup.ts`.

---

### 3. React Compiler is on; two documented "reruns every render" rationales are now false, and a render-phase cache mutation is unguarded

- **Category** `performance` `component-architecture` `toolchain`
- **Impact** 6
- **Breadth** 3 source files + 2 config files (`grep -rn "use no memo" src` for the opt-outs; `grep -c
memo_cache_sentinel dist/assets/calendar-*.js` to confirm the compiler is live)
- **Recommended model** **Opus 5.** The hazard is that every failure mode here is invisible:
  memoization staleness produces a correct-looking render with an old wall clock, and the LRU
  bookkeeping being skipped produces a _slower_ app, never a wrong one — no build break, no type
  error, no failing test. Worse, the obvious "fix" (wrap the block in `useMemo` to make the
  memoization explicit) makes the staleness permanent instead of fixing it; the right move is to
  decide per site whether the clock should be a ticking `useNow` prop, and to move the cache write out
  of render. That judgement is what sets the tier. If the task instead specifies "route MonthGrid's
  clock through `useNow` like DayPane does, and move the `cacheByWindow` write into a ref-guarded
  effect," Sonnet 5 is sufficient.
- **Evidence** `vite.config.ts` wires the compiler app-wide:

  ```
      babel({ presets: [reactCompilerPreset({ target: '19' })] }),
  ```

  and the built bundle confirms it is actively memoizing — `grep -o "react.memo_cache_sentinel"
dist/assets/calendar-*.js | wc -l` → **41**. Only `AgendaView` and `FileResultsList` opt out (`'use
no memo'`), so `MonthGrid` is compiled. Yet `MonthGrid.tsx:169` still reasons as if it weren't:

  ```
      // Unlike AgendaView/DayPane, this partition isn't inside a useMemo — it
      // reruns on every render — so calling the wall clock directly here is
      // exactly as fresh as occState(o)'s own default below, with no memo
      // dependency to keep honest and no need for a ticking clock.
      const now = new Date()
  ```

  Separately, `calendar/useExpandWithMultiday.ts:57` mutates a module-level `Map` during render, with
  a comment whose stated intent depends on the write happening every call:

  ```
    // Re-set on every call (not just when the result changed) so the map's
    // insertion order tracks recency of use, keeping the LRU eviction below
    // targeted at windows that are actually stale rather than merely unchanged.
    cacheByWindow.delete(key)
    cacheByWindow.set(key, next)
  ```

  Neither `react-hooks/purity` (enabled, `'error'`) nor the enabled `@eslint-react` subset flags any
  of this; `@eslint-react/purity` catches the `new Date()` cases (see #1) and still misses the cache
  write.

- **Problem** The compiler now memoizes blocks whose comments explicitly justify themselves by _not_
  being memoized, so `MonthGrid`'s sort clock freezes until occurrence data changes and the expansion
  cache's LRU-recency bookkeeping is skipped whenever inputs are stable — degrading exactly the
  eviction targeting it was written to guarantee.
- **Fix** Give `MonthGrid` a ticking clock via `useNow` as `DayPane` already does, move the
  `cacheByWindow` write/evict out of the render path (a `useEffect` or a ref-guarded commit), and add
  `<React.StrictMode>` around `<RouterProvider>` in `main.tsx` — currently absent
  (`createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)`) — so dev
  double-rendering surfaces this whole class instead of leaving it to inspection.

---

### 4. Backlog and Notes render every row unvirtualized, for the exact reason the agenda was virtualized

- **Category** `performance` `ux`
- **Impact** 6
- **Breadth** 3 files (`BacklogView.tsx`, `NotesView.tsx`, `calendar/OccurrenceList.tsx` — found by
  grepping which components render `OccurrenceRow` outside `AgendaView`)
- **Recommended model** **Opus 5.** The hazard is a documented incompatibility between the two
  mechanisms: `FlipList`'s own doc comment says _"Don't turn this on inside a virtualizer: it measures
  the list itself and would fight an animated height, one resize notification per frame"_ — and
  `OccurrenceList` wraps its active rows in exactly that `FlipList`. So dropping a `useVirtualizer` in
  naively either loses the swipe-delete glide animation or produces a per-frame resize loop that only
  shows up on a real device under momentum scrolling, never in a test. `AgendaView` already solved
  this with `useVirtualFlip` + `FLIP_KEY_ATTR`, and the fix is to reuse that path, not add a second
  virtualizer — recognising that is the judgement call. Naming `useVirtualFlip` as the required
  mechanism in the task does **not** drop the tier, because the collapsible "Done · N" section also
  has to be reconciled with a flat virtual row list, which is a real restructure of
  `OccurrenceList`'s shape.
- **Evidence** `AgendaView.tsx:64` states the problem this pattern causes:

  ```
    // Counts *rows*, not sections. Section-granular virtualization mounted every
    // row a section owned the moment it entered the viewport, and the overdue
    // section pools every undone past task with no cap — on a large vault that
    // was thousands of OccurrenceRows (each with three touch listeners, two
    // store subscriptions and a backlink lookup) in one synchronous commit.
  ```

  `BacklogView.tsx:26` builds an uncapped list from the whole vault and hands it straight to the
  unvirtualized `OccurrenceList`:

  ```
    const all  = undatedOccs(items, roots).filter(o => occKind(o) === 'task')
    const occs = sortOccs(useParticipantFilteredOccs(all), today)
  ```

  and `OccurrenceList.tsx:23` maps all of them: `{active.map(o => (`. Each `OccurrenceRow` attaches
  three raw touch listeners in an effect and subscribes to `s.roots` and `s.backlinks`.

- **Problem** Backlog is by definition where undated tasks accumulate without bound, so the one view
  most likely to grow to thousands of rows is the one that mounts them all in a single synchronous
  commit — the precise failure the agenda was restructured to avoid.
- **Fix** Reuse `AgendaView`'s row-granular virtualizer + `useVirtualFlip` path in `OccurrenceList`
  (flattening the Done collapsible into the same row list), so both undated views inherit the fix
  rather than growing a second virtualization strategy.

---

### 6. Overlay dismissal is handled ad hoc — the search overlay has none, `useEntryDialogs` duplicates what Radix already does

- **Category** `a11y` `ux` `library-fit`
- **Impact** 6
- **Breadth** 3 files (`search/SearchOverlay.tsx`, `components/SearchBar.tsx`,
  `editor/useEntryDialogs.ts` — from `grep -rn "Escape|onEscapeKeyDown|keydown" src`, which returns
  every Escape handler in the tree)
- **Recommended model** **Opus 5.** Two hazards, both silent. First, the obvious fix for the search
  overlay — wrap it in a Radix `Dialog` — would regress deliberate behavior: the desktop variant is a
  popover whose backdrop _intentionally_ stops at the sidebar (`sidebarOpen ?
'left-[var(--sidebar-width)]' : 'left-0'`), and Radix's modal Dialog sets `body { pointer-events:
none }`, which `floating-combobox-list.tsx` already documents as silently swallowing clicks for
  anything portalled outside its layer. Second, removing the redundant listener in `useEntryDialogs`
  looks safe but is load-bearing for at least one nesting case — `RepeatDialog`'s nested end-date
  `ResponsiveModal` — and getting it wrong leaves a dialog that renders but no longer closes, which no
  type-check or test catches. Deciding whether to adopt Radix's `Dialog` with `modal={false}` versus
  keeping the hand-rolled layer and adding a scoped `Escape` + backdrop `onClick` is the product
  judgement that sets the tier.
- **Evidence** `SearchOverlay.tsx:91` — the desktop backdrop is click-through-blocking but has no
  dismiss handler:

  ```
        className={cn('fixed inset-y-0 right-0 z-search-backdrop bg-background/80 backdrop-blur-sm pointer-events-auto transition-[left] duration-200 ease-linear', sidebarOpen ? 'left-[var(--sidebar-width)]' : 'left-0')}
  ```

  Its only keyboard handler is `if (e.key === 'Enter' && query) onCreate(query)`. Meanwhile
  `useEntryDialogs.ts:29` installs a global listener that duplicates Radix's built-in
  `onEscapeKeyDown` and fires regardless of which dialog (or nested control) has focus:

  ```
      const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveDialog(null) }
      document.addEventListener('keydown', onKeyDown)
  ```

  Every other overlay in the app — `WikilinkPopup`, `use-floating-combobox`, `MarkdownTaskCard`'s
  inline edit, and all the Radix dialogs — handles Escape correctly and locally.

- **Problem** The search overlay is a full-screen modal layer on mobile with no Escape key, no
  backdrop dismissal, no focus trap and no `aria-modal`, while the editor's dialogs carry a redundant
  document-level Escape that can close a property dialog from inside a nested Select — the same
  concern solved two opposite wrong ways in one codebase.
- **Fix** Give `SearchOverlay` a scoped `Escape` handler and a backdrop `onClick={onClose}` (plus
  `role="dialog"`/`aria-modal` and initial focus on the mobile layer), and delete the `useEntryDialogs`
  global listener in favour of the `onOpenChange` each `ResponsiveModal` already wires.

---

### 8. Repeat and series domain rules are embedded in editor components

- **Category** `component-architecture` `srp`
- **Impact** 6
- **Breadth** 2 files (`editor/dialogs/RepeatDialog.tsx` lines 82–215, `editor/EntryEditor.tsx` lines
  100–142)
- **Recommended model** **Opus 5.** The hazard is that `initState`/`buildRepeat` are a lossy
  round-trip, not a bijection, and the lossiness is deliberate: `initState` reconstructs `monthly:
'weekday-pattern'` only when `s.byweekday && s.bysetpos !== undefined`, and `buildRepeat` re-derives
  `bymonthday`/`bysetpos` from `scheduledDate` rather than from the value it parsed — so a mechanical
  "move these two functions into `model/`" that tidies them into a symmetric pair changes which
  `Repeat` values survive an open-and-Set cycle. That breaks recurring-series expansion for existing
  vault files, which surfaces as wrong dates on the calendar, not as a test failure —
  `RepeatDialog.test.tsx` exercises the UI, not the round-trip. The extraction has to preserve the
  asymmetry exactly and add round-trip tests in `model/`. `EntryEditor`'s share is simpler but has its
  own trap: `handlePromoteTask` calls `saveNode(...)` and `navigate(...)` directly from the component,
  and the navigation depends on `titleToSlug(title)` matching what `save.ts` independently computes.
- **Evidence** `RepeatDialog.tsx:136` reverse-engineers the domain spec inside the dialog:

  ```
    // Scheduled repeat: reverse-engineer state from the flat spec
    const s = repeat

    // Determine monthly mode
    let monthly: MonthlyMode = 'same-day'
    if (s.byweekday && s.bysetpos !== undefined) monthly = 'weekday-pattern'
  ```

  and `EntryEditor.tsx:126` derives series semantics inline in the render body:

  ```
    const parentSeries = item?.ownerId ? items.find(i => isSeries(i) && i.id === item.ownerId) : null
    const isRecur = !!(item && item.ownerId)
    const seriesRepeat = (parentSeries && isSeries(parentSeries)) ? parentSeries.repeat : null
    const isScheduled = !!(item && seriesRepeat?.type === 'schedule')
    const isAfterCompletion = !!(item && seriesRepeat?.type === 'after_completion')
  ```

  `model/index.ts` already owns the neighbouring primitives — `export { parseInterval,
serialiseInterval, monthlyWeekdaySpec } from './repeat'` — so the boundary exists and this logic
  sits on the wrong side of it.

- **Problem** Recurrence semantics — which `Repeat` shapes are representable, how a series' scope
  options are derived — live in a dialog and a render body rather than `model/`, so they can only be
  tested through the UI and cannot be reused by the other surfaces that need the same rules.
- **Fix** Move `initState`/`buildRepeat` into `model/repeat.ts` as an explicit
  `repeatToForm`/`formToRepeat` pair with round-trip tests over the existing YAML fixtures, and lift
  `EntryEditor`'s series derivations into `useEntryEditor` (or a `model/` selector), leaving the
  component reading booleans.
