# Closing the iCal/RRULE gaps: PR plan

Implementation plan for the gaps surveyed in
[ical-rrule-gaps.md](./ical-rrule-gaps.md), plus ICS export. Originally nine
PRs, each independently shippable, with a recommended model per PR.

**Status: PR1 shipped ([#750](https://github.com/realJohnDoe/meridian/pull/750)).
PR2 shipped ([#757](https://github.com/realJohnDoe/meridian/pull/757)). PR3
shipped ([#759](https://github.com/realJohnDoe/meridian/pull/759)). PR4 open
([#799](https://github.com/realJohnDoe/meridian/pull/799)). PR5 shipped. PR6
implemented — the engine, the exporter and the format now carry `bymonth`. PRs
7–9 not started.**

**PRs 6 and 7 ship together.** The round-trip corpus in
`storage/ical/repeatToRrule.test.ts` is built by feeding RRULEs through the
*importer*, and it pins `CLAIMED.length === CORPUS.length` — so a corpus entry
the importer still declines fails the suite rather than covering anything, and
`STILL_DECLINED`'s yearly rows can only be trimmed by the PR that claims them.
PR 6's stated acceptance is therefore not reachable from the engine side alone.
Both engines' oracle — the RFC-shaped walk `expandRRule` — is untouched by
either PR, which is what keeps the combined change honest: do not edit it.

---

## How the model recommendation was made

**Opus 5** where the PR *decides semantics* — what a rule means in the file
format, whether a mapping is provably equivalent, back-compat for vault files
already on disk, or a design with a performance/caching interaction. Getting
these wrong is silent and durable: it lands wrong dates in somebody's calendar,
or quietly changes what a file they wrote last year means.

**Sonnet 5** where the semantics are already pinned down — by a spec written in
the PR description, or by a working reference implementation elsewhere in this
repo — and the remaining work is a mechanical edit plus thorough tests.

This codebase is unusually well set up for that split, because
`storage/ical/rruleToRepeat.ts` already contains a second, RFC-shaped
implementation of most of the recurrence logic (`monthCandidates`,
`passesLimits`, `applySetPos`). Several PRs below are "port that shape into the
engine", which is Sonnet work with an exact reference — not open-ended design.

## Ordering

The regression net is already in place: `storage/ical/repeatToRrule.test.ts`
expands every rule through both engines and compares the dates, so the
expressiveness work below is guarded as it lands. Extend its corpus with each
newly representable shape.

```
PR7 ──► PR8
PR9 ─ (optional, any time)
```

## The PRs

| # | Title | Model | Est. | Touches format? |
|---|---|---|---|---|
| 7 | Importer claims the yearly/`bymonth` shapes | **Opus 5** | 0.5–1d | no |
| 8 | ICS export: file emission + entry point | Sonnet 5 | 1.5–2d | no |
| 9 | `WKST` (optional) | **Opus 5** | 1d | yes (`wkst`) |

Total PRs 7–8: **2–3 days** (PRs 1–6 are done — see status above). That is
higher than the survey's bottom row only in bookkeeping: the survey counted
implementation, this counts implementation plus per-PR tests, review and CI.

PR 9, the last one that touches `types.ts`, is the one to slow down on.
`repeat:` is written to YAML verbatim and read back with an unchecked cast, so
there is no schema to migrate — which cuts both ways: widening the type is
free, and nothing will catch a mistake.

---

### PR 7 — Importer claims the yearly/`bymonth` shapes

**Model: Opus 5** (Sonnet 5 if PR 6 enumerates the shapes) · 0.5–1d

Delete the anchor-equality checks in `rruleToRepeat.ts`'s yearly arm, map
`BYMONTH`, and allow yearly with `BYDAY` + `BYSETPOS`. Following the file's own
convention, every newly claimed shape gets its equivalence argument written at
the check.

PR 6 settled which shapes are equivalent, and `repeatToRrule`'s yearly arm
already states each one as an emitted spelling:

- Yearly with `BYMONTH` and no day-naming part — the day comes from DTSTART in
  both engines.
- Yearly with `BYMONTH` (any number of months) + `BYMONTHDAY`, negatives
  included: resolved per month on both sides.
- Yearly with **one** month + `BYDAY` + `BYSETPOS`: a yearly period holds that
  single month, so the RFC's per-period position and the engine's per-month one
  coincide.
- Yearly with several months and an **ordinal** `BYDAY` naming one weekday
  (`BYMONTH=1,4,7,10;BYDAY=1MO`): §3.3.10 resolves the ordinal within each
  month, which is the engine's reading.
- `BYMONTH` as a limit on daily, weekly and monthly.

Still not equivalent, and still to be declined: several months carrying a
`BYSETPOS` (the RFC applies it once across the year), an ordinal `BYDAY` naming
several weekdays or several positions, and any yearly day-naming part with no
`BYMONTH` at all (the RFC expands it over all twelve months; the engine reads
the anchor's). The corresponding `STILL_DECLINED` rows to trim are the two
yearly ones; the remaining four stay.

**Why Opus:** the entire purpose of `tryRepresent` is refusing to claim a rule
the engine gets subtly wrong — "a series that looks right and silently sits on
the wrong days" is the failure its header comment names. Deciding which shapes
are *now* provably equivalent is the same reasoning PR 6 established. The
round-trip test is a safety net, not a substitute for that judgment.

**Downgrade to Sonnet** if PR 6's description ends with an explicit list of
shapes the engine now handles equivalently — that turns this into a mechanical
edit.

---

### PR 8 — ICS export: file emission + entry point

**Model: Sonnet 5** · 1.5–2d · no format change

Wraps `storage/ical/repeatToRrule.ts` into an actual `.ics`:

- VCALENDAR/VEVENT emission for a vault or a single entry.
- `instances` → `RDATE` / `EXDATE` / `RECURRENCE-ID`. Meridian's per-occurrence
  overrides are richer than `RECURRENCE-ID`, so some metadata won't survive —
  say which in the PR.
- Entry point in `vaultActions.ts`. That's the sanctioned bridge: `components/`
  is barred from importing `@/storage` under invariant 2, and `vaultActions.ts`
  is already the root file that does it for the UI.

**Three product decisions belong in the PR description, not in the model:**
1. Scope — whole vault, one entry, or a filtered view?
2. `after_completion` has no RRULE equivalent. Emit as a single dated event, as
   the currently-projected slot, or skip it?
3. Meridian times are local wall clock. Emit floating times, or `TZID` with the
   viewer's zone?

**Why Sonnet:** the hard part — the recurrence mapping — is already done and
tested. What's left is serialization and plumbing. The open questions above want
*your* answer, not a bigger model.

---

### PR 9 — `WKST` (optional)

**Model: Opus 5** · 1d · touches format (`wkst`)

Add `wkst?: Weekday` and thread it through `matchesInPeriod` / `periodsBetween`.
**It must default to the anchor's weekday**, so every biweekly file already on
disk keeps its current meaning.

**Why Opus despite being ~70 lines:** it's a back-compat decision on the file
format, and the current anchor-pinned behaviour is not an accident — the comment
at `expansion.ts:244-260` records it as a deliberate outcome of the
data-integrity survey (finding #6). Changing it deserves the same standard of
argument that put it there.

**Recommend deferring.** It only affects `INTERVAL >= 2` combined with `BYDAY`,
and the importer already detects that case exactly (`weeklyWindowsAgree`) and
falls back to bounded expansion, so imported feeds are already correct. Skip
until someone actually hits it.

---

## Not in this plan

Sub-daily recurrence (`FREQ=HOURLY/MINUTELY/SECONDLY`, `BYHOUR`, `BYMINUTE`,
`BYSECOND`) and `BYYEARDAY` / `BYWEEKNO` / `BYEASTER`. Both are correctly served
by the existing bounded-expansion fallback; see the survey for why sub-daily
would need a change to the occurrence model itself.

## Per-PR checklist

Per [CLAUDE.md](../CLAUDE.md):

- `pnpm run build` (`tsc -b`) — not `tsc --noEmit`, which misses what CI catches.
- `pnpm run lint` — on a fresh worktree, run the build and
  `pnpm --filter meridian-oauth-worker run cf-typegen` first, or you'll get a
  flood of spurious type-resolution errors.
- A regression test per fix, in `src/model/__tests__/` or
  `src/storage/ical/*.test.ts`, plus the round-trip corpus in
  `src/storage/ical/repeatToRrule.test.ts` where the fix widens what the engine
  can represent.
- For the last format-touching PR (9): a YAML round-trip case, and a
  check that no existing fixture or snapshot in
  `src/model/__tests__/__snapshots__/` silently encodes the old behaviour.
