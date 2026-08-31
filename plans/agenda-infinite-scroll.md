# Agenda infinite scroll — implementation plan

Turns the agenda from "expand a fixed ±455-day window before first paint" into
a standard incrementally-loaded list. This is the work
`plans/vault-scaling-results.md` defers finding **#1** into, and the work
finding **#4** waits behind.

**Read `plans/vault-scaling-results.md` first** — its "The planned move to
infinite scroll" section carries the remaining constraints in full, with the
exact code they refer to. This file does not restate them; it names them
(C1/C2 below) and says what to build.

Acceptance for the whole sequence is finding #1's own target: `vaultPaintMs` at
mixed/30 000 from ~13 000 ms to **under 1 000 ms**, measured with

```bash
node scripts/perf/stress.mjs --shapes mixed,flat --sizes 3000,30000 --skip-ui --skip-dexie
```

reading `pipeline.result.expandAgendaWindow.median` and
`pipeline.result.occurrencesInAgendaWindow`.

---

## The two remaining constraints, in one line each

Full text and code references in `plans/vault-scaling-results.md`.

- **C1 — widening a window re-expands all of it.** `computeExpansionCache`'s
  fast path gates on an exact `(fromMs, toMs)` match and
  `useExpandWithMultiday` keys its cache by `` `${fromMs}:${toMs}` ``, so a
  "load more" that grows one window is a full re-expansion. Fixed, disjoint
  chunks instead.
- **C2 — any length change drops the whole section cache.**
  `changedIndices` returns `null` the moment `prev.length !== next.length`, so
  every load-more costs a full regroup. Prepending is worse than appending:
  it shifts every index, and `keyByIndex`/`changedIndices` both assume
  positional alignment.

## What this plan adds on top of that section

Three decisions the results file does not settle:

1. **The chunk grid is absolute, not anchor-relative.** Chunks are keyed by an
   index derived from the epoch, aligned to week starts — not by an offset from
   `agendaAnchor`. Anchor-relative chunks would still discard the whole cache
   whenever the anchor moves (a jump in from Month/Day view), which is one of
   the two things C1 is about.
2. **Sectioning is chunked too, not just expansion.** C2 is dissolved rather
   than patched: build `AgendaRow[]` per chunk and concatenate. Teaching
   `changedIndices` an index offset would make appends cheap and leave prepends
   expensive — the opposite of what is needed.
3. **The agenda does not auto-prepend in v1.** Backwards growth is an explicit
   "Load earlier" affordance. See PR 4's hazard section for why
   auto-prepending is the one genuinely dangerous piece here.

**Landed ahead of this sequence:** the overdue section is off the agenda
window entirely — `calendar/overduePool.ts` runs its own expansion over a
filtered item set (undone tracked items plus every child of a kept series),
groups it one row per series, and is cached and invalidated independently of
the agenda's window. `PAST_WINDOW_DAYS`/`FUTURE_WINDOW_DAYS` split into
`WALK_PAST_DAYS`/`WALK_FUTURE_DAYS` (`agendaSections.ts`),
`EXPAND_PAST_DAYS`/`EXPAND_FUTURE_DAYS` (`useAgendaSections.ts`) and
`OVERDUE_LOOKBACK_DAYS` (`overduePool.ts`) at the same time, so PR 4 moves the
expansion window without silently moving the other two.

Also landed ahead of the sequence: `expandRange`/`expandWithMultiday` now
accept an optional pre-built `ItemIndex` (`model/itemIndex.ts`) instead of
re-filtering `items` into series/standalones/children on every call, and
`model/dateUtils.ts`'s `dayRange(firstDay, lastDay)` is the one place that
turns a first/last day into the inclusive `{ from, to }` bound `expandRange`
wants — migrated onto by all four existing call sites (Month, Day, Week, and
the agenda, which was the one passing a bare midnight `to`). Both were
prerequisites the rest of this plan would otherwise have had to work around
case by case; see PR 2 and PR 3 below for where they matter next.

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
| 2 | Absolute chunk grid for agenda expansion | **Sonnet 5** | C1 |
| 3 | Chunk-local sectioning | **Opus 5** | C2 |
| 4 | Incremental loading + "Load earlier" | **Sonnet 5** | finding #1 |

