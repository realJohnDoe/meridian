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
