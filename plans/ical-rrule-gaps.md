# Is Meridian a superset of iCal/RRULE? Gap survey and effort estimate

Investigation of "ideally Meridian would support a superset of the iCal / RRule
standard — where are the gaps?" (2026-08-16).

**Status: investigation only.** Nothing here is fixed yet. Every claim marked
_observed_ was run against the current engine; every claim marked _read_ comes
from the code with the line cited.

---

## The headline

Meridian is **not** a superset of RRULE today, but it is much closer than the
gap list suggests, and the distance is mostly in two places rather than spread
across the codebase:

1. **`freq: yearly` reads no `BY*` part at all** and there is no `bymonth`
   field anywhere in the model. Together these block the entire family of
   "Nth weekday of a named month" rules — Thanksgiving, Mother's Day, "second
   Tuesday of March and September". This is the one gap that needs real design.
2. **Four smaller cases where the engine silently produces the wrong dates**
   rather than merely refusing the rule. These are bugs, not missing features,
   and they are cheap.

Everything else is either already representable, correctly declined and routed
to the ICS importer's bounded-expansion fallback, or genuinely not worth
building (sub-daily recurrence).

There is also no ICS **export** path — the `ical` backend is read-only
(`src/storage/icalBackend.ts:65`). "Superset" is currently an unverifiable
claim because nothing can emit an RRULE back out.

## Where the gaps live

Three layers decide what Meridian can express, and they do not agree with each
other. Several gaps below are a disagreement between two of them rather than a
missing capability:

| Layer | File | Decides |
|---|---|---|
| Format + engine | `src/types.ts` (`Repeat`), `src/model/expansion.ts` | What a vault file *can* mean |
| ICS import | `src/storage/ical/rruleToRepeat.ts` (`tryRepresent`) | Which RRULEs become a rule vs. dated instances |
| Authoring UI | `src/editor/dialogs/RepeatDialog.tsx`, `src/model/repeat.ts` | What a user can create |

`tryRepresent` is worth reading as the existing gap inventory — every `return
null` in it is a rule the importer declines. It is deliberately conservative,
and in two cases (E, and negative `BYMONTHDAY` once D is fixed) it is *more*
conservative than the engine actually requires.

Note that `repeat:` is written to YAML verbatim (`collapse.ts:82`,
`result.repeat = s.repeat`) and read back with an unchecked cast
(`storeItems.ts:159`, `n.fields.repeat as Repeat`). There is no schema to
migrate: **widening the `Repeat` type costs nothing on the persistence side.**
The flip side is that today's wrong answers below are reachable by hand-editing
a file, with no validation to catch them.

---

## Gap inventory

### Group 1 — silently wrong today (bugs, not missing features)

These matter more than their size. The ICS importer already refuses to generate
any of them, so they arrive only from hand-authored YAML — but the README
promises hand-authored files are first-class, and each of these produces
plausible-looking dates on the wrong days.

**D. Negative `bymonthday` under-runs into the previous month.**
_Observed._ `{ freq: monthly, bymonthday: [-1] }` anchored 2026-01-31 yields
`2026-01-31, 2026-02-27, 2026-03-30` — it should be the last day of each month
(`01-31, 02-28, 03-31`). Cause: `expansion.ts:277` passes the raw value to
`new Date(year, month, mday)`, and `new Date(2026, 2, -1)` is Feb 27, not the
last day of March. The `mday > daysInMonth` guard above it never fires for a
negative. Fix: resolve negatives the way the importer's own `monthDaysIn`
already does (`rruleToRepeat.ts:317`).

**F. `freq: daily` ignores `byweekday`.**
_Read._ The daily branch is `dates.push(withTime(periodStart))`
(`expansion.ts:235`) with no reference to `byweekday` or `bymonthday`. A
hand-written `{ freq: daily, byweekday: [mo,tu,we,th,fr] }` — the weekdays-only
rule, and the single most common thing anyone would try to write — silently
emits all seven days. Fix: apply both as filters in the daily branch, which is
exactly what RFC 5545 §3.3.10 says they are at that frequency.

**K. Count-bounded series truncate at 500 occurrences.**
_Observed._ `{ freq: daily, end: { type: count, occurrences: 1000 } }` returns
500 occurrences, last 2027-05-15 instead of 2028-09-26. `LIMIT = 500`
(`expansion.ts:316`) caps *periods*, and a count-bounded series cannot use the
analytic skip-ahead above it (`expansion.ts:312`, gated on
`maxCount === Infinity`) because `COUNT` must be tallied from the anchor. So
daily hits the wall at 500 while weekly-with-three-days does not — `count: 900`
over 300 periods returns all 900, _observed_. `COUNT` up to 1000+ is well within
what the RFC and real exporters emit.

