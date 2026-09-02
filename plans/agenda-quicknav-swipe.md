# The agenda's quick-nav swipe is still janky — and it is not the pane cost

`plans/calendar-swipe-cheap-panes.md` chased the mini-month swipe freeze into
the day/week **pane DOM** (840 hour cells) and fixed it there. That work
landed and holds: day view's swipe cost is now essentially flat in vault size.
The agenda's is not, and it was never in scope — that plan lists "the agenda
view's virtualizer" under *Out of scope*.

The remaining jank is a different bug on a different axis. It is not the panes,
not `Intl`, and not occurrence expansion being slow. It is that **one quick-nav
swipe on the agenda invalidates and rebuilds the agenda's entire data pipeline,
twice, inside the snap animation's own frames.**

## What was measured

Dev server (the large-vault generator is dev-only), Chromium 141, 412×915,
`hasTouch`, unthrottled, generated vault via `meridian_bigvault`. Real touch
events via CDP `Input.dispatchTouchEvent`. The measurement window is
**touchend → +900 ms** — the snap animation, i.e. exactly the interval that has
to stay smooth. Absolute ms carry dev-React overhead; read the columns against
each other, not as shipped latency.

At 1 200 files, 3–4 swipes per view:

| view | main-thread busy in the window | worst frame | long tasks per swipe |
|---|---|---|---|
| **agenda** | **698–767 ms** | **373–409 ms** | **3** (250–327 ms) |
| week | 392–399 ms | 159–204 ms | 2 |
| day | 278–323 ms | 95–127 ms | 1 |

Which matches the report exactly: barely noticeable on day and week, plainly
wrong on the agenda.

### It scales with the vault, which is the tell

| vault | agenda busy / worst frame | day busy / worst frame |
|---|---|---|
| 300 | 555 ms / 300 ms | 205 ms / 92 ms |
| 1 200 | 698 ms / 373 ms | 278 ms / 95 ms |
| 3 000 | **1 389 ms / 855 ms** | 296 ms / 142 ms |

Day view's swipe is DOM-proportional and roughly constant — that is PR1 working
as designed. The agenda's is **data**-proportional: 2.5× the busy time from 300
to 3 000 files, and a worst frame that has crossed a second. A user with a real
vault feels this long before 3 000 files.

### Call counts per single swipe (instrumented, agenda)

```
requestScrollToDate      2      <- fired on preview AND again on commit
computeAgendaSections    1      full miss (not the fast path)
assembleAgendaRows       1      the whole flat row list, rebuilt
computeExpansionCache    2      full re-expansions
```

Day and week: `requestScrollToDate` **0**. None of this runs for them.

## The cause

`src/routes/_app.tsx`, agenda branch of `renderQuickNavPanel`:

```tsx
onBrowseMonth={d => requestScrollToDate(fmtISO(d))}
// Already cheap (no navigation) — same call on preview as on commit.
onBrowseMonthPreview={d => requestScrollToDate(fmtISO(d))}
```

That comment is the bug. "No navigation" is not the same as "cheap".
`onBrowseMonthPreview` exists precisely so a caller can do something *cheap*
mid-gesture instead of a route commit (see `quickNavBrowsePreview`'s doc in
`viewState.ts`) — day and week honour that by writing one string. The agenda
passes the most expensive callback in the file, on the strength of it not being
a `navigate()`.

`requestScrollToDate` (`src/calendar/viewState.ts`) is three commands in one:

```ts
calendarView.setState({ agendaAnchor: dateKey, agendaScrollTarget: dateKey, agendaLoadedChunks: null })
```

Each leg detonates something, all inside the snap animation:

1. **`agendaLoadedChunks: null`** — `useAgendaLoadedRun` reseeds the run to
   three chunks around the new anchor. `chunkOccs` changes identity, and
   `useAgendaChunks`' eviction effect *deletes every cached chunk outside the
   new run* — including chunks the user paid for by scrolling. Swipe back and
   they are re-expanded from scratch.
2. **`agendaAnchor`** — `computeAgendaSections`' assembly gate includes
   `prev.anchorMs === anchorMs`, so a moved anchor forces a full
   `assembleAgendaRows` over the whole run. New `rows` identity then cascades
   into `useVirtualFlip` (glide animation armed), `computeAgendaScrollRestore`,
   and `useAnchoredAgendaScroll`.
