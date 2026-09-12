# Is Meridian a superset of iCal/RRULE? Gap survey and effort estimate

Investigation of "ideally Meridian would support a superset of the iCal / RRule
standard — where are the gaps?" (2026-08-16).

**Status:** all of Group 1 (the silent-wrongness bugs) and the engine/importer
half of Group 2's yearly gap have shipped, along with ICS export. #1010 (`WKST`)
has also shipped now, on the engine side: `model/expansion.ts` takes an
optional `wkst` on a weekly schedule repeat. The one gap still open is an issue,
not a section here — #1009 (a yearly month/weekday-pattern picker in the
authoring UI). What remains below is the survey itself: the inventory, the
verdicts, and what Meridian already covers. Every claim marked _observed_ was
run against the current engine; every claim marked _read_ comes from the code
with the line cited.

---

## The headline

Meridian is very close to a superset of RRULE today. The engine, the ICS
importer and the file format all agree on daily/weekly/monthly/yearly
`FREQ`, `BYMONTH`, `BYMONTHDAY`, `BYDAY` and `BYSETPOS` (including
`BYSETPOS` as a list), `COUNT`, and `UNTIL` with a time-of-day — the yearly
`BY*` family ("Nth weekday of a named month": Thanksgiving, Mother's Day,
"second Tuesday of March and September") included. The remaining distance is
narrow and specific:

- **The authoring UI has no control for yearly's `BYMONTH`/weekday-pattern
  fields** (gap A/B) — the data model, engine and importer all handle them,
  but `RepeatDialog`/`RepeatForm` can only create "the anchor's month and day,
  annually." Reaching one of these rules today means hand-editing YAML or
  importing a feed that has one.
- **`WKST`** (gap G) is implemented in the engine (#1010) but reachable only by
  hand-editing YAML — see its entry. The ICS importer still routes the one
  case it needs for (`INTERVAL >= 2` with a `BYDAY` earlier than the anchor's
  weekday) to bounded-expansion fallback rather than emitting it; wiring the
  importer to use it natively is unclaimed follow-up work, not tracked as its
  own issue.

Everything else is either already representable, correctly declined and routed
to the ICS importer's bounded-expansion fallback, or genuinely not worth
building (sub-daily recurrence).

ICS **export** now exists (`storage/ical/entriesToIcs.ts`, reached from
Settings per vault): `Repeat` → `RRULE` via `repeatToRrule.ts`, with
`instances:` overrides round-tripping to `EXDATE`/`RECURRENCE-ID`. It covers
one vault at a time, always emits floating times (no `TZID`), and omits
`after_completion` series outright — none of RFC 5545's vocabulary means what
that repeat type means. The `ical` backend itself (`src/storage/icalBackend.ts:65`)
is still read-only; export is a separate, one-shot download rather than a
writable subscription.

## Where the gaps live

Three layers decide what Meridian can express, and they do not always agree
with each other:

| Layer | File | Decides |
|---|---|---|
| Format + engine | `src/types.ts` (`Repeat`), `src/model/expansion.ts` | What a vault file *can* mean |
| ICS import | `src/storage/ical/rruleToRepeat.ts` (`tryRepresent`) | Which RRULEs become a rule vs. dated instances |
| Authoring UI | `src/editor/dialogs/RepeatDialog.tsx`, `src/model/repeat.ts` | What a user can create |

`tryRepresent` is worth reading as the closest thing to a live gap inventory —
every `return null` in it is a rule the importer declines and routes to
bounded expansion instead.

Note that `repeat:` is written to YAML verbatim (`collapse.ts:82`,
`result.repeat = s.repeat`) and read back with an unchecked cast
(`storeItems.ts:159`, `n.fields.repeat as Repeat`). There is no schema to
migrate: **widening the `Repeat` type costs nothing on the persistence side.**

---

## Gap inventory

**A/B. Yearly's `BYMONTH`/weekday-pattern has no authoring UI.** → **#1009.**
_Read._ Format, engine and importer all handle `bymonth`, `bymonthday` and
`byweekday`+`bysetpos` at `freq: yearly`; what is missing is a way to create one
without hand-editing YAML. Estimated 1–2 days, pure UI/form work. The evidence
and the shape of the fix are in the issue.

**G. No `WKST`.** → **#1010, implemented (engine side).**
_Read._ Meridian still pins each weekly window to the anchor's weekday by
default — a deliberate choice out of the data-integrity survey, provably
equivalent for `INTERVAL: 1`. A schedule repeat can now carry an explicit
`wkst?: Weekday` (`types.ts`) that opens the window on that weekday instead;
`matchesInPeriod`'s weekly branch (`expansion.ts`) reads the window's own
opening weekday back off the period cursor rather than off the anchor, so one
formula covers both the default (anchor-pinned) and explicit (`WKST`-pinned)
readings, and an existing file with no `wkst` is byte-for-byte unaffected. The
ICS importer's `weeklyWindowsAgree` (`rruleToRepeat.ts:305-315`) still routes
`INTERVAL >= 2` rules whose `BYDAY` names an earlier weekday to
bounded-expansion fallback rather than emitting the new field — that wiring,
and a `repeatToRrule.ts` export path for an explicit `wkst`, is unclaimed
follow-up, since the field is reachable only by hand-editing YAML today.

### Recommend leaving to the fallback

**H. `BYYEARDAY`, `BYWEEKNO`, `BYEASTER`.** No representation. The fallback
honours the first two as limits (`rruleToRepeat.ts:574-576`). Real-world
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
(`expansion.ts:698-703`) — so if it ever matters, it is an importer change
only.

---

## Where Meridian is already a superset

Worth stating, because it is the reason the target is reachable at all:

- **`after_completion`** has no RRULE equivalent whatsoever.
- **Per-occurrence overrides** are strictly richer than `RECURRENCE-ID`: any
  instance can carry its own title, duration, participants, priority or done
  state, and several instances may share a date.
- **`EXDATE` ≡ `excluded: true`**, **`RDATE` ≡ an explicit dated instance** —
  both already round-trip through the importer, and now through the exporter
  too.
- **Nested series** cover the multiple-`RRULE` case (L).
- **`BYSETPOS` as a list, and negative positions beyond `-1`** (e.g.
  "first and last Friday of the month") work correctly end to end — engine,
  format and importer. Only the authoring UI is narrower: it derives a single
  position from the scheduled date's own place in the month (first ... fourth,
  or last), with no control for a list or an arbitrary negative — by design,
  not tracked as a gap (nothing stops hand-editing YAML for the rest).
