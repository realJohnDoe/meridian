# UI-Layer Health Survey — results

Run against `claude/surveys-ui-gu2vpe` at `adcc69d`, per
[`plans/surveys/health-ui.md`](./surveys/health-ui.md) and the
[shared conventions](./surveys/README.md).

The survey file itself was updated in a separate commit on this branch — see
"Survey file changes" at the bottom for what and why.

## 1. Health verdict

This is a healthy UI layer, and unusually well-instrumented: three gates
(build, lint, 3395 + 41 tests) pass on a clean install, the module boundaries
are machine-enforced rather than documented, every hand-written
`eslint-disable` carries a reason, and there is not a single whole-store
subscription, raw clickable `div`, `dangerouslySetInnerHTML`, or unreasoned
`any` in the shipped code. The worst area by some distance is
**`src/routes/_app.tsx`**, whose `AppMain` is a 481-line component that
re-derives the same day/week/month/list/agenda discriminant in nine separate
branch chains — in three different orderings — while being excluded from the
coverage report under a rationale ("route registration and little else") that
stopped being true for it some time ago. The second-weakest area is the
**build-time and geometry tooling**: the guards this repo relies on to catch
what lint and tests cannot see are each about half-installed — the React
Compiler bail-out rule matches only one of the three function shapes it needs
to, `scripts/layout-smoke.mjs` covers 5 of 14 routes, and one of
`vitest.config.ts`'s 46 per-file coverage floors points at a path that no
longer exists and is silently inert.

The single biggest structural theme is **guards that are narrower than the
invariant they were written to protect**. Every finding below except #1
is an instance: a correct rule with a selector that misses two-thirds of the
shapes, a correct smoke test enumerating a third of its routes, a correct
exclusion glob that has outgrown its own justification, a correct coverage
floor aimed at a moved file. None of them fail loudly — that is precisely the
class of thing this codebase otherwise defends against very well, which is
what makes the gaps worth closing rather than a sign of neglect.

## 2. Coverage statement

**Read closely:** `src/routes/` (all 26 non-test files, `_app.tsx` and
`__root.tsx` line by line), `src/components/` (all 11 non-test files),
`src/components/primitives/` (all 9), `src/components/ui/` (inventory of all
22 plus close reads of `button`, `badge`, `card`, `separator`, `tooltip`,
`sidebar`, `drawer`, `calendar`), `src/hooks/` (all 13), `src/lib/` (all 12),
`src/index.css` (all 1048 lines, plus a scripted token-parity check across all
9 themes), `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`,
`components.json`, `knip.json`, `scripts/layout-smoke.mjs`, and the UI
dependency inventory from `package.json`.

**Sampled:** `src/calendar/` (55 non-test files — read `DayView`, `WeekView`,
`MonthView`, `MiniMonth`, `OccurrencePill`, `AgendaLoadEarlierRow`,
`AgendaView`, `viewState`; the rest skimmed for structure and via the scripted
censuses below), `src/editor/` + `dialogs/` + `cm/` (read `EntryEditor`,
`EntryViewOnly`, `urlSafety`, `TimeWheels`, `markdownFormatting`, the dialog
inventory; `useEntryEditor` skimmed), `src/settings/` (skimmed;
`VaultSettings` and `AddVaultWizard` read in part), `src/search/`,
`src/onboarding/` (skimmed).

**Whole-file reads were supplemented by scripted censuses over the full UI
layer**, so no file was invisible: a state/effect/line-count census over every
`.ts(x)`; an `onClick`-owner resolution over every `.tsx`; hex/arbitrary-value/
inline-`style` greps; import-frequency counts; a per-file React Compiler
memoization census over all 22 `components/ui/` files; and two ESLint dry-runs
against temporary configs (all temp files removed).

**Excluded as out of scope:** `src/model/`, `src/storage/`, `src/fileIO.ts`,
`src/wikilinks.ts`, `src/types.ts`, `worker/` — domain logic, storage backends
and the OAuth worker. Checked only at the boundary (no domain logic found
embedded in components; no UI concerns found leaking into `model/`, which
`eslint.config.js` enforces anyway). `src/debug/` was read but is
developer-only and **verified absent from the production bundle** (nothing
outside `src/debug/` imports it; `dist/assets/*.js` contains no reference), so
its 837-line, 19-`useState` debugger is deliberately not reported.

**Fraction:** roughly 60–65% of the UI layer read directly, with scripted
coverage of 100%.

**Unverified — flag for a later run:**
- `src/settings/VaultSettings.tsx` (431 lines, 7 `useState`, 5 `useStore`) and
  `AddVaultWizard.tsx` (254 lines, 8 `useState`) were skimmed, not read
  through. Both are form-heavy screens with real error paths; I did not trace
  their loading/error states end to end.
- `src/editor/useEntryEditor.ts` (396 lines, 5 `useState` / 4 `useEffect` /
  6 `useRef`) is the editor's state hub and the most likely remaining home for
  an effect-chain finding. Its coverage floor (68/55/55/70) is the loosest
  non-global one in `vitest.config.ts`, which is itself a hint.
- No runtime profiling was done. Findings #3 and #5 are static/build-time
  measurements of memoization, not measured render cost.