3. **`agendaScrollTarget`** — AgendaView's layout effect runs
   `virtualizer.scrollToIndex()` (synchronous scroll + re-measure; `measureElement`
   and `Virtualizer.getMeasurements` are both visible in the profile) and then
   `markAgendaScrolled()`, **a second store write**, which re-renders `_app` and
   AgendaView again.

And because preview and commit both call it, all of that happens twice per
swipe.

### Counterfactuals — each leg isolated (agenda, 1 200 files)

| variant | busy | worst frame | long tasks |
|---|---|---|---|
| baseline | 767 ms | 162–409 ms | 3 |
| drop `agendaLoadedChunks: null` | **129 ms** | **47–53 ms** | **0** (swipes 2+) |
| drop `agendaScrollTarget` | 245 ms | 113–373 ms | 1 |
| drop `onBrowseMonthPreview` entirely | 645 ms | 370–399 ms | 3 |

Two things to read off this:

- The chunk-run invalidation is the dominant term by a wide margin — **−83 %**
  on its own. (It is a diagnostic, not a shipped fix: dropped unconditionally,
  a browse far from today never loads the chunks it needs.)
- **Removing the preview does not help.** The commit still does the same work;
  it just lands in one larger blob at settle. The preview/commit split moves
  cost around, it does not remove it. Anything framed as "make the preview
  cheaper" is treating the symptom.

## Why it has been hard to decouple — the architectural half

Five to ten PRs of making things cheaper hit diminishing returns because
"cheaper" is the wrong axis. Six structural reasons, roughly in order of how
much they matter:

**1. The snap animation is main-thread JS, not a compositor animation.** Embla
advances the pane by writing `transform` from its own rAF loop. Every
millisecond React spends in that frame is a millisecond the transform does not
move. So decoupling cannot mean "make the work cheaper" — it has to mean *do
not run it in those ~350 ms at all*. Every fix that reduced work rather than
relocating it bought a proportional, and therefore small, improvement.

**2. Render-phase cache writes make the work non-deferrable.**
`useAgendaLoadedRun` writes Zustand state during render; `useAgendaChunks`,
`useExpandWithMultiday` and `useAgendaSections` write module-level caches during
render. Each is individually justified in a comment, and each justification is
correct (idempotent, StrictMode-safe). The aggregate is not: a pipeline that
mutates module state during render cannot be wrapped in `startTransition` or
`useDeferredValue`, because a transition render React discards has *already*
mutated the caches, and a render-phase `setState` forces a synchronous
re-render. The one escape hatch React offers for "do this, but not now" is
structurally unavailable to the agenda.

**3. A cost contract that lives only in a doc comment.**
`onBrowseMonthPreview`'s contract is "cheap, decoupled preview state". Nothing
type-checks, tests, or lints it. The agenda's implementation violates it while
citing it. A contract about *cost* needs a *measurement* to enforce it — see
the gate proposed below.

**4. Compound commands.** `requestScrollToDate` bundles anchor move + scroll
request + cache invalidation. Every caller pays for all three whatever it
wanted. A quick-nav browse wants one of them.

**5. Invalidation keyed on view intent rather than on data.** Both
`agendaAnchor` (in the sections cache gate) and `agendaLoadedChunks` treat
*where the user is looking* as an input to a *data* cache. So a purely
navigational gesture — which changes no occurrence, no filter, no item —
invalidates occurrence caches. `agendaChunks.ts` already went to some trouble to
make the chunk grid epoch-absolute *specifically so a moved anchor reuses
chunks*; nulling the run throws that property away one layer up.

**6. A feedback loop through the shared store.** swipe → `requestScrollToDate`
→ AgendaView scrolls → `markAgendaScrolled` → `agendaTopDate` → `_app.tsx`
re-renders → `MiniMonth`'s `anchorMonth` prop changes → **the grid currently
being swiped re-renders mid-animation**. The gesture's own downstream effect
comes back round and re-renders the gesture's own widget. `_app.tsx` subscribes
to six `calendarView` slices and renders the topbar, both quick-nav panel
sites, and the `Outlet`, so the blast radius of any of these writes is the whole
app shell. AgendaView's necessary `'use no memo'` (for the virtualizer) means
its full body re-runs each time.

**7. Nothing in `src/` can see any of it.** jsdom has no layout engine and no
frame budget. `MiniMonth.preview.test.tsx` pins the *order* of preview and
commit but not their *cost*. This is why the class of bug keeps returning.

## What to do

In rough order of value per unit of risk.

### 1. Don't reseed the loaded run when the target is already loaded

