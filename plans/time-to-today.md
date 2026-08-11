# Time-to-today on cold start: what is actually taking the second

Investigation of "opening the app sometimes takes up to a second before it
scrolls to today, even though the agenda is already visible" (2026-08-11).

**Status: fixed.** The diagnosis and the measurements are below, then
[What shipped](#what-shipped). Sections up to that point describe the code as
it was; everything they diagnose has since been changed.

Supersedes the framing in
[cold-start-parse-and-agenda-window.md](./cold-start-parse-and-agenda-window.md).
That plan assumed time-to-today was CPU-bound and set out to attack the vault
parse (D) and the agenda window (E). **The reported symptom was not CPU-bound
at all** — it was a boot-ordering problem, gated on the network. What remains of
D and E is real, but it is first-paint work, not time-to-today work. That plan's
baseline table also mis-attributed its single largest row; see
[Correcting the old baseline](#correcting-the-old-baseline).

---

## The headline

On a GitHub-backed vault with a warm Dexie cache, the agenda painted real rows
from cache **immediately**, and then sat on a day roughly a year in the past
until an OAuth token refresh and two GitHub API round trips had completed.
Only then did anything tell it to scroll to today.

Measured on the 300-file generated vault (`generateBigVault(300)`), today's
header row sits **8,078 px — about ten screens — below the top of the row
list**. The virtualizer is seeded at offset 0, so that is exactly where the
first painted frame lands.

That was the second. It is network latency, and no amount of parse or expansion
optimisation touches it.

---

## Root cause 1 — the scroll-to-today signal was behind the network

`AgendaView` seeds its virtualizer from `useAgendaScrollRestore`
([calendar/useAgendaScrollRestore.ts:58](../src/calendar/useAgendaScrollRestore.ts)),
which only seeds at today's row when `calendarView.agendaScrollTarget` is
non-null. That field **started as `null`**
([calendar/viewState.ts](../src/calendar/viewState.ts)), so on a cold start
the first mount fell through to `agendaScrollOffset`, which is `0`.

The only thing that ever set the target on startup was `AppMain`'s
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

## Root cause 2 — the first paint's work was thrown away and redone

When `emitVaultChanged()` finally fired, `AppMain` called
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

`updateFileOccurrenceMap` ([fileOccurrence.ts](../src/fileOccurrence.ts))
ran synchronously inside `setData`, so it blocked first paint. For every slug
it calls `resolveOneSlug`, which does `expandRange(slugItems, roots, BACK,
AHEAD)` over a **±3-year** window
([fileOccurrence.ts](../src/fileOccurrence.ts)) purely to pick one
representative occurrence:

| `fom` window | time | occurrences generated |
|---|---:|---:|
| **±3 yr (the shipped window)** | **283 ms** | **28,528** |
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

## What shipped

All three landed, plus the overdue-by-default change. Ranked by effect on the
reported symptom.

### 1. Seed the agenda at today unconditionally — don't wait to be told

**Effect: removes the network gate entirely. Time-to-today is now the first
painted frame.** This is the fix for the actual complaint.

The agenda already knows how to land on today on its first painted frame — PR
#645's `initialOffset` seeding does exactly that. It just never gets the
signal in time. Two parts:

**(a) Today is the default, not a request.** `calendarView.agendaScrollTarget`
now initialises to `fmtISO(startOfToday())` instead of `null`
([viewState.ts](../src/calendar/viewState.ts)). The first mount seeds at today
with no signal from anywhere, and `markAgendaScrolled` clears it exactly as
before, so in-session remounts still restore the saved offset.
`agendaScrollOffset` is `0` on a cold start anyway, so nothing is lost —
offset 0 is not a restored position, it is the absence of one.
`resetCalendarViewState`'s `getInitialState()` staleness workaround was
extended to this field (the same treatment `currentDate`/`agendaAnchor` get).

A one-line change that makes time-to-today independent of
`ensureFreshAccessToken`, `ensurePermission`, and the vault backend entirely.

**(b) The calendar caches survive the pre-painted vault's own activation.**
`onVaultChanged` now carries `VaultChange.contentReplaced`
([vaultRegistry.ts](../src/storage/vaultRegistry.ts)), which is `!prePainted` —
false exactly on the cache-first restore, where the vault being activated is
the one already on screen. `AppMain` skips `resetCalendarOnVaultChange()` on
that path instead of discarding 151 ms of freshly-built expansion and grouping.
Genuine switches, empty-cache restores and every example-vault fallback still
report `true` and reset as before.

Pinned by two tests in `vaultRegistry.test.ts`'s cache-first suite (the
`contentReplaced` value on each path) and one in
`useAgendaScrollRestore.test.ts` (a cold start with no request still seeds at
today rather than at `agendaScrollOffset`). The absence of an assertion on the
scroll signal — as opposed to the content — is what let this ship.

### 2. Take `fom` off the first-paint path

**Effect: −240 ms of blocking work on a 300-file vault; the largest single
item.**

`fom` is no longer a store field. `fileOccurrenceMap(items, roots)`
([fileOccurrence.ts](../src/fileOccurrence.ts)) derives it on demand, memoized
on input identity so it behaves as a pure derivation when called during render;
the four reactive consumers go through the new `useFileOccurrenceMap` hook and
`storeBridge.getFom()` routes through the same memo. `setData` calls
`warmFileOccurrenceMap`, which builds it in an idle callback — so the editor
and search overlay get a memo hit rather than paying the resolve on open, and a
burst of sync merges warms once for the final state rather than queueing.

Both halves are load-bearing: lazy alone would just move the 240 ms to the
first editor open; warming alone would still need somewhere correct to read
from before idle ran.

Deliberately *not* done: shrinking the ±3-year window (±1 yr is 135 ms, ±90 d
is 36 ms). That changes which occurrence a file resolves to, so it is a
behaviour change rather than an optimisation, and it is unnecessary now the
build is off the critical path. The
28,528-occurrences-for-300-representatives ratio does suggest `resolveOneSlug`
could answer most slugs without a full expansion — a cheap "next/previous
instant" query rather than materialising every occurrence in six years — but
that is a follow-up, not a prerequisite.

### 3. Get `roundTripLoss` off the load path

**Effect: −92 ms, i.e. 75 % of `parseFiles`.** This is the old plan's **D2**,
and its blocking prerequisite **D1 is now measured** — the answer is yes, the
guard *is* the dominant parse cost, not a footnote.

The split within it is worth noting: only 15 ms is the collapse+serialize the
check actually needs. **70 ms is the two extra `loadFile` calls**, which
re-parse frontmatter the loader already parsed. So even keeping the guard on
the load path, restructuring it to reuse the parse it was handed would recover
most of the cost.

Took the old plan's recommendation — **the full sweep is deferred to
`requestIdleCallback` batches after first paint**, keeping 100 % coverage and
the toast unchanged. `parseFiles` now returns an `auditRoundTrip` thunk instead
of a `lossy` array; it captures the `(path, content, parsed)` triples so the
audit does not re-parse, and it only ever sees files exactly as they were
loaded (the check is unsound on an edited round trip). All three callers,
including `mergeChangedIntoStore`, get it — so this is a win on every sync, not
just cold start.

Not done, and worth keeping in mind: even inline, restructuring the guard to
reuse the parse it was handed would recover 70 of its 92 ms. If it ever needs
to move back onto a hot path, that is the lever.

### 4. Overdue expanded by default

Requested alongside the three above, and a natural fit: scroll-to-today already
targets the overdue section's header when there is one
([agendaSections.ts](../src/calendar/agendaSections.ts)'s `preferOverdue`), so
"scroll to today" now genuinely means "scroll to overdue, with Today directly
below it" rather than to a one-line collapsed bar.

`overdueCollapsed` starts `false`. What made this safe is already in place:
`AgendaView` virtualizes *rows*, not sections, so an unbounded overdue section
never mounts more than the viewport plus overscan — the reason it originally
shipped collapsed no longer holds. The header keeps its count and its toggle,
and collapsing stays per-session view state.

One consequence worth knowing: the seeded scroll offset is unaffected (the
overdue header sits *above* its own rows, so `offsetOfRow` never sums them),
but Today is now below the full overdue list rather than one row down. On the
300-file generated vault that is 8,835 rows against 2,033 — and costs 8 ms more
grouping, which is why the totals below are quoted with overdue expanded.

### Combined

| | before | after |
|---|---:|---:|
| `parseFiles` | 135 ms | 39 ms |
| `setData` derived indexes | 241 ms | 1 ms |
| agenda expansion | 85 ms | 70 ms |
| agenda grouping | 66 ms | 57 ms |
| duplicated on the reset | +151 ms | — |
| **blocking before the first correct frame** | **≈530 ms** | **167 ms** |
| **gated on the network?** | **yes, up to ~1 s** | **no** |

Time-to-today goes from "up to a second" to "the first frame the agenda
paints".

---

## On the progressive window (±1 week → ±1 month → ±1 quarter)

The instinct is right about the mechanism and the numbers back it — ±7 d is
5.8 ms against 151 ms — but **it does not attack the reported symptom.** Now
that #1 has landed the agenda is already on today in its first painted frame;
the remaining 127 ms of expansion + grouping delays *that frame*, it does not
delay the scroll. So this is a first-paint optimisation, worth doing for its own
sake and for the infinite-scroll synergy — see the re-scoped **E** in
[cold-start-parse-and-agenda-window.md](./cold-start-parse-and-agenda-window.md),
which now carries the design.

Two things to carry into that design:

**The overdue constraint is real and is the whole difficulty.** The overdue
section pools every undone task from every past day — that is why
`PAST_WINDOW_DAYS` went from 7 to 365 in the first place. A ±7-day first pass
shows a *wrong* overdue count, and since `goToIndex` prefers the overdue
section when it exists
([agendaSections.ts](../src/calendar/agendaSections.ts)), a wrong overdue
section means a wrong scroll target — the one thing this whole investigation is
about. Widening the window afterwards would then shift today's row underneath a
scroll position that was already committed. Now that overdue also ships
*expanded*, a truncated pool is directly visible on the landing screen rather
than hidden behind a collapsed bar.

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

Both probes were temporary and have been removed — the behaviour they proved is
pinned by real tests now (see [What shipped](#what-shipped)). To rebuild the
*measurement* harnesses:

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
