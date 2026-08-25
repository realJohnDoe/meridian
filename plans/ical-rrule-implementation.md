# Closing the iCal/RRULE gaps: PR plan

Implementation plan for the gaps surveyed in
[ical-rrule-gaps.md](./ical-rrule-gaps.md), plus ICS export. Originally nine
PRs, each independently shippable, with a recommended model per PR.

**Status: PR1 shipped ([#750](https://github.com/realJohnDoe/meridian/pull/750)).
PR2 shipped ([#757](https://github.com/realJohnDoe/meridian/pull/757)). PR3
shipped ([#759](https://github.com/realJohnDoe/meridian/pull/759)). PR4 open
([#799](https://github.com/realJohnDoe/meridian/pull/799)). PR5 shipped. PRs 6
and 7 implemented together — the engine, the format, the exporter and the
importer now carry `bymonth` and the yearly `BY*` shapes. PRs 8–9 not
started.**

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
PR8
PR9 ─ (optional, any time)
```

## The PRs

| # | Title | Model | Est. | Touches format? |
|---|---|---|---|---|
| 8 | ICS export: file emission + entry point | Sonnet 5 | 1.5–2d | no |
| 9 | `WKST` (optional) | **Opus 5** | 1d | yes (`wkst`) |

Total remaining: **1.5–2 days** for PR 8 (PRs 1–7 are done — see status
above). That is higher than the survey's bottom row only in bookkeeping: the
survey counted implementation, this counts implementation plus per-PR tests,
review and CI.

PR 9, the last one that touches `types.ts`, is the one to slow down on.
`repeat:` is written to YAML verbatim and read back with an unchecked cast, so
there is no schema to migrate — which cuts both ways: widening the type is
free, and nothing will catch a mistake.

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
in `expansion.ts`'s weekly arm of `matchesInPeriod` records it as a deliberate
outcome of the data-integrity survey (finding #6). Changing it deserves the
same standard of argument that put it there.

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
