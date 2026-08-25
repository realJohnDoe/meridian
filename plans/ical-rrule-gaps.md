# Is Meridian a superset of iCal/RRULE? Gap survey and effort estimate

Investigation of "ideally Meridian would support a superset of the iCal / RRule
standard — where are the gaps?" (2026-08-16).

**Status:** all of Group 1 (the silent-wrongness bugs) and the engine/importer
half of Group 2's yearly gap have shipped, along with ICS export. What's left:
a yearly month/weekday-pattern picker in the authoring UI (gap A/B below), and
`WKST` (gap G), which is recommended to stay deferred — see that gap's own
entry for why. Every claim marked _observed_ was run against the current
engine; every claim marked _read_ comes from the code with the line cited.

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
- **`WKST`** (gap G) is unimplemented, deliberately — see its entry.

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

**A/B. Yearly's `BYMONTH`/weekday-pattern has no authoring UI.**
_Read._ The format, engine (`expansion.ts`'s `monthCandidates`/yearly branch
in `matchesInPeriod`) and importer (`rruleToRepeat.ts`'s yearly arm of
`tryRepresent`) all fully handle `bymonth`, `bymonthday`, and
`byweekday`+`bysetpos` at `freq: yearly` — a hand-authored or imported
"fourth Thursday of November" round-trips correctly and keeps meaning that
indefinitely, not just inside an importer's bounded window.

What's missing is a way to *create* one of these without hand-editing YAML.
`RepeatForm` has no field that can hold a month set or a yearly
weekday-pattern, and `formToRepeat`'s asymmetry (documented as "asymmetry 6"
in `model/repeat.ts:99-105`) carries a yearly repeat's `BY*` fields through
the form unchanged *specifically because* the form cannot rebuild them from
its own state — opening "the fourth Thursday of November" in the dialog and
pressing Set must not silently turn it into "November 27th."

Closing this means giving `yearly` the same same-day / weekday-pattern picker
`monthly` already has (`RepeatDialog.tsx:222-256`), plus month selection.
`RepeatForm` needs a field that can hold a month set, and `formToRepeat`'s
monthly-field-rederivation contract (`repeat.ts:82-85`) needs the equivalent
treatment for yearly without breaking the round-trip guarantees
`repeatForm.test.ts` pins down. Estimated **1–2 days** — pure UI/form work,
no engine or format changes.

**G. No `WKST`.**
_Read._ Meridian pins each weekly window to the *anchor's* weekday
(`expansion.ts:398`) rather than to `WKST`. This is a deliberate, documented
choice — the long comment at `expansion.ts:378-397` explains it came out of
the data-integrity survey, and it makes a file mean the same thing on every
device. For `INTERVAL: 1` it is provably equivalent to any `WKST`. It diverges
only for `INTERVAL >= 2` combined with `BYDAY` naming a day earlier in the RFC
week than the anchor's, which the importer detects exactly
(`weeklyWindowsAgree`, `rruleToRepeat.ts:305-315`) and routes to fallback.

Closing this means adding `wkst?: Weekday` and threading it through
`matchesInPeriod`/`periodsBetween`. The code is small; the care is in the
default, since any existing biweekly file must keep meaning what it means
today. **Recommend deferring** — it only affects `INTERVAL >= 2` combined with
`BYDAY`, and that case is already correct-by-fallback on import. Estimated
**1–2 days**, all in `model/expansion.ts` and its types — it's the one
remaining item that touches the file format.

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