The single biggest win (−83 % measured). `requestScrollToDate` should null
`agendaLoadedChunks` only when `dateKey` falls outside the current run:

```ts
export function requestScrollToDate(dateKey: string): void {
  const { agendaLoadedChunks: run } = calendarView.getState()
  const target = chunkIndexFor(parseDateString(dateKey)!, ws)
  const loaded = run !== null && target >= run.first && target <= run.last
  calendarView.setState({
    agendaAnchor: dateKey,
    agendaScrollTarget: dateKey,
    ...(loaded ? null : { agendaLoadedChunks: null }),
  })
}
```

`ws` is the wrinkle: this is a plain setter with no hook context. Either thread
it from the caller or keep the locale week-start in `calendarView` — decide
before starting. Browsing one month at a time is inside the seeded ±1-chunk run
(84 days) essentially always, so the common gesture becomes free; a distant jump
still reseeds correctly.

### 2. Stop the anchor from invalidating row assembly

Even with #1, `anchorMs` in `computeAgendaSections`' `assemblyReusable` gate
forces a full `assembleAgendaRows` per swipe. The anchor's only jobs there are
seeding an empty section for the anchor day and computing `goToRowIndex`.
Deriving `goToRowIndex` by looking the row up in the assembled list — rather
than baking `anchor` into the cache key — makes an anchor move free whenever
the rows themselves did not change.

### 3. Get the scroll out of the animation frames

The `agendaScrollTarget` leg is 2 of the 3 long tasks (767 → 245 ms when
dropped). The scroll does not need to happen at `select`; it needs to happen
once, when the gesture is done. Either fire the agenda's browse only from
`onBrowseMonth` — while keeping *some* cheap preview so the panel's own
highlight still tracks — or have AgendaView defer `scrollToIndex` until the
carousel reports `onRecentered`.

Note the measured trap: dropping the preview *without* doing #1 and #2 makes
the worst frame slightly worse, because all the work relocates to settle. #3 is
only worth doing on top of the first two.

### 4. Collapse the double fire

`requestScrollToDate` runs twice per swipe with the same date. Once #1 and #2
land the second call is nearly free, but a guard (bail when the anchor already
equals `dateKey` and nothing else moved) removes it outright.

### 5. Put a gate on it, or this comes back

There is no regression test for any of this, and this is the third distinct
root cause found for the same user-visible symptom. Two options, cheapest
first:

- **A unit-level cost assertion.** Drive `MiniMonth`'s `onPreview`/`onCommit`
  the way `MiniMonth.preview.test.tsx` already does, with a spy on
  `computeExpansionCache` / `assembleAgendaRows`, and assert a browse inside the
  loaded run triggers **zero** full expansions and **zero** row re-assemblies.
  Runs in jsdom, catches the actual regression, no browser needed.
- **A frame-budget smoke check**, alongside `scripts/layout-smoke.mjs`, using
  the recipe below.

## Reproducing the measurement

Not committed as a script (`scripts/perf/` is already under an expiry notice —
see `plans/vault-scaling-results.md`); the recipe is the artefact.

1. `pnpm exec vite --port 5201 --strictPort` — the **dev** server, because
   `meridian_bigvault` is gated on `import.meta.env.DEV`. (`vite build` sets
   `DEV=false` whatever `--mode` says, so a built bundle cannot carry the
   generator.)
2. Playwright at `viewport 412×915`, `hasTouch`, `isMobile`. `addInitScript`
   setting `meridian_bigvault` and `meridian_locale_prefs`
   (`{hour12:false, firstDayOfWeek:1}`), plus a rAF loop recording
   `[timestamp, delta]` pairs and a `longtask` PerformanceObserver.
3. Load the view, then **wait for quiet** — no long task for 1.5 s — or vault
   parse/expand is still running and contaminates everything.
4. Click `[aria-controls="quickNavPanel"]`. Find the **on-screen**
   `#quickNavPanel [data-slot="calendar"]`; the buffer panes sit at negative x
   and dragging one measures nothing.
5. Drive the drag with CDP `Input.dispatchTouchEvent` — Embla 8 listens for
   `touchstart`/`touchmove`/`touchend` and `mousedown`/`mousemove`/`mouseup`,
   **not** pointer events, so synthetic `PointerEvent`s are silently ignored
   and the swipe appears free.
6. Cut the frame log to `[touchend, touchend + 900 ms]`. That window — not the
   whole gesture — is the number that corresponds to the reported jank.