## 3. Category verdicts

1. **Component Architecture & Boundaries** — findings: #1. Otherwise
   strong: 0 whole-store subscriptions, 0 selector-returns-literal
   subscriptions, module boundaries enforced by `no-restricted-paths`, and
   `DayView`/`WeekView` are thin shells over a shared `useCarousel` seam.
2. **Styling System Consistency** — **clean.** One CSS file; 0 hardcoded hex
   outside `src/debug/` and one deliberate `PARSE_PROBE`; 14 arbitrary
   Tailwind values, every one a genuine computed length (`calc`, `env()`,
   `var()`); 41 inline `style={{}}`, all virtualizer/timeline geometry; `cn`
   used throughout with no string-concatenated class logic. A scripted
   token-parity check across all 9 themes found **full parity** — the
   apparent gaps are geometry tokens deliberately global on `:root`, derived
   tokens (`--done-overlay`, `--search-bar-bg`, `--event-border` are
   `color-mix()` over per-theme tokens, so they re-resolve per theme), and a
   shared light-themes-only shadow block.
3. **UX States & Accessibility** — **clean.** Every `onClick` in the codebase
   was resolved to the DOM element its owner actually renders: all 135 land on
   a real `<button>` or a Radix control. `SurfaceButton`/`IconButton` →
   `<button>`; `OccurrencePill` → `SurfaceButton` when clickable and a plain
   `div` when not; `PropChip`/`AddChip`/`AgendaLoadEarlierRow` → `<button>`.
   The one `div` with an `onClick` in shipped code (`TimeWheels.tsx:248`)
   carries `role="listbox"`, `aria-label`, `tabIndex={0}` and `onKeyDown`.
   `jsx-a11y`'s `components` setting already teaches it to see through
   `Badge`/`Card`/`DimmableCard`. Safe-area insets are handled in all three
   shells and the sidebar; `AppErrorFallback` is wired as the router's
   `defaultErrorComponent`; deletes have an undo toast.
4. **Security (UI-facing)** — findings: #8. Threat model: `.ics` subscription
   feeds, GitHub repo contents, and local Markdown files supply frontmatter
   (`url`, `location`, `organizer`, `attendees`), body Markdown and wikilinks,
   all rendered as React children. No `dangerouslySetInnerHTML`, no
   `innerHTML`/`insertAdjacentHTML`, no `document.write`, no user-controlled
   `src`. The two URL sinks (`EntryViewOnly.tsx:102`, `markdownFormatting.ts:66`)
   both gate on `isSafeUrl` before the element ever carries the href — the
   right shape. #8 is that the gate has no tests, not that it is wrong.
5. **Code Health & DRY** — **clean.** `knip` reports no unused files, exports
   or dependencies; zero `any`/`@ts-expect-error` outside `routeTree.gen.ts`;
   all 16 hand-written `eslint-disable`s carry a written justification (the
   17th is the blanket directive in the generated `routeTree.gen.ts`, which
   ESLint ignores anyway).
6. **React Performance** — findings: #3, #5. Route-level code splitting is on
   (`autoCodeSplitting`, editor in its own 716K chunk); all four list surfaces
   are virtualized; `memo()` decisions are deliberate and documented, including
   the two documented *non*-memo cases.
7. **UI Toolchain & Feedback Loops** — findings: #4, #5, #6, #7. The enabled
   rule set is genuinely strong (full `jsx-a11y` recommended, `react-hooks`
   `recommended-latest` including the compiler diagnostics,
   `@eslint-react` `recommended-type-checked` plus 15 individually-raised
   rules, full `@typescript-eslint` type-checked, `import-x` boundary zones
   derived from the filesystem, `dependency-cruiser` for cycles). The findings
   are all about guards narrower than their invariant, not missing guards.