**J. `UNTIL` loses its time-of-day.**
_Read._ `generateScheduledDates` computes `endOfDay(untilDate)`
(`expansion.ts:185`), and the importer drops the clock time on the way in —
`endOf` stores `{ type: 'until', date: localDate(instant.when) }`
(`rruleToRepeat.ts:102`). So `UNTIL=20260601T120000Z` keeps a 18:00 occurrence
on June 1. `RepeatEnd` already has an unused `time?` field to hang this on.
Smallest of the four, and the least likely to bite.

### Group 2 — genuinely missing expressiveness

**A/B. No `bymonth`, and `yearly` reads nothing.**
_Observed._ `{ freq: yearly, byweekday: [su], bysetpos: 2 }` anchored
2026-05-10 yields `2026-05-10, 2027-05-10, 2028-05-10` — the anchor's calendar
date, annually, not the second Sunday of May. _Read:_ the yearly branch
(`expansion.ts:295`) hardcodes `anchor.getMonth()` / `anchor.getDate()` and
never looks at `byweekday`, `bymonthday` or `bysetpos`. There is no `bymonth`
field on `Repeat` at all, so even `FREQ=YEARLY;BYMONTH=3,9` has nowhere to go.

The importer is correct about all of this — it refuses any yearly rule whose
`BY*` parts don't reduce to the anchor's own month and day
(`rruleToRepeat.ts:205-208`) and sends it to bounded expansion instead. So
imported feeds show the right dates; they just show them as a wall of explicit
`instances:` rather than as a rule, which means they stop being right once the
±1/+2-year window runs out.

This is the gap with real user-visible weight: annual holidays, "quarterly on
the first Monday", and anything a corporate calendar emits for a yearly event.

