# Cold start: what is left of the blocking parse and the agenda's 455-day window

What remains of the 2026-08-08 scroll-to-today investigation after two rounds
of work. Read [time-to-today.md](./time-to-today.md) first — it holds the
measurements, the boot-ordering root cause, and the record of what shipped.

Closed since the original plan, and deliberately not repeated here:

- **A/B/C** — virtualizer seeding and the scroll re-render. Shipped in PR #645
  (`1eda75b`).
- **D1** — "measure the `roundTripLoss` split before acting on it". Measured:
  the guard is **75 % of `parseFiles`**, and 70 of its 92 ms is the two extra
  `loadFile` calls it makes internally. It was the dominant parse cost, not a
  footnote.
- **D2** — the guard is off the load path. `parseFiles` now returns an
  `auditRoundTrip` thunk that sweeps every file in `requestIdleCallback`
  batches after first paint; coverage and the toast are unchanged. All three
  `parseFiles` callers, including the per-sync `mergeChangedIntoStore`
  reconcile, got it together.
- **The old "measured baseline" table** — withdrawn. Its largest row (314 ms
  attributed to "`model` chunk (YAML)") folded in `updateFileOccurrenceMap`'s
  per-slug ±3-year `expandRange`, which lives in the same chunk but is not YAML
  parsing at all. That work is now off the critical path entirely; see
  time-to-today.md for the replacement figures.

What is left is **D3/D4** (the ~40 ms of genuine parse that remains) and **E**
(the agenda window). Both are first-paint work. Neither affects time-to-today,
which is now settled.

Current blocking cost before the first correct frame, 300-file generated vault,
Node with the dev transform — treat the shares as real and the absolutes as
inflated:

| Stage | Time |
|---|---:|
| `parseToStoreItems` | 39 ms |
| `setData` → `buildBacklinkIndex` | 1 ms |
| `expandWithMultiday` −365/+90 | 70 ms |
| `computeAgendaSections` | 57 ms |
| **total** | **167 ms** (was ~530 ms) |

So the agenda's own pipeline (**E**, 127 ms) is now the larger half and the
parse (**D**, 39 ms) the smaller — the reverse of the original plan's ordering.
Re-measure against a production trace before starting either.

---

## D — the remaining parse

`hydrateFromCache` ([storage/vaultRegistry.ts](../src/storage/vaultRegistry.ts))
reads every cached file out of Dexie and hands it to `parseFiles`
([storage/sync.ts](../src/storage/sync.ts)), still a single synchronous `for`
loop. Nothing paints until it returns.

At 39 ms on this vault it is no longer the headline, but it scales with vault
size and is materially worse on mobile. D3 and D4 are **alternatives, not a
sequence**; D4 subsumes D3 if it lands.

### D3 — Take the parse off the main thread

`parseFiles` is a **pure function of `files`** — no DOM, no store, no
`activeBackend`. That makes it directly worker-eligible, which is the main
reason to prefer this over restructuring the call site.

- **Transfer shape:** in `{path, content}[]` (strings), out `StoreItem[]` +
  `Roots` (a `Map`) — `StoreItem.metadata.jsTime` is a `Date`. All
  structured-cloneable, so no manual serialization is needed.
- **The risk is the clone, not the parse.** A vault's worth of strings in and
  a large object graph out could plausibly cost 30–80 ms of clone on each
  side, which at 39 ms of parse would now be a straight loss. **Measure the
  clone cost with a stub worker that echoes the input back before writing any
  real parsing logic.** If the round-trip clone is more than ~30 % of the parse
  it replaces, stop and take D4 instead.
- Console warnings inside the loop (`[vault] parse failed…`) need to become
  part of the returned payload rather than direct `console.warn` calls.
- The deferred round-trip audit would have to move too, or keep its own copy of
  the file contents — it needs the `(path, content, parsed)` triple.

**Explicitly rejected: chunking the parse across frames.** It would keep the
main thread responsive but would *not* make first-correct-paint sooner, and a
partially-parsed vault yields a wrong overdue list and a wrong today section —
so the agenda cannot paint progressively anyway. It trades a visible block for
the same duration of jank with no benefit.

### D4 — Cache the derived items, not just the raw markdown

The structural fix, and the one that makes cold start not parse *at all*. Also
the fallback if D3's clone cost sinks the worker.

Today the Dexie `files` table stores raw `content`
([storage/cache/files.ts](../src/storage/cache/files.ts)), and it is
simultaneously the sync source of truth (dirty flags, base versions,
tombstones) — so it **cannot be replaced** with parsed output. Add a *second*,
derived table instead:

```
derived: 'vaultId'   // { vaultId, parserVersion, contentStamp, items, roots }
```