Each PR is shippable on its own and leaves the agenda working. The order is
forced: PR 4 is only safe once appends are cheap in both the expansion (PR 2)
and the sectioning (PR 3).

Three smaller architectural fixes are **folded into** the PRs that already touch
that code rather than given PRs of their own — the cache registry and
chunk-scoped index assertions into PR 2, the filter-state cache key into PR 3.
Each is called out in its PR's design section.

**Per `plans/CLAUDE.md`, each PR deletes its own section from this file.** When
PR 4 lands, this file goes away entirely and finding #1's entry (plus its
summary-table row) is removed from `plans/vault-scaling-results.md` in the same
commit; finding #4's "deferred until after infinite scroll" note is rewritten
around a fresh measurement instead.

---

## PR 2 — Absolute chunk grid for agenda expansion

**Model: Sonnet 5.** Mechanical once the grid rules are fixed, and well guarded
by existing tests. The one non-obvious rule (chunk boundary times) is spelled
out below.

### Goal

The agenda's single `(from, to)` window becomes a contiguous run of fixed,
disjoint, individually cached chunks whose expansions are concatenated. Visible
span and rows are **unchanged** in this PR — it is a refactor plus a cache fix.

### Why it is meaningful alone

Today the window key moves with `agendaAnchor`, so a jump in from Month or Day
view discards the entire expansion cache and re-expands 455 days. On an absolute
grid, a jump reuses every overlapping chunk. That is a real, measurable win
before any incremental loading exists.

### Design

New `src/calendar/agendaChunks.ts` — pure grid math, no React:

- `CHUNK_DAYS = 28`, aligned to week starts so a chunk boundary is always a
  week boundary (PR 3 depends on this).
- `chunkIndexFor(date, ws): number` and `chunkRange(index, ws): { from, to }`,
  derived from the epoch, **not** from the anchor.
- `chunkIndicesFor(from, to, ws): number[]`.

New `src/calendar/useAgendaChunks.ts` — calls `computeExpansionCache` once per
chunk against its **own** module-level cache map (`Map<number, ExpansionCache>`,
keyed by chunk index) and concatenates the results.

`useAgendaSections` then asks for the chunk range covering
`[anchor - EXPAND_PAST_DAYS, anchor + EXPAND_FUTURE_DAYS]` and passes the
concatenated array where `useExpandWithMultiday`'s result goes today. Nothing
downstream changes.

### Hazards

- **Chunk boundary times — use `model/dateUtils.ts`'s `dayRange`, do not
  hand-roll it.** `expandRange` filters inclusively at both ends, so a chunk
  whose `to` is midnight of its last day silently drops every *timed*
  occurrence on that day. Harmless once at the very end of the window;
  catastrophic repeated at every internal boundary. `chunkRange` must build its
  bounds with `dayRange`, and chunk *i*'s last day is the day before chunk
  *i+1*'s first. No overlap, no gap. Assert adjacency in the grid test.
- **Do not reuse `useExpandWithMultiday`'s `cacheByWindow`.** Its
  `MAX_CACHED_WINDOWS = 16` is shared with Month's three panes and Day/Week's
  five each; chunked scrolling would evict live chunks well before the cap, and
  the two eviction policies genuinely differ (LRU for panes, range retention for
  chunks). Give the agenda its own map. Retention is PR 4's problem; in this PR
  simply keep every chunk in the requested range and drop the rest.
