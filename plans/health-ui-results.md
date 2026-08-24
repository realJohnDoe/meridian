# UI-Layer Health Survey — Results

Run date: 2026-08-17 · Branch: `claude/health-ui-surveys-plan-lbo2lf` · Survey: [`surveys/health-ui.md`](./surveys/health-ui.md)

> The survey file itself was updated in a separate commit on this branch — see
> [Survey-file improvements](#survey-file-improvements) at the bottom for what
> changed and why.

---

## 1. Health verdict

The UI layer is in **good structural health** — genuinely above average for a
React codebase of this size. Code splitting is applied at every route boundary,
every long list is virtualized, there are zero whole-store subscriptions, zero
raw clickable `<div>`s in JSX, no `dangerouslySetInnerHTML` anywhere, and all
three quality gates pass clean (`build`, `lint --max-warnings=0`, 1533 tests).
The design system is unusually disciplined: 9 themes over a single token set,
`cn()` used consistently, and only 272 Tailwind arbitrary values of which the
overwhelming majority are `data-[state=…]` variants rather than hardcoded
design values.

The two weakest areas are **`src/editor/`'s row components**
(`ItemsList`/`ListedOnRow`/`ParticipantsRow`) and **the two hand-rolled
overlays** (`search/SearchOverlay`, `onboarding/CoachTour`) — both places where
the app's own excellent primitives (`IconButton`, `ResponsiveModal`) were
bypassed in favour of a bare `<Badge onClick>` or a bare `role="dialog"` div.

The single biggest structural theme is **correctness that lives in a comment
instead of in the toolchain**. This codebase discovers subtle hazards, fixes
them precisely at one site, writes an excellent comment explaining why — and
then does not encode the rule anywhere a machine can check it. The
URL-scheme allowlist (#5) is a case where
the correct pattern exists in exactly one file and the other call sites
silently drifted. Every top finding below is mechanically preventable, and
several come with a dry-run-verified lint rule or settings key.

---

## 2. Coverage statement

**Examined closely** (read in full):
`routes/__root.tsx`, `routes/_app.tsx`, `routes/-topbarSlot.ts`,
`components/OccurrenceCard.tsx`, `components/DimmableCard.tsx`,
`components/KindIcon.tsx`, `components/TagChip.tsx`, `components/VaultChip.tsx`,
`components/SyncButton.tsx`, `components/AppErrorFallback.tsx`,
`components/primitives/icon-button.tsx`,
`components/primitives/responsive-modal.tsx`, `components/ui/card.tsx`,
`components/ui/badge.tsx`, `editor/EntryEditor.tsx`, `editor/ItemsList.tsx`,
`editor/EntryViewOnly.tsx`, `editor/cm/markdownFormatting.ts`,
`calendar/DayPane.tsx`, `calendar/WeekPane.tsx`, `calendar/useNow.ts`,
`hooks/useToday.ts`, `search/SearchOverlay.tsx`, `onboarding/CoachTour.tsx`,
`src/index.css` (all 1036 lines), `eslint.config.js`, `vite.config.ts`,
`vitest.config.ts`, `components.json`, `package.json`.

**Sampled** (targeted greps + partial reads):
the rest of `calendar/` (56 files — sampled `AgendaView`, `MonthGrid`,
`OccurrenceList`, `AllDayOverflowToggle`, `timelineGeometry`), the rest of
`editor/dialogs/` (dialog-primitive inventory across all 11 files, full read of
the `ListedOnRow`/`ParticipantsRow` picker blocks), the rest of `components/ui/`
(inventory + element-type checks), `hooks/`, `search/FileResultsList.tsx`,
`routes/_app.*.tsx` (lazy/Suspense pattern across all 8).

**Excluded as out of scope:** `src/model/`, `src/storage/`, `worker/`,
`src/types.ts`, `src/fileIO.ts`, `src/wikilinks.ts`, `src/store.ts` internals —
non-UI per the survey's scope line. `src/debug/` was scanned but its findings
are **reported as informational only**: it is developer-only tooling that never
ships (and `eslint.config.js` already exempts it from `jsx-a11y`), so its raw
`bg-[#111318]` hexes and missing button types are correctly not defects.

**Fraction of the UI layer:** roughly **55–60%** read closely or in meaningful
part; 100% of UI directories touched at least by targeted search. No UI
directory was skipped.

**Gates run** (all three, after generating the gitignored types):
| Gate | Result |
|---|---|
| `pnpm run build` | **PASS** (also regenerates `routeTree.gen.ts` + worker types) |
| `pnpm run lint` | **PASS** — exit 0, zero warnings at `--max-warnings=0` |
| `pnpm run test` | **PASS** — 102 files / 1494 tests (root) + 3 / 39 (worker) |
| `pnpm run knip` | **PASS** — no dead code, no unused exports |

**Unverified — flagged, not investigated:**
- **`calendar/` beyond the panes.** `AgendaView`/`OccurrenceList`/
  `useVirtualFlip`/`computeAgendaScrollRestore` form a dense
  virtualization + FLIP + scroll-restore subsystem (~900 lines). It is the
  most intricate code in the UI layer and the most likely home for a
  scroll-position or reconciliation bug. Budget did not allow tracing it.
- **`editor/cm/`** (CodeMirror decorations, 8 modules). Only
  `markdownFormatting.ts` was read closely, for the URL sink. The widget
  lifecycle in `ReactWidget.ts` is unverified.
- **`components/ui/` divergence from upstream.** I confirmed the inventory
  (22 components) and checked element types, but did **not** run
  `shadcn diff` against the registry, so I cannot claim the mirror is faithful.
- **Runtime behaviour.** Per CLAUDE.md I did not start a dev server; every
  finding below is from static analysis, dry-runs, or arithmetic.

---

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Component Architecture & Boundaries | **findings: #6** |
| 2 | Styling System Consistency | **findings: #7** |
| 3 | UX States & Accessibility | **findings: #3** |
| 4 | Security (UI-facing) | no open findings |
| 5 | Code Health & DRY | **findings: #6** |
| 6 | React Performance | no open findings |
| 7 | UI Toolchain & Feedback Loops | **findings: #8** |
| 8 | UI Dependencies & Library Fit | **findings: #3** — plus three explicit keep-custom verdicts, below |

**Category 8 — keep-custom verdicts (status quo is correct):**
- **`editor/dialogs/TimeWheels.tsx`** — a scroll-snap time picker. No radix
  primitive covers this; `react-day-picker` is date-only. **Keep custom.**
- **`calendar/snapCarousel.ts` alongside `embla-carousel-react`** — not
  duplication: embla drives the horizontal pane carousel, `snapCarousel` is the
  pure geometry helper the panes use for vertical scroll mirroring. **Keep both.**
- **`components/FlipList.tsx`** — FLIP list transitions over a virtualized list,
  coupled to `@tanstack/react-virtual`'s item measurements. No library does this
  without fighting the virtualizer. **Keep custom.**
- **One icon set** (`lucide-react`), one animation approach (`tw-animate-css` +
  the four `@keyframes` in `index.css`), one dialog stack (radix + vaul via
  `ResponsiveModal`). No redundant dependencies found.

---

## 4. Findings

### Summary table

| # | Title | Category | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 3 | Two hand-rolled overlays with no focus trap | `a11y` `library-fit` | 6 | 2 files | **Opus 5** |
| 6 | DayPane/WeekPane share a copy-pasted timeline scaffold | `dry` `component-architecture` | 5 | 2 files | **Opus 5** |
| 7 | `:root` and `.meridian` duplicate 47 tokens with nothing enforcing it | `styling` `dry` | 3 | 1 file | **Sonnet 5** |
| 8 | 24 raw `<button>`s with no `type` attribute | `toolchain` `code-health` | 2 | 11 files | **Haiku 4.5** |

Ranked by `(impact × breadth) ÷ effort` per the shared convention, with impact
and breadth reported separately so the list can be re-sorted.

**Sequencing note:** #3 and #8 both touch `CoachTour.tsx`; #3 subsumes #8's
fix there, so do #3 first or accept one trivial rebase. All others are
independent.

---

### Finding #3 — Two hand-rolled overlays with no focus trap

- **Category:** `a11y` `library-fit`
- **Impact:** 6
- **Breadth:** 2 files. Found by grepping `role="dialog"` across `src` and
  cross-checking each hit against `ResponsiveModal` usage.
- **Recommended model:** **Opus 5.** This is the survey's canonical
  silent-failure case — "a focus trap that still renders but no longer traps."
  Both overlays will look pixel-identical after any change, and the regression
  is only observable by tabbing. `SearchOverlay` additionally has real
  constraints a naive port breaks: it is mobile-only (`isMobile` branch),
  auto-focuses its input to raise the soft keyboard, and its desktop branch
  deliberately keeps focus *outside* the component
  (`SearchOverlay.tsx:48` — "focus can sit outside this component's tree").
  Porting it to `ResponsiveModal` without preserving that will break desktop
  search. `CoachTour` alone would be Sonnet 5.

**Evidence** — `src/onboarding/CoachTour.tsx:112`:

```
      <div
        role="dialog"
        aria-label={`Tour: ${step.title}`}
        className="fixed z-tour flex max-h-[70dvh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl
```

and `src/search/SearchOverlay.tsx:64`:

```
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
```

Grepping both files for `focus|tabIndex|inert|aria-modal` returns, in total: one
`aria-modal` (SearchOverlay), and one `inputRef.current?.focus()`. There is no
focus trap, no focus restore, and no `inert`/`aria-hidden` on the background in
either file.

**Problem:** `CoachTour` renders at `z-tour` (70 — above literally everything,
per the token's own comment in `index.css:105`) with `role="dialog"` but **no
`aria-modal`** and no focus management at all: a keyboard user tabbing through
the onboarding tour walks straight into the application behind it. `SearchOverlay`
is worse in one specific way — it *claims* `aria-modal="true"`, which tells a
screen reader the background is inert, while Tab still escapes into it. Meanwhile
the repo has `@radix-ui/react-dialog` and `vaul` installed and a tested
`ResponsiveModal` primitive that provides trap, restore, escape and scroll-lock
for free, used by 8 other dialogs.

**Fix:** Port `CoachTour` to `ResponsiveModal` (`forceDialog`, since the tour
card is deliberately positioned rather than a bottom sheet); for
`SearchOverlay`'s mobile branch either port it or add an explicit focus trap
plus focus restore, keeping the desktop branch's out-of-tree focus behaviour
intact.

---

### Finding #6 — DayPane and WeekPane share a copy-pasted timeline scaffold

- **Category:** `dry` `component-architecture`
- **Impact:** 5
- **Breadth:** 2 files (763 lines combined). Measured, not estimated: extracting
  every non-comment source line ≥30 chars from each file and intersecting them
  yields **46 byte-identical lines**.
- **Recommended model:** **Opus 5.** The extraction is a real component-boundary
  decision — the two panes' all-day strips genuinely differ (WeekPane packs
  multiday bars into lanes across 7 columns; DayPane keeps a fixed 2-row
  Google-Calendar-style strip), so the shared unit is the *timeline* scaffold
  only, and drawing that line wrong produces a helper with a boolean `isWeek`
  parameter, which is worse than the duplication. The named hazard: the
  `now-line` positioning differs between them by an inline `left/right`
  override, and `.now-line` in `index.css:1014` hardcodes `left:64px` to match
  `GUTTER = 64` from `timelineGeometry.ts:10` — an extraction that normalizes
  that will silently misplace the current-time indicator in one of the two views.

**Evidence** — the duplication is acknowledged in the source itself,
`src/calendar/WeekPane.tsx:212`:

```
  // offset — see DayPane's own mount effect for the full rationale, mirrored
  // here verbatim.
```

Among the 46 identical lines are the whole scroll-seeding block, the hour-label
loop, and the hour-cell button — e.g. this line appears verbatim in both files:

```
        className={cn(occRadius, 'absolute inset-x-0 bg-muted/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
```

as does:

```
        style={{ top: h * HP + TOP_PAD, left: 0, width: GUTTER - 8, transform: 'translateY(-50%)' }}
```

and the entire scroller registration:

```
  const setScrollerRef = useCallback((el: HTMLDivElement | null) => {
```
```
  const getInitialScrollTopRef = useRef(getInitialScrollTop)
```
```
    el.scrollTop = getInitialScrollTopRef.current()
```

**Problem:** The geometry *constants* were correctly factored into
`timelineGeometry.ts` and the leaf renderers into `TimedBlock`/`OccurrencePill`/
`AllDayOverflowToggle` — but the React scaffold between them was duplicated
instead. A change to scroll-restore, hour-cell keyboard handling, or the
current-time indicator has to be made twice and can be made inconsistently;
git history shows the two files already co-changing.

**Fix:** Extract a `useTimelinePane(key, {registerScroller, onVerticalScroll, getInitialScrollTop, onCreate})`
hook (scroller ref + mount seed + `createAt`/`handleHourClick`) and a
`<TimelineGrid>` component (hour labels + hour cells + now-line, taking the
`left`/`right` inset and the aria-label formatter as props). Leave the two
all-day strips alone — they are legitimately different.

---

### Finding #7 — `:root` and `.meridian` duplicate 47 tokens with nothing enforcing it

- **Category:** `styling` `dry`
- **Impact:** 3
- **Breadth:** 1 file. Counted by parsing both blocks and intersecting the
  declared custom-property names.
- **Recommended model:** **Sonnet 5.** Mechanical, but with a hazard worth
  naming: the dark themes deliberately **omit** `--chip-border`, `--shadow-card`,
  `--shadow-float` and `--shadow-float-focus` so they inherit `:root`'s
  dark-tuned values, while the five light themes override all four. I verified
  this by diffing the token sets across all 9 blocks. Any restructuring that
  moves Meridian's values out of `:root` must re-home those four for the four
  other dark themes, or every dark theme silently loses its card shadows.

**Evidence** — `src/index.css:222`:

```
/* Class-scoped restatement of the Meridian tokens above, mirroring the other
   theme classes below. Needed so an explicitly meridian-scoped element (e.g.
   the theme preview button) renders Meridian's own colors even while another
   theme's class is active on <html> and has overridden :root globally. */
.meridian {
```

**Verification.** The stated rationale is sound — a theme-preview swatch does
need class-scoped tokens. But the *implementation* is a verbatim second copy:
parsing both blocks shows **47 shared token names, currently 0 value drift** —
i.e. they agree today, by hand, with no test or build step checking it. Editing
`:root` without editing `.meridian` (or vice versa) produces a theme-preview
swatch that disagrees with the theme it previews, and nothing fails.

**Problem:** 57 lines of duplicated design tokens whose correctness rests
entirely on whoever edits them remembering the other copy exists — in a file
whose header comment explicitly designates `@theme` + `:root` as the single
source of truth ("6. @theme + :root tokens below are the design system —
extend here, not in components").

**Fix:** Make `.meridian` the only definition and have `<html>` always carry a
theme class (defaulting to `meridian`), leaving `:root` to hold only the
genuinely un-themed tokens (`--control-h`, `--font`, `--th`, `--radius`) and
the derived ones — or, if the pre-hydration fallback in `:root` must stay, add a
check to `src/glossary.test.ts`'s style (parse `index.css`, assert the two
blocks agree) so drift fails the suite instead of shipping.

---

### Finding #8 — 24 raw `<button>`s with no `type` attribute

- **Category:** `toolchain` `code-health`
- **Impact:** 2
- **Breadth:** 11 non-test files, 24 sites. Counted by dry-running
  `@eslint-react/dom-no-missing-button-type`.
- **Recommended model:** **Haiku 4.5.** Purely additive (`type="button"`), and
  the failure mode is loud: the accompanying lint rule fails the build if a site
  is missed. No hazard beyond not skipping `src/debug/`.

**Evidence** — dry-run of `@eslint-react/dom-no-missing-button-type` (a rule the
installed `@eslint-react/eslint-plugin@5.17.3` ships in its `all` preset but
which `recommended-type-checked` does not enable) reports 24 errors across:
`components/AddVaultWizard.tsx`, `components/SettingsDialog.tsx`,
`components/SyncButton.tsx`, `components/ViewFilterButton.tsx`,
`editor/EntryEditor.tsx`, `editor/dialogs/DurationDialog.tsx`,
`editor/dialogs/PriorityDrawer.tsx`, `editor/dialogs/RepeatDialog.tsx`,
`onboarding/CoachTour.tsx`, `routes/auth.callback.tsx`, and
`debug/NodeInheritanceDebugger.tsx`.

For example `src/editor/EntryEditor.tsx:41`:

```
    <button className={cn(badgeVariants({ variant: 'chip' }), className)} aria-pressed={pressed} onClick={onClick}>
```

**Problem:** This is **latent, not live** — I checked, and `grep -rn '<form'`
across `src` returns nothing, so today every one of these defaults to
`type="submit"` with no form to submit and behaves correctly. It is on the list
because the day someone adds a `<form>` (the `AddVaultWizard` and
`auth.callback` flows are the obvious candidates), every unqualified button
inside it silently becomes a submit button that reloads the page. Impact 2
reflects that it costs nothing today; the breadth and the free enforcement are
why it still earns a slot.

**Fix:** Add `type="button"` at the 24 sites and enable
`'@eslint-react/dom-no-missing-button-type': 'error'` in `eslint.config.js`
alongside the other individually-enabled `@eslint-react` rules.

---

## Appendix — toolchain rules evaluated and *not* recommended

Per the survey's instruction to verify capability claims by inspection rather
than memory, and to evaluate rather than reflexively recommend:

- **`jsx-a11y` `strict` preset** — the installed `eslint-plugin-jsx-a11y@6.10.2`
  ships 39 rules; `recommended` (in use) enables 32. Of the 7 unenabled,
  `prefer-tag-over-role` produces **7 errors, all false positives for this app**:
  it demands `<select>`/`<option>`/`<dialog>` in place of the `listbox`/`option`/
  `dialog` roles used by `FloatingComboboxList`, `WikilinkPopup`, `TimeWheels`,
  `SearchOverlay` and `CoachTour` — none of which can be a native `<select>`
  (floating, filterable, custom-rendered). `accessible-emoji` and
  `label-has-for` are deprecated. **Do not adopt `strict`.** The one genuinely
  useful unenabled rule is `no-aria-hidden-on-focusable` (0 current violations —
  cheap to enable as a ratchet).
- **Tailwind class sorting** — evaluated and **not recommended**. There is no
  Prettier in this repo at all (no config, not a dependency), so adopting class
  sorting means adopting a formatter, and the codebase's class strings are
  frequently split across lines with load-bearing explanatory comments between
  them (`_app.tsx:147-155`, `icon-button.tsx:40-50`). A sorter would flatten
  those. The cost outweighs the consistency gain here.
- **`react-hooks` preset claim — verified.** `eslint.config.js:47-50` claims
  `recommended-latest` "includes the React Compiler's diagnostics … alongside
  the two classic rules." Inspecting the installed
  `eslint-plugin-react-hooks@7.1.1` confirms it: the preset enables 17 rules
  including `purity`, `immutability`, `refs`, `set-state-in-effect`,
  `preserve-manual-memoization` and `static-components`. **The comment is
  accurate.**
- **`@eslint-react` unenabled rules** — of the 17 in `all` but not in
  `recommended-type-checked`, only `dom-no-missing-button-type` (finding #8) and
  `jsx-no-useless-fragment` (1 hit, `CoachTour.tsx:108`) fire at all.
  `dom-no-unsafe-target-blank` reports **0** — it accepts `rel="noreferrer"`,
  which is why it does not catch finding #5. Worth stating plainly: **no
  available lint rule catches finding #5**; it needs the code fix.

---

## Survey-file improvements

`plans/surveys/health-ui.md` was updated on this branch in its own commit
(separate from this results file), proposing four changes drawn from actually
running it:

1. **Budget** — add "check whether the repo's dependencies are installed before
   running the gates." This run started on a fresh worktree with no
   `node_modules`; the survey's lint instructions assume otherwise and would
   have produced a misleading "lint is broken" reading.
2. **Process** — generalize the "verify capability claims by inspection" rule to
   cover *build-time* toolchain claims, not just lint plugins. The highest-value
   finding here (#1) came from running the repo's own Babel preset over a
   fixture, which the current wording ("check the installed version of a
   plugin/library … its actual rule set, exports, or API") does not obviously
   invite.
3. **Category 3** — add "custom components that render a bare element" as an
   explicit a11y hunting ground. Finding #2 is invisible to both the linter and
   a naive `<div onClick>` grep, and is the single highest-impact issue found.
4. **Output structure** — state that keep-custom verdicts (category 8) belong in
   the category-verdict section rather than consuming top-N finding slots; the
   current wording ("state the keep-custom verdict") leaves it ambiguous whether
   they are findings.