- `parserVersion` is a hand-bumped constant in `model/`. Any change to parsing
  or collapse semantics bumps it, invalidating every cached derivation. This
  is the part that is easy to get wrong and expensive to get wrong — a stale
  derivation is silent data corruption from the user's point of view.
- `contentStamp` guards against the `files` table moving underneath it. Cheap
  and sound: `files.where('vaultId').equals(id)` already scans the rows, so
  fold `updatedAt` and row count into a stamp during that scan rather than
  hashing content.
- Write it after every `setData` that came from a full parse; drop it on any
  write to `files` for that vault.
- The round-trip audit must still run on a derived-cache hit — it is the guard
  against a parser regression, and a cache hit is exactly the case that never
  re-parses. Either persist the audit's verdict alongside the derivation
  (keyed by the same `parserVersion`), or re-parse for the audit alone in idle.

Cold start then becomes one Dexie read plus a structured clone, with the
existing parse path as the fallback whenever the stamp or parser version
misses.

---

## E — the agenda's 455-day window

`useAgendaSections` ([calendar/useAgendaSections.ts](../src/calendar/useAgendaSections.ts))
expands, groups and sorts `PAST_WINDOW_DAYS = 365` + `FUTURE_WINDOW_DAYS = 90`
days on every cold start: 70 ms of expansion plus 57 ms of grouping, cached
thereafter by `sectionsCacheSlot` and `cacheByWindow`.

Two things have changed since this was written:

- **It is now the larger half of what is left**, not "a distant second". The
  original ordering assumed a 314 ms parse that turned out to be mostly
  something else.
- **The duplicate build is gone.** `resetCalendarOnVaultChange` used to fire on
  the initial activation too, discarding this work right after the first paint
  and rebuilding it. It now runs only when the vault's content was actually
  replaced (see `VaultChange.contentReplaced`).

### The constraint that makes the obvious version wrong

"Only build rows from today forward, prepend past days on scroll-up" **does
not work as stated**. The overdue section pools every undone task from every
past day — that is why `PAST_WINDOW_DAYS` was widened from 7 to 365 in the
first place. Skipping past days means an incomplete overdue list, which is a
correctness regression, not a perf trade.

It is now also a *visible* one: overdue ships expanded and scroll-to-today
targets its header, so a truncated overdue pool is the first thing the user
sees, not a collapsed bar.

The two halves must be separated:

- **Scanning** the past is required, for overdue. It is a filter + pool over
  already-expanded occurrences.
- **Materializing rows** for past *day-sections* is not. Only past days with
  non-overdue leftovers produce a section at all (`buildBucket` returns
  `section: null` otherwise), and on a typical vault most past days are either
  empty or fully drained into overdue.

So the shape of E, if it is taken:

1. Keep the expansion window as-is; keep pooling overdue across all of it.
2. Build `rows` for past day-sections **lazily** — materialize today-forward
   plus overdue eagerly, and past day-sections only when the user scrolls
   above the overdue header.
3. That requires a stable total size for the un-materialized region so the
   scrollbar and the seeded offset stay honest — a per-day row *count* and
   estimated height, which `buildBucket` can produce without building the
   rows.

This is also the right primitive for infinite scroll: one lazily-materialized
region with a stable estimated size works in both directions, where a
three-step window widening does not (each widening shifts today's row under a
scroll position that was already committed).

Note that `offsetOfRow` in `useAgendaScrollRestore` sums every row above the
target on mount; step 2 makes that loop trivially short, which is a small
bonus rather than the point.

### Cheaper alternatives to consider first

- **Shrink `FUTURE_WINDOW_DAYS`.** 90 days of future rows are materialized on
  every cold start and are almost never scrolled to, and — unlike the past
  direction — nothing pools forward, so there is no correctness coupling at
  all. Cutting it to ~30 is a one-line change and should be measured before any
  of the above is attempted.
- **Split expansion from grouping across a paint.** Expand + pool overdue and
  today eagerly; do the rest of the grouping in an idle callback. Smaller
  change than lazy rows, most of the benefit — and the idle infrastructure
  (`lib/idle.ts`) already exists.

---

## Acceptance

Re-run a cold-start trace (production build, hot Dexie cache, the 300-file
generated vault) and compare against the 167 ms table above:

- **D3 or D4:** no single main-thread task over ~100 ms between navigation and
  first correct paint.
- **E:** `calendar`-chunk attribution over the load window drops below ~60 ms.

Correctness gates that must not regress:

- a parser change invalidates every derived cache entry (D4);
- the round-trip audit still visits every file that parsed, and still surfaces
  a real loss, on the derived-cache-hit path as well (D3/D4);
- the overdue section contains exactly the same occurrences before and after
  (E).