**C. `bysetpos` is a scalar.**
_Read._ `bysetpos?: number` in `types.ts`. `BYSETPOS=1,-1` ("first and last
Friday of the month") has no representation, and the importer rejects any list
of length ≠ 1 (`rruleToRepeat.ts:195`). The engine's selection is a single
index lookup (`expansion.ts:286`) that would become a loop.

**G. No `WKST`.**
_Read._ Meridian pins each weekly window to the *anchor's* weekday
(`expansion.ts:261`) rather than to `WKST`. This is a deliberate, documented
choice — the long comment at `expansion.ts:244-260` explains it came out of the
data-integrity survey, and it makes a file mean the same thing on every device.
For `INTERVAL: 1` it is provably equivalent to any `WKST`. It diverges only for
`INTERVAL >= 2` combined with `BYDAY` naming a day earlier in the RFC week than
the anchor's, which the importer detects exactly (`weeklyWindowsAgree`) and
routes to fallback.

Closing this means adding `wkst?: Weekday` and threading it through
`matchesInPeriod`/`periodsBetween`. The code is small; the care is in the
default, since any existing biweekly file must keep meaning what it means
today.

### Group 3 — recommend leaving to the fallback

**H. `BYYEARDAY`, `BYWEEKNO`, `BYEASTER`.** No representation. The fallback
honours the first two as limits (`rruleToRepeat.ts:403-408`). Real-world
exporter usage is approximately zero; the fallback's own comment says as much.

**I. Sub-daily — `FREQ=HOURLY/MINUTELY/SECONDLY`, `BYHOUR`, `BYMINUTE`,
`BYSECOND`.** Structurally out of reach, not merely unimplemented: an
occurrence carries one `time` and a series one anchor time, so "every 2 hours
on weekdays" cannot be a rule without letting an occurrence hold a set of
times. `expandSubDaily` already collapses these to the days they touch, which
is the only sane rendering on a day-grid calendar. Supporting them properly is
a model change an order of magnitude larger than everything else on this page,
for a rule type no personal calendar uses.

**L. Multiple `RRULE`s per component.** Legal but deprecated in RFC 5545; the
importer reads the first. Worth noting that Meridian *can* already express this
— a child node with its own `repeat` is expanded as a nested series
(`expansion.ts:508-513`) — so if it ever matters, it is an importer change
only.

---

## Where Meridian is already a superset

Worth stating, because it is the reason the target is reachable at all:

- **`after_completion`** has no RRULE equivalent whatsoever.
- **Per-occurrence overrides** are strictly richer than `RECURRENCE-ID`: any
  instance can carry its own title, duration, participants, priority or done
  state, and several instances may share a date.
- **`EXDATE` ≡ `excluded: true`**, **`RDATE` ≡ an explicit dated instance** —
  both already round-trip through the importer.
- **Nested series** cover the multiple-`RRULE` case (L).
- **`bysetpos: -2`** works correctly in the engine — _observed_, second-to-last
  Friday resolves to `01-23, 02-20, 03-20, 04-17`. Only the importer and the UI
  refuse it — see gap E in tranche 1.

---

## Effort estimate

Sized in engineer-days for someone with this codebase loaded. Each tranche is
independently shippable and independently valuable; they are ordered by
value-per-day, not by dependency (there are almost none).

### Tranche 1 — the silent-wrongness fixes · **0.5–1 day**

D, F, J, K above, plus:

**E. Importer rejects `bysetpos < -1` the engine handles.** One line
(`rruleToRepeat.ts:191`, `if (pos < -1) return null`) plus a test. The engine
already gets `-2` right, so this is pure alignment.

No type changes, no format changes, no UI. Each fix is 5–10 lines. The real
cost is a regression test per fix and checking that no existing fixture or
snapshot encodes today's behaviour — `src/model/__tests__/` has a
`month-end-overflow.test.ts` and a `monthly-setpos.md` fixture that both want
reading first.

### Tranche 2 — yearly and `bymonth` · **2–3 days**

The only tranche with design in it. Shape:

- Add `bymonth?: number[]` to `Repeat`.
- Restructure `matchesInPeriod` so the yearly branch expands over the months
  `bymonth` names (falling back to the anchor's month) and, within each,
  reuses the monthly branch's existing candidate selection — `bymonthday`,
  `byweekday` + `bysetpos`, or anchor day. The importer's own
  `periodCandidates`/`monthCandidates` (`rruleToRepeat.ts:328-378`) is already
  a working reference implementation of exactly this, written to the RFC's
  structure; the engine change is largely porting that shape across.
- Apply `bymonth` as a *limit* for daily/weekly/monthly (RFC §3.3.10).
- Importer: delete the anchor-equality checks at `rruleToRepeat.ts:205-208` and
  claim the yearly shapes instead.
- UI: give `yearly` the same same-day / weekday-pattern picker `monthly`
  already has, plus month selection. This is the larger half of the tranche —
  `RepeatForm` currently has no field that can hold a month set, and
  `formToRepeat`'s "re-derive monthly fields from `scheduledDate`" contract
  (`repeat.ts:79-100`) has to be extended without breaking the round-trip
  guarantees `repeatForm.test.ts` pins down.
- Persistence: nothing. `repeat` is passed through verbatim.

Doing the engine half alone (~1 day) already fixes imported feeds, since it
lets `tryRepresent` claim the rules instead of expanding them.

### Tranche 3 — `bysetpos` as a list · **0.5 day**

Widen to `number | number[]`, read the scalar for back-compat, turn the index
lookup into a loop, relax the importer's length check. No UI unless you want
one.

### Tranche 4 — `WKST` · **1–2 days**

Small code, careful defaulting. Must default to the anchor's weekday so no
existing biweekly file changes meaning, which means the field is write-only
from import for a while. Lowest value in the list — it only affects
`INTERVAL >= 2 + BYDAY`, and that case is already correct-by-fallback on
import.

### Tranche 5 — ICS export · **2–4 days**

Not a gap-closer, but the thing that makes "superset" checkable. A minimal
exporter over the representable subset is ~1 day; the value is the property
test it unlocks — for every rule `tryRepresent` claims, export it and re-import
it and assert the same dates come back. That test is what would have caught D,
F and B. Emitting `RDATE`/`EXDATE` for the parts that stay unrepresentable
turns it into a full round-trip.

### Not recommended

Sub-daily (I) and `BYYEARDAY`/`BYWEEKNO`/`BYEASTER` (H). The bounded-expansion
fallback is the right answer for both and already exists.

### Totals

| Target | Effort |
|---|---|
| No more silently-wrong dates | **0.5–1 day** (T1) |
| Superset of what mainstream exporters actually emit | **3–5 days** (T1+T2+T3) |
| …plus `WKST` and a verifiable round-trip | **6–10 days** (+T4+T5) |
| Literal full RFC 5545 including sub-daily | **3+ weeks**, needs a model change; not worth it |

The middle row is the one to aim at. After T1–T3, the rules that still fall
through to bounded expansion are ones Google Calendar, Outlook and Apple
Calendar do not emit.
