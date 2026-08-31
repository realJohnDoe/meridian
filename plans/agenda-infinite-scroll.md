# Agenda infinite scroll — implementation plan

Turns the agenda from "expand a fixed ±455-day window before first paint" into
a standard incrementally-loaded list. This is the work
`plans/vault-scaling-results.md` defers finding **#1** into, and the work
finding **#4** waits behind.

**Read `plans/vault-scaling-results.md` first** — its "The planned move to
infinite scroll" section says what has already landed and what #1 and #4 are
still waiting on.

Acceptance for the whole sequence is finding #1's own target: `vaultPaintMs` at
mixed/30 000 from ~13 000 ms to **under 1 000 ms**, measured with

```bash
node scripts/perf/stress.mjs --shapes mixed,flat --sizes 3000,30000 --skip-ui --skip-dexie
```

reading `pipeline.result.expandAgendaWindow.median` and
`pipeline.result.occurrencesInAgendaWindow`.

---

## What this plan adds

One decision the results file does not settle: **the agenda does not
auto-prepend in v1.** Backwards growth is an explicit "Load earlier"
affordance. See PR 4's hazard section for why auto-prepending is the one
genuinely dangerous piece here.

**Landed ahead of this sequence:** the overdue section is off the agenda
window entirely — `calendar/overduePool.ts` runs its own expansion over a
filtered item set (undone tracked items plus every child of a kept series),
groups it one row per series, and is cached and invalidated independently of
the agenda's window. `OVERDUE_LOOKBACK_DAYS` (`overduePool.ts`) split off from
the agenda's own `EXPAND_PAST_DAYS`/`EXPAND_FUTURE_DAYS` at the same time, so
PR 4 moves the agenda's window without silently moving the overdue lookback.

Also landed ahead of the sequence: `expandRange`/`expandWithMultiday` now
accept an optional pre-built `ItemIndex` (`model/itemIndex.ts`) instead of
re-filtering `items` into series/standalones/children on every call, and
`model/dateUtils.ts`'s `dayRange(firstDay, lastDay)` is the one place that
turns a first/last day into the inclusive `{ from, to }` bound `expandRange`
wants — migrated onto by all four existing call sites (Month, Day, Week, and
the agenda, which was the one passing a bare midnight `to`).

### One property that is now load-bearing

The day-by-day walk emits month/week divider rows unconditionally — "a
continuous ruler rather than a list with unexplained gaps"
(`agendaSections.ts`). Under infinite scroll this stops being cosmetic: a
date-paginated page can legitimately contain zero occurrences, and a load-more
loop driven by "did new rows appear" dead-ends on a quiet stretch of calendar
if pages can be empty. Because every 28-day chunk contributes at least its
month/week dividers, no chunk is ever empty. **If divider rows are ever made
conditional on content, the load-more loop must gain a "keep loading until a
screenful" iteration.** Stated here because nothing in the code says it.

---

## PR sequence

| PR | Title | Model | Closes |
|---|---|---|---|
| 4 | Incremental loading + "Load earlier" | **Sonnet 5** | finding #1 |

PRs 2 and 3 have landed. Both the expansion and the sectioning are chunked on
one absolute 28-day grid — see `calendar/agendaChunks.ts` (the grid, the
window constants and `agendaChunkRun`), `calendar/useAgendaChunks.ts` (one
`ExpansionCache` per chunk index), `calendar/agendaSections.ts`
(`computeChunkRows` builds one chunk's day sections and divider rows,
`assembleAgendaRows` concatenates them and splices in overdue), and
`calendar/expansionCaches.ts`. Growing or shrinking the loaded run at either
end therefore costs one chunk, in both stages — which is the whole
precondition PR 4 needed.

**Per `plans/CLAUDE.md`, each PR deletes its own section from this file.** When
PR 4 lands, this file goes away entirely and finding #1's entry (plus its
summary-table row) is removed from `plans/vault-scaling-results.md` in the same
commit; finding #4's "deferred until after infinite scroll" note is rewritten
around a fresh measurement instead.

---

## PR 4 — Incremental loading + "Load earlier"

**Model: Sonnet 5**, given PRs 2–3. What is left is view state, a
range-watching effect, and a button; the hard parts have been removed by the
earlier PRs. If auto-prepend is attempted after all (it should not be — see
below), that part is Opus 5.

### Goal

First paint loads a small span; the loaded range grows forward as the user
scrolls, and backwards only on an explicit action. This is where finding #1's
number actually moves.

### Design

**State** in `calendar/viewState.ts` (view-ephemeral, per invariant 5 — this is
exactly the kind of state that store lives for): `agendaLoadedChunks:
{ first: number; last: number }`, seeded to the chunk containing `agendaAnchor`
plus one on each side (≈ ±28 days at first paint, against 455 today). Reset in
`resetCalendarViewState`, and re-seeded on an explicit jump
(`requestScrollToDate`) since the anchor moves. `agendaChunkRun` in
`calendar/agendaChunks.ts` is the one place that decides today's fixed run, so
it is the one place that has to start reading this state.

**Forward growth.** In `AgendaView`, watch the virtualizer's range: when
`range.endIndex` comes within ~1 viewport of `rows.length`, bump `last` by one.
Drive it from `virtualizer.getVirtualItems()` in the existing scroll listener
rather than adding an IntersectionObserver — the component already reads the
range there, and the listener is registered after the virtualizer's own so the
values are current. Guard against firing twice for one frame.

