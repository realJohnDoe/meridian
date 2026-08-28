# Topbar quick navigation: month strip and dotted mini-calendar

Plan for turning the calendar topbar's month label into a disclosure button, in
the shape Google Calendar uses: tapping it drops a horizontally scrolling month
strip into the month view, and a mini month grid with per-day category dots into
the day, week and agenda views (2026-08-27).

**Estimate: four PRs, each sized for a Sonnet 5 session.** PR 1 (the month
view's disclosure button and month strip) and PR 2 (the day-dot derivation)
have shipped. PR 3 needs both merged; PR 4 closes out.
Folding 3+4 together gives one further Opus 5 PR instead of two. One PR for
everything was never advisable — it would have put two different panel UIs, a
shared disclosure shell, a new data derivation and a change to `_app`'s height
geometry in a single diff.

Per `plans/CLAUDE.md`, delete each PR's section from this file in the PR that
implements it, rather than leaving shipped work here to go stale.

---

## What already exists

Four things the feature needs are already in the tree. They are what keeps this
at four small PRs.

**`react-day-picker` is already a dependency** (`package.json`, `^10.0.1`), and
`src/components/ui/calendar.tsx` is the shadcn wrapper over it — with
`CalendarDayButton` already factored out and exported (line 222), which is
exactly the override point per-day dots need. `DatePickerDialog` already drives
it with locale `formatters` and `weekStartsOn(localePrefs)`, so the mini grid
inherits a themed, localized base. **No new dependency is needed**, and none
should be added: dots are a `components={{ DayButton }}` override, not a
different calendar library.

**The five dot categories already have a domain vocabulary.** `occView.ts`'s
`OccState` resolves to `event-future`/`event-past`, `task-p1`/`p2`/`p3`,
`task-open`, `note`, `done` — the event / P1 / P2 / P3 / no-priority split the
dots need. Colors for that vocabulary live in
`components/primitives/occurrence-variants.ts`.

**Range queries over occurrences are already cached.** `useExpandWithMultiday`
keys a module-level LRU by `(fromMs, toMs)` window, capped at 16
(`calendar/useExpandWithMultiday.ts:12`). A mini calendar over one month is one
more window. `useCalendarFilter().filterOccs` already composes the vault,
participant and show-tasks filters the main views use, so the dots agree with
what the grid below them shows, for free.

**There is a sanctioned home for the open/closed flag.** Architecture invariant
5 puts view-ephemeral state in `calendar/viewState.ts`, which already holds the
carousel previews, `currentDate`, and `requestScrollToDate` — the last of which
is how the agenda's mini grid will jump to a day outside the loaded window.

The one thing with nothing to reuse is the month strip itself, and it does not
want a library either: native `overflow-x`, scroll snap, and an explicit
`scrollLeft` write to center the active chip. **Do not reach for Embla** — Embla
drives the paged carousels (`useCarousel`), and the strip is free-scrolling.

---

## PR 3 — The mini month grid for day, week and agenda

~200 lines plus tests. Needs PR 1 and PR 2 merged.

1. New `MiniMonth` wrapping `@/components/ui/calendar`, passing
   `components={{ DayButton }}` so each day renders its dot row beneath the
   number. Importing `components/ui/**` deeply is fine — it is one of the two
   permanent exceptions to invariant 2.
2. Lift the locale `formatters` and `weekStartsOn(localePrefs)` currently inline
   in `DatePickerDialog` into a shared const and import it from both, so the two
   grids cannot drift apart.
3. Feed dots from `useExpandWithMultiday(items, roots, startOfMonth, endOfMonth)`
   → `filterOccs` → `dayDotsFor`.
4. Selection differs per view: **day** highlights the route's date, **week**
   highlights the whole week row (a `modifiers` entry carrying the seven dates
   plus `modifiersClassNames`), **agenda** highlights `agendaTopDate`.
5. Tapping a day: day view → `/day/$date`; week view → `/week/$date`; agenda →
   `requestScrollToDate(iso)` then close the panel.
6. Wire the three `PagedTopbar` branches plus the default agenda branch in
   `_app.tsx` to the disclosure from PR 1.

Files: new `calendar/MiniMonth.tsx` + test; edits to
`editor/dialogs/DatePickerDialog.tsx`, `calendar/index.ts`, `routes/_app.tsx`.

**Trap.** react-day-picker's own caption arrows page the mini grid's *local*
month. They must not navigate the main view, and the topbar label must keep
showing the main view's month rather than the browsed one.

**Trap.** The agenda's virtualizer is element-scoped via `getScrollElement`. Its
scroller shrinks when the panel opens — confirm the row measurements survive
that rather than assuming they do.

**Done when** all four calendar views open a quick-nav panel, the mini grid
shows correctly colored dots for seeded occurrences, and tapping a day lands on
it in every view.

---

## PR 4 — Motion, focus, and a layout guard

~80 lines plus one smoke case.

1. Height and opacity transition on open/close, gated behind
   `prefers-reduced-motion`.
2. Focus moves into the panel on open; Escape closes it and returns focus to the
   label button.
3. Add an open-panel case to `scripts/layout-smoke.mjs` asserting `_app`'s
   height cap still holds and the document gains no scrollbar. **This is the
   specific regression the root `CLAUDE.md` records having shipped twice** — it
   is invisible to every test in `src/`, because jsdom has no layout engine.
4. Decide the desktop form. The same inline panel with a `max-w` cap is the
   cheap answer, since the chevrons already occupy that row on wide screens.

**Done when** `pnpm run build`, `pnpm run lint`, `pnpm run test` and
`pnpm run test:layout` all pass with the panel open on every calendar route.

---

## Guardrails worth restating in each PR prompt

These are the repo's own rules, and they are the ones an unfamiliar session
breaks.

- **Verify with `pnpm run build`, never `tsc --noEmit`.** The composite build
  catches unused imports and the stricter checks CI runs. Generate types before
  linting or the type-aware rules produce a flood of spurious errors on a fresh
  worktree.
- **Import through barrels** — `@/calendar`, not `@/calendar/dayDots`. Every
  `src/` directory with an `index.ts` is a sealed module, root-level files
  included. The permanent exceptions are `components/ui/**` and
  `components/primitives/**`.
- **New names go in `GLOSSARY.md`**, one sentence and a pointer at the code.
  `src/glossary.test.ts` enforces it. `MiniMonth` and `DotCategory` each need
  an entry (`MonthStrip` and `quickNavOpen` already have one, added in PR 1).
- **Do not edit `components/ui/calendar.tsx`.** It mirrors the shadcn registry
  and `shadcn diff` compares it against upstream. Dots go in a wrapper under
  `calendar/`, passed down as a `DayButton` override.
