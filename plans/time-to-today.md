# Time-to-today on cold start: what is actually taking the second

Investigation of "opening the app sometimes takes up to a second before it
scrolls to today, even though the agenda is already visible" (2026-08-11).

Supersedes the framing in
[cold-start-parse-and-agenda-window.md](./cold-start-parse-and-agenda-window.md).
That plan assumed time-to-today was CPU-bound and set out to attack the vault
parse (D) and the agenda window (E). **The reported symptom is not CPU-bound at
all** — it is a boot-ordering problem, and it is gated on the network. D and E
are still real, but they are first-paint work, not time-to-today work. The
plan's baseline table also mis-attributes its single largest row; see
[Correcting the old baseline](#correcting-the-old-baseline).

---

## The headline

On a GitHub-backed vault with a warm Dexie cache, the agenda paints real rows
from cache **immediately**, and then sits on a day roughly a year in the past
until an OAuth token refresh and two GitHub API round trips have completed.
Only then does anything tell it to scroll to today.

Measured on the 300-file generated vault (`generateBigVault(300)`), today's
header row sits **8,078 px — about ten screens — below the top of the row
list**. The virtualizer is seeded at offset 0, so that is exactly where the
first painted frame lands.

That is the second. It is network latency, and no amount of parse or expansion
optimisation touches it.

---

## Root cause 1 — the scroll-to-today signal is behind the network

`AgendaView` seeds its virtualizer from `useAgendaScrollRestore`
([calendar/useAgendaScrollRestore.ts:58](../src/calendar/useAgendaScrollRestore.ts)),
which only seeds at today's row when `calendarView.agendaScrollTarget` is
non-null. That field **starts as `null`**
([calendar/viewState.ts:82](../src/calendar/viewState.ts)), so on a cold start
the first mount falls through to `agendaScrollOffset`, which is `0`.

The only thing that ever sets the target on startup is `AppMain`'s
`onVaultChanged` subscription
([routes/\_app.tsx:59](../src/routes/_app.tsx)), and that fires from
`emitVaultChanged()` inside `activateWritableVault`
([storage/vaultRegistry.ts:136](../src/storage/vaultRegistry.ts)) — which is
reached only *after*:

1. `buildBackend` → `ensureFreshAccessToken`
   ([storage/githubOAuth.ts:122](../src/storage/githubOAuth.ts)) — a POST to
   the OAuth Worker whenever the token is near expiry. GitHub App user tokens
   last 8 hours, so **the first open of any day hits this**. This is the
   "sometimes" in the report.
2. `backend.ensurePermission(false)`
   ([storage/githubBackend.ts:300](../src/storage/githubBackend.ts)) — **two
   sequential** `api.github.com` round trips (`GET /repos/{o}/{r}` then
   `GET /repos/{o}/{r}/branches/{b}`).
3. `activeVaultIdSave` — a Dexie write.

Verified with a probe against the existing `vaultRegistry` test harness
(gates on both the token refresh and the permission check):

```
--- cold-start timeline ---
1. PAINT(agenda has rows)
2. tokenRefresh:start
3. tokenRefresh:done
4. ensurePermission:start
5. ensurePermission:done
6. onVaultChanged -> requestScrollToToday()
```

The agenda is fully painted at step 1 and is told where to scroll at step 6.
Everything in between is network. `restoreVaultsInner`'s own comment
([vaultRegistry.ts:246](../src/storage/vaultRegistry.ts)) says this work "only
*refines* content the user can already see" and "None of it may gate first
paint" — which is true of the *content*, but the scroll position was never
brought along.

There is already a test pinning that content paints before `ensurePermission`
(`vaultRegistry.test.ts`, "paints cached content and clears the skeleton
without waiting on ensurePermission"). Nothing pins the scroll signal, which is
how this slipped through.

### Why the local/example vaults don't show it

- **Example vault:** `activateExampleVault` calls `setData` and
  `emitVaultChanged()` in the same synchronous block, so the target is set
  before `AgendaView` ever mounts.
- **Local vault:** `buildBackend` is a Dexie read and `ensurePermission` is
  `queryPermission` — both sub-millisecond, no network.

Only the GitHub path has a network gate here, which is why this reproduces on
`realjohndoe.github.io/meridian` and not in dev.

## Root cause 2 — the first paint's work is thrown away and redone

When `emitVaultChanged()` finally fires, `AppMain` calls
`resetCalendarOnVaultChange()` **before** `requestScrollToToday()`. That clears
both `resetExpansionCache()` and `resetAgendaSectionsCache()` — the caches the
agenda populated for the first paint seconds earlier. The vault has not
changed; this is the initial activation of the vault that was already
pre-painted.

Cost on the 300-file vault: **151 ms** of expansion + grouping (85 + 66, see
below) computed, discarded, and recomputed — on the critical path to the
corrected scroll.

---

## Measured CPU costs

300-file generated vault, `generateBigVault(300)`, median of 7 runs after 2
warmups. **Run under Node with the dev transform, so absolute numbers run high
versus a minified production browser build — the shares and the ratios between
rows are the point, not the milliseconds.**

| Stage | Time | Blocking first paint? | Notes |
|---|---:|---|---|
| `parseToStoreItems` (all files) | 43 ms | yes | the genuine parse |
| `roundTripLoss` (all files) | **92 ms** | yes | **75 % of `parseFiles`** |
| ⤷ its `collapseToYaml` + `saveFile` | 15 ms | | |
| ⤷ its **two extra `loadFile` calls** | 70 ms | | re-parsing frontmatter already parsed |
| `setData` → **`updateFileOccurrenceMap`** | **240 ms** | yes | **the single largest item** |
| `setData` → `buildBacklinkIndex` | 1 ms | yes | negligible |
| agenda `expandWithMultiday` −365/+90 | 85 ms | yes | 8,702 occurrences |
| agenda `computeAgendaSections` | 66 ms | yes | 2,033 rows |
| **total blocking before a correct frame** | **≈ 530 ms** | | of which ~151 ms is paid **twice** (root cause 2) |

### The surprise: `fom` costs more than the parse

`updateFileOccurrenceMap` ([fileOccurrence.ts:116](../src/fileOccurrence.ts))
runs synchronously inside `setData`, so it blocks first paint. For every slug
it calls `resolveOneSlug`, which does `expandRange(slugItems, roots, BACK,
AHEAD)` over a **±3-year** window
([fileOccurrence.ts:33](../src/fileOccurrence.ts)) purely to pick one
representative occurrence:

| `fom` window | time | occurrences generated |
|---|---:|---:|
| **±3 yr (shipped)** | **283 ms** | **28,528** |
| ±1 yr | 135 ms | 14,130 |
| ±90 d | 36 ms | 3,667 |

28,528 occurrences are expanded to choose **300** representatives.

And **nothing on the agenda reads `fom`.** Its only consumers are
`editor/ItemsList.tsx`, `editor/WikilinkPopup.tsx`, `search/FileResultsList.tsx`
and `routes/_app.entry.$slug.tsx` — none of which are mounted at cold start.
(`backlinks` *is* read by `AgendaRow`, but costs 1 ms.)

Warm calls are free (0.4 ms) — the reference-equality reuse works. It is only
the cold build that is expensive, i.e. exactly the cold-start path.

### Correcting the old baseline

The old plan's trace attributed **314 ms to the "`model` chunk (YAML)"** and
budgeted `setData` at ~47 ms. `expandRange`/`joinFileMeta`/`stableOccId` all
live in `model/expansion.ts` and are called *from* `fileOccurrence.ts`, so
`fom`'s per-slug expansion lands in the `model` chunk too. A large share of
that 314 ms is `fom` expansion, not YAML parsing. Worth re-checking against a
real trace before acting, but it changes the ordering of the old plan's
priorities.

### Window scaling (relevant to the progressive-window idea)

| Window | expand | sections | rows | total |
|---|---:|---:|---:|---:|
| ±7 d | 4.1 ms | 1.7 ms | 153 | **5.8 ms** |
| ±30 d | 15.7 ms | 9.4 ms | 657 | 25.1 ms |
| −90/+90 | 41.3 ms | 21.8 ms | 1,946 | 63.1 ms |
| **−365/+90 (shipped)** | 84.8 ms | 66.4 ms | 2,033 | **151.2 ms** |

A ±7-day first pass is **26× cheaper** than the shipped window.

---

## Top 3 ways to improve time-to-today

Ranked by effect on the reported symptom, cheapest first within a rank.

### 1. Seed the agenda at today unconditionally — don't wait to be told

**Effect: removes the network gate entirely. Time-to-today becomes the first
painted frame.** This is the fix for the actual complaint.

The agenda already knows how to land on today on its first painted frame — PR
#645's `initialOffset` seeding does exactly that. It just never gets the
signal in time. Two parts:

**(a) Make today the default, not a request.** Initialise
`calendarView.agendaScrollTarget` to `fmtISO(startOfToday())` instead of `null`
([viewState.ts:82](../src/calendar/viewState.ts)). The first mount then seeds
at today with no signal from anywhere, and `markAgendaScrolled` clears it
exactly as today, so in-session remounts still restore the saved offset.
`agendaScrollOffset` is `0` on a cold start anyway, so nothing is lost —
offset 0 is not a restored position, it is the absence of one, and today is the
better default for that case. Note `resetCalendarViewState`'s existing
`getInitialState()` staleness workaround needs extending to this field (same
treatment `currentDate`/`agendaAnchor` already get).

This is roughly a one-line change and it makes time-to-today independent of
`ensureFreshAccessToken`, `ensurePermission`, and the vault backend entirely.

**(b) Don't reset the calendar caches for the vault that was just
pre-painted.** `onVaultChanged` fires on the *initial* activation too, where
`resetCalendarOnVaultChange()` discards 151 ms of freshly-built expansion and
grouping for no reason. Gate the reset on the vault id actually having changed
from the previously-active one (or split the "pre-painted this vault" signal
out from "switched to a different vault"). Keeps the genuine vault-switch
behaviour intact.

Pin it with a test: extend the existing `vaultRegistry.test.ts` cache-first
suite so the scroll-to-today signal is asserted to arrive before
`ensurePermission` resolves, not after. That is the assertion whose absence let
this ship.

### 2. Take `fom` off the first-paint path

**Effect: −240 ms of blocking work on a 300-file vault; the largest single
item.**

Nothing rendered at cold start reads `fom`. `setData` should not build it
synchronously. Cheapest first:

1. **Defer it.** Build `fom` in a `requestIdleCallback` (or a post-paint
   microtask) after `setData` commits, and have the store expose it as it does
   now. Its consumers — editor, search overlay, entry route — all mount well
   after first paint, and each already handles a missing entry (`fom.get(slug)
   ?? null`). Cheapest and lowest-risk.
2. **Make it lazy.** Compute on first read and memoise on `(items, roots)`
   identity. Slightly more machinery, but nothing pays for it unless something
   asks.
3. **Shrink the window.** ±3 yr → ±1 yr is 283 → 135 ms; ±90 d is 36 ms. This
   changes which occurrence gets picked as a file's representative, so it is a
   behaviour change, not a pure optimisation. Only worth it on top of 1 or 2 if
   measurement says the deferred build still hurts.

Recommendation: **(1)**. The 28,528-occurrences-for-300-representatives ratio
also suggests `resolveOneSlug` could answer most slugs without a full
expansion (a cheap "next/previous instant" query rather than materialising
every occurrence in six years), but that is a follow-up, not a prerequisite.

### 3. Get `roundTripLoss` off the load path

**Effect: −92 ms, i.e. 75 % of `parseFiles`.** This is the old plan's **D2**,
and its blocking prerequisite **D1 is now measured** — the answer is yes, the
guard *is* the dominant parse cost, not a footnote.

The split within it is worth noting: only 15 ms is the collapse+serialize the
check actually needs. **70 ms is the two extra `loadFile` calls**, which
re-parse frontmatter the loader already parsed. So even keeping the guard on
the load path, restructuring it to reuse the parse it was handed would recover
most of the cost.

Take the old plan's recommendation — **defer the full sweep to
`requestIdleCallback` batches after first paint**, keeping 100 % coverage and
`reportRoundTripLosses` unchanged. `mergeChangedIntoStore` gets the same win on
every sync for free.

### Combined

Blocking work before the first *correct* frame drops from ≈530 ms (plus the
network gate, plus 151 ms of duplicated work) to ≈195 ms (parse 43 + expand 85
+ sections 66), with the network gate gone entirely. Time-to-today goes from
"up to a second" to "the first frame the agenda paints".

---

## On the progressive window (±1 week → ±1 month → ±1 quarter)

The instinct is right about the mechanism and the numbers back it — ±7 d is
5.8 ms against 151 ms — but **it does not attack the reported symptom.** Once
#1 lands, the agenda is already on today in its first painted frame; the 151 ms
delays *that frame*, it does not delay the scroll. So this is a first-paint
optimisation, ranked 4th, and worth doing for its own sake and for the infinite
scroll synergy.

Two things to carry into that design:

**The overdue constraint is real and is the whole difficulty.** The overdue
section pools every undone task from every past day — that is why
`PAST_WINDOW_DAYS` went from 7 to 365 in the first place. A ±7-day first pass
shows a *wrong* overdue count, and since `goToIndex` prefers the overdue
section when it exists
([agendaSections.ts:395](../src/calendar/agendaSections.ts)), a wrong overdue
section means a wrong scroll target — the one thing this whole investigation is
about. Widening the window afterwards would then shift today's row underneath a
scroll position that was already committed.

So the split the old plan identified still holds, and is the right shape here
too: **scanning** the past is required for overdue and stays whole-window;
**materialising rows** for past day-sections is not, and is what should be
lazy. That also composes with infinite scroll far better than a
three-step widening does — one lazily-materialised region with a stable
estimated size is the same primitive in both directions.

**The future direction is the free half.** `FUTURE_WINDOW_DAYS = 90` is
materialised on every cold start and almost never scrolled to, with no
correctness coupling at all — nothing pools forward the way overdue pools
backward. Cutting it to ~30 is a one-line change worth measuring before any of
the lazy-materialisation machinery is built.

---

## Reproducing the measurements

Both probes were temporary and have been removed. To rebuild them:

- **CPU costs:** a `src/*.test.ts` file that calls `generateBigVault(300)`,
  maps to `{path: `${id}.md`, content}`, then times `parseToStoreItems` /
  `roundTripLoss` / `updateFileOccurrenceMap` / `buildBacklinkIndex` /
  `computeExpansionCache` / `computeAgendaSections` separately, median of 7
  after 2 warmups. Run with
  `pnpm exec vitest run <file> --reporter=verbose --disable-console-intercept`
  (vitest 4 swallows `console.log` from passing tests otherwise).
- **Boot ordering:** clone `src/storage/__tests__/vaultRegistry.test.ts`'s
  hoisted-fake harness, add a gate to the `ensureFreshAccessToken` mock as well
  as the existing `permissionGate`, subscribe to `onVaultChanged`, and record a
  timeline from the `setData` mock.

For the real production numbers, re-run the old plan's trace recipe
(`pnpm run build` + `vite preview`, hot Dexie cache) — the Node figures above
are inflated by the dev transform and should not be quoted as absolutes.