**Backwards growth is a button, not a scroll trigger.** Render a "Load earlier"
row at the top of the list (a new `AgendaRow` variant, or simply a sticky
control above the scroller); pressing it bumps `first` by one. Since the rows
below it do not move, no scroll compensation is needed at all.

**Retention.** Do not evict chunks the user has scrolled past — evicting costs a
re-expansion *and* a scrollbar jump. Cap the loaded run (say 24 chunks ≈ 21
months) and drop from the far end only when the cap is exceeded. Both cache
layers already evict to the requested run (`useAgendaChunks`'s effect, and
`computeAgendaSections` rebuilding its chunk map each call), so capping the run
is the only place the policy needs to live.

### Hazards

- **This is why there is no auto-prepend.** `useAnchoredAgendaScroll` corrects
  *after* commit, and it deliberately bails while a finger is down
  (`touchingRef`) — which is precisely when an auto-prepend would fire, because
  the user reaches the top edge by dragging. The result would be a visible
  teleport during a drag. If auto-prepend is ever added: defer the prepend to
  `touchend`, and correct with the existing index-based `scrollToIndex`
  reconciliation, **never** with `scrollTop += estimatedHeight` — that file's
  own comment records a pixel-target correction overshooting by ~330 px because
  the newly-landed rows were still unmeasured.
- **A load must not look like a jump.** Appending changes `rows` identity, which
  wakes `useAnchoredAgendaScroll`'s correction. Appending below the viewport
  leaves the anchor's index unchanged, so its `index === anchor.index` early
  return already handles it — confirm that with a test rather than assuming it.
- `computeAgendaScrollRestore`'s saved measurement snapshot is matched by key,
  so a restored scroll position still works with a differently-sized loaded
  range. But `agendaScrollOffset` is a raw pixel offset: if the restored range
  is seeded smaller than the range that produced the offset, the offset can
  exceed the list. Clamp it, or re-seed the loaded range from the saved
  `agendaTopDate`.
- `EXPAND_PAST_DAYS`/`EXPAND_FUTURE_DAYS` stop being the agenda's window and
  become only the bound on how far the user may load. Re-comment them (and
  `agendaChunkRun`'s own doc comment, which still describes a fixed run) so the
  next reader is not misled.
- Prepending a chunk shifts every row index, but no row *key* — keys are
  chunk-independent by construction (`agendaSections.ts`'s `occRowKey`). Keep
  it that way: `getItemKey`, `useVirtualFlip` and the scroll-restore snapshot
  all identify rows across a load by that string.

### Tests

**Budget for harness updates.** `AgendaView.test.tsx`'s jsdom harness fakes
`offsetHeight`/`offsetWidth` and gives each row exactly its `estimateRow` size,
and its comments explicitly reason about "the row list always spans the full
~455-day window". This PR falsifies that premise; the harness will need
adjusting, and the seven scroll-anchoring tests are the ones to keep green.

**Add one real-browser case.** jsdom has no layout engine, so prepend teleport,
momentum interaction and scrollbar settling are invisible to `src/` tests. Add
an agenda scroll case to `scripts/layout-smoke.mjs` (it currently covers
route-shell geometry only, for the routes in its `APP_ROUTES`/`FLOW_ROUTES`)
rather than pretending the unit tests cover it.

`src/calendar/AgendaView.test.tsx` and a new
`src/calendar/agendaLoadRange.test.ts`:

- first paint loads three chunks, not the full span;
- scrolling to the bottom bumps `last` and does not move the anchored row;
- "Load earlier" bumps `first` and leaves the scroll position alone;
- the cap evicts from the far end and never from the visible run;
- an explicit jump (Today, a sidebar jump) re-seeds the range around the new
  anchor.

`src/calendar/agendaSections.test.ts` already asserts the property a load-more
must not break — chunked assembly equals a single continuous walk over the same
run, dividers included and none duplicated at a boundary. Extend its `spans`
table with the new runs rather than writing a second equivalence test.

### Acceptance

The sequence target: `vaultPaintMs` at mixed/30 000 **under 1 000 ms**, with
`expandAgendaWindow` down roughly in proportion to the narrower initial span,
via the recipe at the top of this file. Then re-run finding #4's recipe
(`node scripts/perf/stress.mjs --sizes 3000,30000`, reading `ui.scroll` and
`ui.mountedRows`) — row count at first paint drops from 185 882 to one span's
worth, so the scroll jank may go with it. Rewrite finding #4 around what that
shows, and remove finding #1 and this file per `plans/CLAUDE.md`.

---

## Deliberately not doing

- **Lazy k-way merge for overdue** — considered and rejected in
  `plans/vault-scaling-results.md`; `overduePool.ts`'s filtered-item pass gets
  the same result without a second implementation of "which dates does this rule
  produce".
- **Closed-form occurrence counting** — same reason: a counter that drifts from
  `expansion.ts` shows a wrong number beside a right list, silently.
- **Decomposing `AgendaView`.** It owns the virtualizer, scroll restore,
  save-scroll, anchoring, FLIP, top-date tracking, the scrollability warning and
  the scroll-to-target effect under a blanket `'use no memo'`, and PR 4 adds a
  ninth concern. Tempting, but each concern is *already* extracted into its own
  hook, and PR 4's load-range watcher belongs in the scroll listener that
  exists. Rewriting the virtualizer ownership would risk the most delicately
  tested behaviour in the repo — seven anchoring tests, each tracing a specific
  reported bug — for no functional gain.
- **Chunking Month/Day/Week views.** They have bounded windows already and their
  panes are their own natural chunks; `useExpandWithMultiday`'s LRU is correct
  for them. Leave it alone.