- **Pass an `ItemIndex` (`model/itemIndex.ts`) through to every chunk's
  expansion.** Without it each chunk pays the O(series × items) rescan
  (`expansion.ts`'s `childrenByOwnerId` lookup exists precisely to avoid this)
  and this PR multiplies that by the chunk count — the exact regression
  `buildItemIndex` exists to prevent. Build one index per `items` identity
  (reuse `expansionCache.ts`'s `itemIndexFor`, or lift it to a shared spot if
  the chunk grid needs its own) and pass it to every chunk's `expandRange`
  call rather than letting each one build its own. The remaining per-call
  linear passes are why chunks are 28 days rather than 7.
- Concatenation order: chunks are disjoint and ascending and each is internally
  sorted by `dedupeAndSort`, so the concatenation is globally sorted. Sectioning
  buckets by day and sorts within a day anyway, so this is belt-and-braces —
  but keep the chunks in ascending order regardless, since PR 3 relies on it.
- Multiday continuation days are filtered per chunk to that chunk's own range
  (`expansion.ts:877`), so an item starting before a chunk still contributes its
  covered days inside it, and no day is duplicated across chunks. No change
  needed — just do not "optimize" that filter away.

**Folded-in fix: one owner for the module-level caches.** `sectionsCacheSlot`,
`cacheByWindow`, `overduePoolSlot` and this PR's chunk map are four
render-phase-written singletons, each with its own `reset*` wired by hand into
`resetCalendarOnVaultChange`. Miss one and the agenda shows another vault's
rows; `AgendaView.test.tsx`'s `beforeEach(resetCalendarOnVaultChange)` already
carries a comment about tests contaminating each other without it. Put them
behind one `calendar/expansionCaches.ts` with a single `resetAll()`, wired once.

**Folded-in fix: make chunk-local indices say so.** Three layers key on
positions into one flat `Occurrence[]` — `ExpansionCache`'s three reverse
indices, `AgendaSectionCache.keyByIndex` / `DayBucket.indices`, and
`changedIndices`' positional alignment. All are correct only while that array is
one contiguous thing; chunking makes "the array" a concatenation, and an index
from one chunk used against another yields a wrong row **silently**. Have each
cache carry the chunk index it was built for and assert on mismatch in dev. A
few lines, and it converts the whole class into a loud failure.

### Tests

Add `src/calendar/agendaChunks.test.ts` (grid math: alignment to week starts,
adjacency with no gap or overlap, `chunkIndicesFor` covering a range, stability
across anchors). Then, as the real guard, assert that the concatenated
expansion equals the single-window expansion for the same span — a
property-style test over a fixture vault containing a timed occurrence exactly
on a chunk boundary, a multiday item spanning one, and a series crossing
several.

Run `src/calendar/useAgendaSections.test.ts`, `src/calendar/agendaSections.test.ts`,
`src/model/__tests__/` in full, and `src/store.test.ts`.

### Acceptance

`expandAgendaWindow.median` unchanged or slightly better at mixed/30 000; the
same measurement after navigating Month → Agenda should now be near zero rather
than a full re-expansion. Note `model/` may not import from `calendar/`
(invariant 1) — the grid math lives entirely in `calendar/`, and this PR should
need no `model/` change at all, since `ItemIndex`/`dayRange` already exist
there.

---

## PR 3 — Chunk-local sectioning

**Model: Opus 5.** The divider/overdue/goToRowIndex interactions in
`computeAgendaSections` are the subtlest code in `calendar/`, and the cache
identity rules there are what keep `AgendaRow`'s memo from re-rendering the
world.

### Goal

`AgendaRow[]` is built per chunk and concatenated, so adding a chunk at either
end rebuilds nothing in the chunks already loaded. This is what makes PR 4's
loads O(one chunk) instead of O(everything loaded).

### Why it is meaningful alone

C2 measured a full regroup at 3 631 ms at mixed/30 000. Even with the window
unchanged, chunked sectioning turns a done-toggle or filter change into work
proportional to the affected chunks rather than the whole window.

### Design

Split `computeAgendaSections` into:

- `computeChunkRows(prevChunkCache, chunkOccs, chunkIndex, ctx)` — the day walk,
  dividers, day sections and their `AgendaRow`s for **one** chunk, cached per
  chunk index (`Map<number, ChunkSectionCache>`). Keeps the existing
  `changedIndices`/`keyByIndex` machinery, now scoped to one chunk's own array,
  where a length change is rare and cheap.
- `assembleAgendaRows(chunkRows[], overdueGroups, ...)` — concatenates, splices
  the overdue block in at the today boundary, and computes `goToRowIndex`.

**Divider placement must be chunk-local.** Today `lastMonthKey`/`lastWeekKey`
carry across the whole walk. Because the grid is absolute and week-aligned
(PR 2), whether a chunk's first day opens a new week or a new month is a pure
function of the chunk index — no data, no neighbouring chunk. Compute it from
the grid, and **assert it in a test**: concatenated chunk rows must equal the
single-pass row list for the same span, dividers included and not duplicated at
boundaries.

**Overdue and `goToRowIndex` stay global** — they are assembled, not chunked.
The overdue block is already independent of the window (`overduePool.ts`), so it
splices into the assembly at the today boundary exactly as the current walk does
(including the `overdueAtMs` clamp for a far-away anchor). `goToRowIndex` is
computed over the assembled list.

### Hazards

- **Row identity must survive assembly.** `AgendaRow.key` is
  `` `${dateKey}|${id}|${instant}` `` and is what `getItemKey`,
  `useVirtualFlip`, and `computeAgendaScrollRestore`'s key-matched measurement
  snapshot all rely on. Keys stay chunk-independent — do not add a chunk index
  to them.
- **Return unchanged chunks' row arrays by reference.** The whole point of the
  existing cache is that untouched days contribute the same `rows` array
  identity, which is what keeps `AgendaRow`'s memo quiet. A concatenation that
  allocates fresh row objects per assembly throws that away.
- `estimateRow` and the height constants are unchanged; do not re-tune them
  here.
- **Folded-in fix (optional, only if it stays cheap): key the section cache on
  filter *state*, not on `filterOccs` identity.** `useCalendarFilter.ts` carries
  a ⚠️ about this: every piece of filter state must be in its `useCallback`
  deps, complete and referentially stable, or the agenda cache thrashes on every
  render. Chunking does not make it worse — N slots with the same fragility —
  but this PR rewrites that cache anyway, so a small serializable descriptor
  removes the class. Do not let it grow the diff; drop it if it does.
- `useAnchoredAgendaScroll` compares `prevRows === rows` to skip work. Assembly
  allocates a new outer array each time even when every chunk is unchanged —
  memoize the assembled array on the chunk-rows identities so the once-a-minute
  `now` tick does not start looking like a rebuild.

### Tests

`src/calendar/agendaSections.test.ts` — extend with the equivalence property
(chunked assembly === single-pass, for several spans and anchors, including one
where the anchor is far outside the window so the overdue clamp fires). Add
cases for a done-toggle touching exactly one chunk, and for `goToRowIndex`
landing on overdue vs. on an explicit anchor day.

Run `src/calendar/useAgendaSections.test.ts`,
`src/calendar/computeAgendaScrollRestore.test.ts`,
`src/calendar/useVirtualFlip.test.tsx`, `src/calendar/AgendaView.test.tsx`,
`src/calendar/agendaScrollability.test.ts`.

### Acceptance

A done-toggle at mixed/30 000 rebuilds one chunk's rows, not 455 days'. Verify
by instrumenting `computeChunkRows` call counts in a test rather than by
timing.

---

## PR 4 — Incremental loading + "Load earlier"

**Model: Sonnet 5**, given PRs 1–3. What is left is view state, a range-watching
effect, and a button; the hard parts have been removed by the earlier PRs. If
auto-prepend is attempted after all (it should not be — see below), that part is
Opus 5.

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
(`requestScrollToDate`) since the anchor moves.

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
months) and drop from the far end only when the cap is exceeded.

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
- `EXPAND_PAST_DAYS`/`EXPAND_FUTURE_DAYS` stop being the agenda's expansion
  window and become only the bound on how far the user may load, and
  `WALK_PAST_DAYS`/`WALK_FUTURE_DAYS` stop being a fixed span at all — the walk
  covers the loaded chunk run instead. Re-comment both pairs (and the
  expansion-covers-the-walk test in `useAgendaSections.test.ts`, which is
  written against today's fixed spans) so the next reader is not misled.

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