8. **UI Dependencies & Library Fit** — **clean**, with three keep-custom
   verdicts. Every UI dependency is used and `knip` confirms none are
   unreferenced. **Keep-custom verdicts:**
   - **`MiniMonth` (383 lines) alongside `react-day-picker`** is correct, and
     already documented at `MiniMonth.tsx:39–45`: the quick-nav grid mounts
     three panes at once and is swiped continuously, and profiling traced a
     freeze to react-day-picker's per-cell formatting/modifier machinery. The
     library is retained for `DatePickerDialog`, where its range modes, roving
     tabindex and ARIA grid semantics are the right tool. Two month grids, two
     genuinely different jobs.
   - **`IconButton` over `Button size="icon"`** is correct: it decouples the
     44px hit area from the visual size via a `::before` pseudo-element, which
     no shadcn/radix primitive offers, and it makes `label` required so an
     icon-only button cannot ship unnamed.
   - **`CollapseRow`'s pure-CSS `1fr → 0fr` fold** is correct and should not be
     replaced by an animation library: its doc comment records two regressions
     (#843, #850) from the measure-and-animate approach a library would need,
     and the grid-row technique needs no measurement at all.
   - `vaul`, `cmdk`, `embla-carousel-react`, `next-themes`, `sonner`,
     `tw-animate-css` are each used exactly once, at their core use case. One
     icon set (`lucide-react`), one animation approach, one class utility
     (`cn` = `clsx` + `tailwind-merge`).

## 4. Findings

**Summary table** — `Rank` is `(impact × breadth) ÷ effort` per the
[shared formula](./surveys/README.md#ranking-findings); `#N` is stable
identity, not order.

| # | Rank | Title | Categories | Impact | Breadth | Recommended model | Score |
|---|------|-------|-----------|--------|---------|-------------------|-------|
| #5 | 1 | Compiler bail-out rule matches only `FunctionDeclaration` | `toolchain` `performance` | 3 | 100 | **Haiku 4.5** | 300 |
| #4 | 2 | `layout-smoke.mjs` covers 5 of 14 routes | `testing` `toolchain` `layout` | 6 | 10 | **Sonnet 5** | 30 |
| #3 | 3 | `Button`/`Separator` get zero compiler memoization | `performance` `library-fit` | 6 | 9 | **Opus 5** (Sonnet 5 if the mirror policy is pre-decided) | 18 |
| #6 | 4 | `_app.tsx` excluded from coverage on a stale rationale | `testing` `toolchain` | 5 | 2 | **Sonnet 5** | 5 |
| #8 | 5 | `isSafeUrl` — the only XSS gate — has no tests | `security` `testing` | 4 | 1 | **Haiku 4.5** | 4 |
| #7 | 6 | Stale per-file coverage floor, silently inert | `toolchain` `dead-code` | 3 | 1 | **Haiku 4.5** | 3 |
| #1 | 7 | `AppMain` is a 481-line component with 9 branch chains | `component-architecture` `srp` `testing` | 7 | 1 | **Opus 5** | 2.3 |

> **Read the rank column with care.** Breadth-in-files structurally
> under-ranks #1: the entire problem is concentrated in one file, which is
> what makes it a god component in the first place. By impact it is first.
> This is a scoring-rule observation, not a hedge — see "Survey file changes".

**Sequencing.** #6 and #7 together (both edit `vitest.config.ts`). #3 and #5
are independent of each other despite both concerning the compiler — #5 edits
`eslint.config.js`, and its rule does not apply to `components/ui/`, which is
where #3 lives. #4 and #8 are independent of everything, and so is #1.

---

### #1 — `AppMain` is a 481-line component that re-derives the view discriminant nine times

- **Category** — `component-architecture` `srp` `testing`
- **Impact** — 7
- **Breadth** — 1 file (`src/routes/_app.tsx`). Search:
  `grep -n 'isDayView\|isWeekView\|isMonthView\|isListView' src/routes/_app.tsx`
  → 9 branch-chain sites at lines 193, 207, 239, 247, 259, 288, 454, 484, 518.
  (One prior sibling — the topbar's own copy of this chain, then at line 388
  — has since been consolidated into the `pagedView` lookup below; that fixed
  finding is what the sites at 220–234 now reflect. It relocated the site, it
  did not remove it: `AppMain` still independently re-derives the same
  discriminant 9 times.)
- **Recommended model** — **Opus 5.** The topbar's own triplicated branches
  have already been folded into a single `pagedView` lookup
  (`src/routes/_app.tsx:219–235`); what remains is a decomposition whose
  right shape is not determined by the code. **Why the context below does not
  lower this:** the open question is what unit `AppMain` should decompose
  *into* — one `useViewConfig()` hook returning a per-view descriptor, five
  sibling components each owning its own topbar and quick-nav panel, or a
  route-level `topbar`/`quickNav` slot that each leaf route fills. Those
  three have materially different consequences for how `viewState.ts`'s
  preview state is threaded, and the file's existing comments document
  hard-won reasons (the frozen `agendaQuickNavAnchor`, the desktop-vs-mobile
  focus split) that any of them could quietly break. That is a judgement
  call, not a gap in this report.
- **Evidence** — `src/routes/_app.tsx`. The same discriminant, in three
  different orderings. At line 193:
  ```
  const viewKind = isDayView ? 'day' : isWeekView ? 'week' : isMonthView ? 'month' : isListView ? 'list' : 'agenda'
  ```
  at line 247 (`handleToday`):
  ```
    if (isDayView) {
  ```
  and at line 288 (the quick-nav panel), month-first this time:
  ```
    isMonthView && monthViewDate && monthDisplayDate ? (
  ```
  while `pagedView` — now the topbar's single source, computed once rather
  than duplicated across it — still goes day-first at line 220:
  ```
    isDayView && dvDate && dvDisplayDate ? {
  ```
- **Problem** — Adding a view, or changing what paging does, means finding and
  editing four independent branch chains that are not adjacent, not in the
  same order, and not checked against each other by anything; missing one is a
  silent behavioural inconsistency between the topbar label, the "Today"
  button, and the quick-nav panel rather than a build or type error.
- **Fix** — Lift the remaining per-view knowledge (`viewKind`, `handleToday`,
  `renderQuickNavPanel`, and now `pagedView`) into one `useViewConfig()` (or
  equivalent) that returns a single descriptor per view, and let
  `handleToday`, the quick-nav panel and the `isListView` guards read from
  it, so the discriminant is computed once.

**Task context**

- `AppMain` runs `src/routes/_app.tsx:89` to `:546`. `AppLayout` (`:47–:87`)
  is fine and should stay as-is; `previewAware` (`:42`) is a good helper and
  should stay.
- The five views and where each is currently spelled out:
  | View | route match (`:97–:101`) | `handleToday` | quick-nav panel | topbar |
  |---|---|---|---|---|
  | day | `dayMatch` | `:247–:248` | `:290–:312` | `pagedView` `:220–:224` |
  | week | `weekMatch` | `:249–:258` | `:313–:356` | `pagedView` `:225–:229` |
  | month | `monthMatch` | `:259–:260` | `:288–:289` | `pagedView` `:230–:234` |
  | list (backlog/notes) | `backlogMatch`/`notesMatch` | — (falls through) | none | `:429–:435` |
  | agenda | none of the above | `:261–:264` | `:357–:380` | `:436–:447` |
- **The trap, located.** `agendaQuickNavAnchor` (`:126`) is a deliberately
  *frozen* snapshot of `agendaTopDate`, reset in render phase by
  `useResetOnChange` rather than an effect. Its doc comment at `:120–:125`
  explains that feeding the live value back in makes repeated swipes unable to
  advance past the first browsed month. Any descriptor that hands the agenda
  its anchor must preserve the freeze, and `src/routes/_app.test.tsx:163–214`
  is the test that catches it if you don't — run it.
- **Second trap.** The `useEffect` at `:163` (Escape/focus for the mobile
  inline panel) must keep its `isDesktopQuickNav` guard. Its comment at
  `:154–:162` records that running it on desktop fights Radix `FocusScope` and
  leaves focus on `document.body`. There is no test for this; it is
  desktop-keyboard-only.
- **What stays.** All five `PagedTopbar` prop sets keep `replace: true` on
  prev/next nav — one comment on `pagedView` (`:211–:218`, consolidated from
  three separate copies by the topbar fix above) records that this is what
  keeps chevron taps from stacking one history entry per day/week/month.
- **Precedent in-repo.** `src/calendar/useCarousel.ts` is the same shape
  already solved: `DayView`/`WeekView`/`MonthView` pass `unitKey`/`unitAt`/
  `onCommit` into one shared hook instead of each re-implementing paging.
  `src/calendar/DayView.tsx` is 80 lines as a result. That is the target.
- **Verify after:** `pnpm run build && pnpm run lint && pnpm run test`, plus
  `node scripts/layout-smoke.mjs` (needs a `dist/`) since this file owns the
  `_app` shell's height cap — `src/routes/-appShell.test.ts` pins how it is
  expressed but not the resulting geometry.

---

### #3 — `Button` and `Separator` receive zero React Compiler memoization

- **Category** — `performance` `library-fit`
- **Impact** — 6
- **Breadth** — 9 files. Search: an ESLint dry-run over `src/components/ui/`
  with the destructured-default selector broadened to all three function
  shapes reported **23 hits across 9 files** — `button.tsx`, `calendar.tsx`,
  `drawer.tsx`, `popover.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`,
  `sidebar.tsx`, `tooltip.tsx`. Of those, `button.tsx` and `separator.tsx`
  are memoized **not at all**. `@/components/ui/button` is imported by 17
  non-test modules; `<Button` is rendered in 15.
- **Recommended model** — **Opus 5**, because the blocking question is a
  policy call the user owns: `components/ui/` is a deliberate shadcn mirror
  (CLAUDE.md, and `eslint.config.js:316` excludes it from the very rule
  that would flag this) so that `shadcn diff` stays meaningful, and patching
  it trades that fidelity for memoization. **If the user pre-decides the
  policy** — patch and record the divergence, or wrap rather than patch, or
  accept the cost — the remaining edit is **Sonnet 5**: mechanical, with the
  in-repo recipe named below, and verifiable by re-running the census.
- **Evidence** — `src/components/ui/button.tsx:43`:
  ```
  function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  ```
  Running the repo's own preset over the file — `babel.transformSync(src,
  { presets: [reactCompilerPreset({ target: '19' }).preset] })`, i.e. exactly
  what `vite.config.ts:139` installs — yields **no `react/compiler-runtime`
  import and 0 `_c()` calls**. The same census over all 22 files in the
  directory: `badge.tsx` 1, `card.tsx` 6, `dialog.tsx` 10, `tooltip.tsx` 3,
  `alert-dialog.tsx` 11 — and `button.tsx` 0, `separator.tsx` 0. A two-case
  fixture confirms the mechanism and the cure: `function DeclDefault({ a, b = 3 })`
  compiles to plain JSX, while `function DeclBody(props)` with `props.b ?? 3`
  compiles to `const $ = _c(2)`.
- **Problem** — The repo's most-used UI primitive re-renders unmemoized on
  every parent render, and the one guard written to prevent exactly this
  (`eslint.config.js:317–321`) is configured not to look at the directory
  where it is happening — so the cost is invisible to build, lint and tests
  alike.
- **Fix** — Decide the mirror policy, then either move the defaults into the
  body (`props.asChild ?? false`) in `button.tsx` and `separator.tsx` and
  record the divergence, or leave them and record the measured cost so the
  next reader does not have to re-derive it.

**Task context**

- **Exact sites for the minimal fix.** `src/components/ui/button.tsx:43`
  (`asChild = false`) and `src/components/ui/separator.tsx:7–8`
  (`orientation = 'horizontal'`) and `:8` (`decorative = true`).
  These two files are the whole of the "0 memoization" set; the other seven
  are partially memoized and are a follow-on, not this fix.
- **The precedent, in-repo and already written up.** Three first-party
  components already use the cure and each carries the rationale in a comment:
  `src/components/primitives/icon-button.tsx:34–39`,
  `src/components/primitives/collapse-row.tsx:58–61`, and
  `src/components/KindIcon.tsx:22–25`, all pointing at `OccurrenceCard.tsx`
  for the full explanation. Copy that shape.
- **Measured numbers, and how to re-measure.** The `_c()` counts above are
  from this run against `babel-plugin-react-compiler@1.0.0`. Re-measure rather
  than trust them after any bump of that package or `@vitejs/plugin-react`.
  The recipe: `reactCompilerPreset({ target: '19' })` returns
  `{ preset, rolldown }` — pass `.preset` to Babel, not the object — and the
  script must live inside the repo root for Node to resolve `@babel/core`.
- **The trap, located.** `separator.tsx` destructures `orientation` and uses
  it at `:18` (`orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px'`)
  *and* forwards it to the Radix primitive. Moving the default to the body
  must keep both readers on the defaulted value, not the raw prop.
- **The policy question to put to the user, concretely.** `components.json`
  configures the shadcn CLI against this directory and CLAUDE.md states only
  the CLI may write there. Patching two files means `shadcn diff` reports them
  as divergent forever. The alternatives are: (a) patch and record the
  divergence in a comment the next `shadcn diff` reader will find; (b) leave
  `button.tsx` alone and re-export a memo-friendly wrapper from
  `components/primitives/`, which costs an indirection on 17 import sites;
  (c) accept the cost. This report does not pick.
- **Verify after:** re-run the per-file census and confirm `button.tsx` and
  `separator.tsx` report a non-zero `_c()` count, then
  `pnpm run build && pnpm run lint && pnpm run test`.

---

### #4 — `scripts/layout-smoke.mjs` guards 5 of the app's 14 routes

- **Category** — `testing` `toolchain` `layout`
- **Impact** — 6
- **Breadth** — 10 files (the script, plus 9 uncovered route files). Search:
  `ls src/routes/*.tsx | grep -v '/-' | grep -v '\.test\.' | grep -vE '(__root|_app|_entry|settings)\.tsx$'`
  → 14 leaf routes; `APP_ROUTES` + `FLOW_ROUTES` name 5.
- **Recommended model** — **Sonnet 5.** Adding routes to two arrays is
  mechanical, but the failure mode is silent: a route whose `ready` selector
  never matches, or matches before layout settles, makes the check pass
  vacuously — it looks green and guards nothing. The selectors and the settle
  requirement are specified below, which is what keeps this off Opus.
- **Evidence** — `scripts/layout-smoke.mjs:53` and `:61`:
  ```
  const APP_ROUTES = ['/', '/backlog', '/notes']
  ```
  ```
  const FLOW_ROUTES = ['/entry/example/01-start-here', '/settings']
  ```
  CLAUDE.md states the consequence outright: "A new route is covered by
  neither until someone adds it."
- **Problem** — The two most layout-complex routes in the app
  (`/week/$date`, whose `WeekPane.tsx` is 517 lines of timeline geometry, and
  `/calendar/$month`) have no geometry guard at all, and this exact failure
  class — a route on the wrong shell chain, or a shell that silently lost its
  height cap — has already shipped twice (the entry routes before `3de767a`;
  `/settings` in PR #840, fixed in #844). The failure is mobile-only, invisible
  to every test in `src/` because jsdom has no layout engine, and invisible to
  this script because the route simply is not listed.
- **Fix** — Add the 9 missing routes to the two arrays with a `ready` selector
  each, and make the arrays derived from or checked against the route files so
  a new route cannot be silently absent.

**Task context**

- **The enumerated work.** Add to `APP_ROUTES` (3): `/day/2026-09-04`,
  `/week/2026-09-04`, `/calendar/2026-09`. Add to `FLOW_ROUTES` (6):
  `/entry/new`, `/entry/01-start-here` (the bare-slug redirect form),
  `/settings/appearance`, `/settings/vault/example`, `/settings/vault/new`,
  `/auth/callback`. Date/month params must be concrete — the script drives a
  real browser, not the router's type layer.
- **The trap, located.** `APP_ROUTES` entries currently wait on
  `[data-testid="entry-card"]` (`layout-smoke.mjs:212`) plus a 1500ms settle
  for the virtualizer. `/week/$date` and `/day/$date` render an hour-grid
  timeline, not agenda entry cards — an empty day renders **no**
  `entry-card` at all, so reusing that selector will hang for 30s and then
  fail for a reason that is not the geometry. `FLOW_ROUTES` waits on
  `[data-flow-screen]` (`:291`); confirm each added flow route actually
  renders that attribute before adding it, or the wait passes on the shell
  rather than the route.
- **`/auth/callback` needs care** — it is the OAuth phase machine and will
  land in an error phase with no `code` search param. That is fine for a
  *geometry* check as long as the error phase renders `[data-flow-screen]`;
  confirm at `src/routes/auth.callback.tsx` before adding, and drop it from
  the list if it does not.
- **The structural half of the fix.** The arrays going stale is the actual
  finding, not the 9 missing entries. Derive the expected route list from
  `src/routes/*.tsx` (the `_app.` prefix already declares which chain a route
  is on — that is CLAUDE.md's "the filename is the whole declaration") and
  fail the script when a route file exists that neither array names. That
  turns a one-time catch-up into a standing guard.
- **The seam, verified.** `scripts/layout-smoke.mjs` runs against a built
  `dist/` via `vite preview` (`:81`) and is not part of `pnpm run test`;
  check `.github/workflows/build.yml` for whether CI invokes it before
  assuming a new failure would be seen.
- **Verify after:** `pnpm run build && node scripts/layout-smoke.mjs`, and
  deliberately break one added route's shell placement (rename it to the other
  chain's prefix) to confirm the new entry actually fails.

---

### #5 — The React Compiler bail-out rule matches only `FunctionDeclaration`

- **Category** — `toolchain` `performance`
- **Impact** — 3 (latent — zero current violations; this prevents a class
  rather than fixing one)
- **Breadth** — 100 files. Search:
  `find src -name '*.tsx' ! -name '*.test.tsx' ! -path 'src/components/ui/*' ! -path 'src/debug/*'`
  → 100 files in the rule's scope. A dry-run of the broadened selector over
  `src/` reports **0** violations today, so nothing is currently broken.
- **Recommended model** — **Haiku 4.5.** A one-line selector change,
  already dry-run-verified below, whose failure mode is a loud lint error. The
  hazard that would otherwise raise this — accidentally broadening it into
  `components/ui/` or the test files — is prevented by the existing `ignores`
  list, which must be left exactly as it is.
- **Evidence** — `eslint.config.js:319`:
  ```
        selector: 'FunctionDeclaration > ObjectPattern > Property > AssignmentPattern',
  ```
  A fixture through the repo's own preset shows the rule's premise is correct
  *and* that it is shape-blind: `function DeclDefault({ a, b = 3 })` → no
  `_c()`; `const ArrowDefault = ({ a, b = 3 }) => …` → **also** no `_c()`;
  `function DeclBody(props)` with `props.b ?? 3` → `const $ = _c(2)`. Linting
  a two-line probe file confirms the gap directly: the repo's config reports
  1 error (the declaration), a config whose only change is
  `:matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > ObjectPattern > Property > AssignmentPattern`
  reports 2.
- **Problem** — The codebase is 137 function-declaration components to 1
  arrow-function component, so the rule happens to be sufficient today; the
  first arrow-function component anyone writes with a destructured default
  loses memoization with no build error, no lint error and no test failure —
  exactly the silent regression the rule exists to prevent.
- **Fix** — Change the selector to `:matches(FunctionDeclaration,
  FunctionExpression, ArrowFunctionExpression) > ObjectPattern > Property >
  AssignmentPattern`, leaving the `files`/`ignores` and the message unchanged.

**Task context**

- **Exact site.** `eslint.config.js:317–322` — the `no-restricted-syntax`
  block. Change line 319 only.
- **What stays.** The `files: ['src/**/*.tsx']` and
  `ignores: ['src/components/ui/**', 'src/debug/**', 'src/**/*.test.tsx']`
  at `:314–:315` must not change. `components/ui/` is excluded on purpose
  (see #3, which is the cost of that exclusion) and broadening the selector
  into it would fail the lint gate immediately on 23 hits.
- **Measured numbers.** 0 violations in `src/` after the change — verified by
  dry-run this session, so the lint gate stays green. 23 violations would
  appear if `components/ui/` were also un-ignored; do not.
- **The trap, located.** The `AssignmentPattern` must stay a child of
  `ObjectPattern > Property`, not of the function's parameter list directly —
  a plain parameter default (`function f(a = 1)`) does **not** cause the
  bail-out, and matching it would produce false positives the message does not
  describe.
- **Consider also updating the message** to say "component" rather than
  implying a declaration, since it will now fire on arrows too.
- **Verify after:** `pnpm run lint` (must stay green), then paste an
  arrow-function component with a destructured default into any `src/*.tsx`
  and confirm it now errors.

---

### #6 — `_app.tsx` is excluded from coverage under a rationale that no longer describes it

- **Category** — `testing` `toolchain`
- **Impact** — 5
- **Breadth** — 2 files directly (`vitest.config.ts`, `src/routes/_app.tsx`);
  the glob pair covers 11 files totalling 1410 lines. Search:
  `wc -l src/routes/_app*.tsx src/routes/_entry*.tsx` → `_app.tsx` alone is
  569 of those 1410 lines (40%); the other ten average 84.
- **Recommended model** — **Sonnet 5.** Narrowing the glob is trivial, but
  doing so surfaces ~569 previously-invisible lines in the coverage total and
  can drop the project below the global floor (`statements: 68`), so the task
  includes writing enough tests to hold it — which needs judgement about what
  in `AppMain` is worth pinning. The floor values and the existing test file
  are named below.
- **Evidence** — `vitest.config.ts:39–40`:
  ```
        'src/routes/_app*.tsx',
        'src/routes/_entry*.tsx',
  ```
  under the comment at `:34–:38` justifying them:
  ```
        // Route registration: the `_app*`/`_entry*` files wire a component to a
        // path and little else.
  ```
  That is accurate for the other ten files. `src/routes/_app.tsx` is 569 lines
  containing the app's entire topbar composition, quick-nav orchestration,
  focus management and "Today" behaviour — see #1.
- **Problem** — The largest and most branch-dense file in `src/routes/` is
  invisible to the coverage report *and* to the global floor, so the nine
  branch chains in #1 can be edited, or broken, without any coverage signal —
  and the exclusion reads as deliberate and reasoned, so nobody re-examines it.
- **Fix** — Replace the `_app*` glob with an explicit list of the genuinely
  registration-only `_app.*` leaf routes, letting `src/routes/_app.tsx` itself
  be counted, and add tests until the global floor holds.

**Task context**

- **The enumerated work.** Keep excluding, by name:
  `_app.index.tsx` (60), `_app.backlog.tsx` (19), `_app.notes.tsx` (19),
  `_app.day.$date.tsx` (69), `_app.week.$date.tsx` (76),
  `_app.calendar.$month.tsx` (46). Stop excluding: `src/routes/_app.tsx`.
  Leave the `_entry*` glob alone — its four files are 18/47/124/134 lines and
  the rationale does hold for them.
- **Measured numbers, to re-derive rather than trust.** The current global
  floor is `statements: 68, branches: 62, functions: 59, lines: 70`
  (`vitest.config.ts:53–56`). Un-excluding 569 uncovered lines will move the
  project total; run `pnpm exec vitest run --coverage` **before** editing to
  get today's baseline, then again after, and only then decide whether the
  floor needs tests added or a documented adjustment. Do not lower the global
  floor silently to make room.
- **What already exists to build on.** `src/routes/_app.test.tsx` is 229 lines
  and already mounts the quick-nav path with a mocked `useCarousel` — its
  three tests cover the `agendaQuickNavAnchor` freeze. The untested surface is
  the five-way topbar branch: which label and which paging each route yields.
  Those are cheap table-driven tests and are exactly what #1 needs as a safety
  net, which is why this is worth doing **before** #1, not after.
- **Precedent in-repo.** `src/routes/-pagedTopbar.tsx`,
  `-entryTopbar.tsx` and `__root.tsx` each carry a 92/90/95/92 per-file floor
  (`vitest.config.ts:129–132`) — the same treatment is the natural landing
  place for `_app.tsx` once it has tests, but set it from a measurement, not
  from that number.
- **Verify after:** `pnpm run test` and confirm `src/routes/_app.tsx` now
  appears in the coverage table with a real percentage.

---

### #7 — A per-file coverage floor points at a moved file and is silently inert

- **Category** — `toolchain` `dead-code`
- **Impact** — 3
- **Breadth** — 1 file (`vitest.config.ts`), 1 of its 46 path keys. Search:
  every `'src/…'` key in the file checked against the filesystem — one
  threshold key does not resolve.
- **Recommended model** — **Haiku 4.5.** Correcting a path is mechanical and
  the guard test proposed below fails loudly if wrong. Verified inert by
  dry-run, so there is no hidden interaction to reason about.
- **Evidence** — `vitest.config.ts:130`:
  ```
        'src/routes/-entryRoute.ts': { statements: 92, branches: 85, functions: 95, lines: 95 },
  ```
  `src/routes/-entryRoute.ts` does not exist; the file is `src/entryRoute.ts`,
  moved to the root per CLAUDE.md ("A root leaf rather than
  `routes/-entryRoute.ts` (where it used to live)"). A dry-run confirms the key
  is inert rather than an error: a config whose only threshold is a
  nonexistent path at 99/99/99/99 exits **0** with no warning.
- **Problem** — `src/entryRoute.ts` builds every Link/navigate descriptor for
  entries and is imported by `editor/`, `hooks/` and three files in `routes/`;
  it was deliberately floored at 92/85/95/95 and is now guarded only by the
  global floor, with nothing anywhere reporting the downgrade. More generally,
  nothing validates that any of the 46 keys still names a real file, so the
  next rename does the same thing silently.
- **Fix** — Retarget the key to `src/entryRoute.ts`, and add a test that
  asserts every per-file threshold key in `vitest.config.ts` resolves to an
  existing file.

**Task context**

- **Exact site.** `vitest.config.ts:130`. Change the key to
  `'src/entryRoute.ts'`; the values need no change —
  `src/entryRoute.test.ts` exists (13 tests) and the file measures
  100/100/100/100 today, so the 92/85/95/95 floor passes as-is.
- **The other three non-resolving strings are fine and must not be "fixed":**
  `src/components/ui/**`, `src/routes/_app*.tsx`, `src/routes/_entry*.tsx` are
  globs in the `exclude` array (`:32`, `:39`, `:40`), not threshold keys. Only
  keys under `thresholds` are literal paths. (`_app*.tsx` is separately
  wrong for a different reason — that is #6, not this.)
- **The guard test.** `src/glossary.test.ts` is the in-repo precedent for
  exactly this shape: it asserts that every file and symbol `GLOSSARY.md`
  names still exists, so a rename is forced to update the doc. Model the new
  test on it — import the config, walk
  `test.coverage.thresholds`, skip the four non-path keys
  (`statements`/`branches`/`functions`/`lines`), and `expect(existsSync(key))`
  for the rest.
- **Verify after:** `pnpm run test`, and confirm the new test fails if you
  temporarily rename a floored file.

---

### #8 — `isSafeUrl`, the app's only XSS gate, has no tests

- **Category** — `security` `testing`
- **Impact** — 4
- **Breadth** — 1 file (`src/editor/urlSafety.ts`), 2 call sites. Search:
  `grep -rn 'isSafeUrl' src/` → definition plus `EntryViewOnly.tsx:102` and
  `cm/markdownFormatting.ts:66`; `ls src/editor/urlSafety*` → no test file.
- **Recommended model** — **Haiku 4.5.** Writing table-driven tests for a
  pure single-expression predicate is fully specified once the cases are
  listed, and a wrong test fails loudly. The one hazard — that this is an
  allowlist and must stay one — is named below.
- **Evidence** — `src/editor/urlSafety.ts:6`:
  ```
  export function isSafeUrl(url: string): boolean {
    return /^(https?|mailto):/i.test(url)
  }
  ```
  and its consumer at `src/editor/EntryViewOnly.tsx:102`:
  ```
            {url && (isSafeUrl(url) ? (
  ```
- **Problem** — This one regex is the entire barrier between an `.ics`
  subscription's or a synced repo's `url:` frontmatter and a rendered
  `<a href>`; the file's own comment notes an `<a href>` fires on middle-click
  and context-menu "open in new tab", so the element must never carry an
  unsafe href at all. In a repo with 3395 tests and per-file coverage floors
  on iCal date parsing and chevron components, the security predicate is the
  thing with no test — so a future "let's also allow `tel:` and relative
  paths" refactor has nothing to stop it from admitting `javascript:`.
- **Fix** — Add `src/editor/urlSafety.test.ts` covering the allow and deny
  sets below, and give the file a per-file coverage floor.

**Task context**

- **The enumerated cases.** Must return `true`: `https://x.test/a`,
  `http://x.test`, `HTTPS://X.TEST` (the regex is `i`-flagged),
  `mailto:a@b.test`. Must return `false`: `javascript:alert(1)`,
  `JavaScript:alert(1)`, `data:text/html,<script>`, `vbscript:msgbox`,
  `file:///etc/passwd`, `tel:+1`, `//evil.test` (protocol-relative),
  `/relative/path`, `` (empty), and — the one most likely to regress —
  `\n javascript:alert(1)` and ` javascript:alert(1)`, which are rejected only
  because the pattern is anchored with `^`.
- **The trap, located.** The predicate is an **allowlist anchored at `^`**,
  which is why leading-whitespace and control-character tricks fail safe. Any
  future edit that relaxes the anchor, drops the `^`, or switches to a
  denylist of bad schemes inverts that property. Write at least one test whose
  name says so, so the intent survives the refactor that breaks it.
- **Both call sites already do the right thing** and should not change:
  `EntryViewOnly.tsx:102–:111` renders a plain `<span>` (not a dead link) when
  the check fails, and `markdownFormatting.ts:66` gates `window.open`. The fix
  is tests only — do not touch the predicate.
- **Precedent for the floor.** `vitest.config.ts` already floors comparably
  small pure modules (`src/storage/conflictError.ts` at 90/85/95/95,
  `src/calendar/ContinuationChevron.tsx` at 92/90/95/92). A 100/100/100/100
  floor is achievable here — the function has one expression.
- **Verify after:** `pnpm run test`, and confirm the suite fails if you
  temporarily replace the pattern with `/(https?|mailto):/i` (unanchored).

---

## Survey file changes

`plans/surveys/health-ui.md` was updated in its own commit on this branch,
separate from this results file. Three process learnings from the run, none of
them findings about the product:

1. **The ranking formula's breadth term systematically under-ranks god
   components.** A 481-line component whose problem is nine repetitions of one
   branch is, by construction, one file — so `(impact × breadth) ÷ effort`
   ranks the most structurally important finding in this report last, below a
   one-line lint-selector tweak. The survey already says to prefer structural
   findings; the scoring rule pulls the other way, and the two should not
   contradict each other silently.
2. **The build-time-tooling check needs its recipe recorded.** The survey
   correctly calls this the highest-yield check, and it was — but getting a
   fixture through this repo's preset took several dead ends
   (`reactCompilerPreset()` returns `{ preset, rolldown }`, so Babel rejects
   the object; the driver script must sit in the repo root for Node to resolve
   `@babel/core`). A run that budgets 20 minutes for this check and loses them
   to setup will skip it.
3. **"Run the existing quality gates once" should include auditing the gates'
   own config for stale paths.** Findings #6 and #7 were both found by
   checking config path keys against the filesystem, not by running anything —
   a green gate says nothing about whether it is still pointed at the right
   files.
