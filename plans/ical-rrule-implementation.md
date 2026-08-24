# Closing the iCal/RRULE gaps: PR plan

Implementation plan for the gaps surveyed in
[ical-rrule-gaps.md](./ical-rrule-gaps.md), plus ICS export. Originally nine
PRs, each independently shippable, with a recommended model per PR.

**Status: PR1 shipped ([#750](https://github.com/realJohnDoe/meridian/pull/750)).
PR2 shipped ([#757](https://github.com/realJohnDoe/meridian/pull/757)). PR3
shipped ([#759](https://github.com/realJohnDoe/meridian/pull/759)). PRs 4–9 not
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
PR5 ─ (independent)
PR6 ──► PR7 ──► PR8
PR9 ─ (optional, any time)
```

## The PRs

| # | Title | Model | Est. | Touches format? |
|---|---|---|---|---|
| 5 | `bysetpos` as a list; drop importer's `< -1` refusal | Sonnet 5 | 0.5d | yes (`bysetpos`) |
| 6 | `bymonth` + yearly `BY*` in the engine | **Opus 5** | 1.5–2d | yes (`bymonth`) |
| 7 | Importer claims the yearly/`bymonth` shapes | **Opus 5** | 0.5–1d | no |
| 8 | ICS export: file emission + entry point | Sonnet 5 | 1.5–2d | no |
| 9 | `WKST` (optional) | **Opus 5** | 1d | yes (`wkst`) |

Total PRs 5–8: **4–5.5 days** (PRs 1–4 have shipped — see status above). That is
higher than the 6–10-day range in the survey's bottom row only in bookkeeping:
the survey counted implementation, this counts implementation plus per-PR tests,
review and CI.

The three remaining PRs that touch `types.ts` are the ones to slow down on.
`repeat:` is written to YAML verbatim and read back with an unchecked cast, so
there is no schema to migrate — which cuts both ways: widening the type is
free, and nothing will catch a mistake.

---

### PR 5 — `bysetpos` as a list; drop the importer's `< -1` refusal

**Model: Sonnet 5** · 0.5d · touches format (`bysetpos`)

Fixes gaps C and E. `bysetpos?: number | number[]` in `types.ts`, reading the
scalar for back-compat. The engine's single index lookup (`expansion.ts:286`)
becomes a loop over positions with dedup and sort. The importer stops rejecting
`bysetpos.length !== 1` (`rruleToRepeat.ts:195`) and `pos < -1`
(`rruleToRepeat.ts:191`) — the engine already resolves `-2` correctly, verified
in the survey, so that rejection is pure over-conservatism.

No UI change: the dialog keeps deriving one position from the anchor date.

**Why Sonnet:** mechanical once the type shape is chosen, and
`repeatToRrule.test.ts`'s round-trip corpus guards it.

---

### PR 6 — `bymonth` + yearly `BY*` in the engine

**Model: Opus 5** · 1.5–2d · touches format (`bymonth`)

The design PR. Fixes gaps A and B — the one gap with real user-visible weight
(Thanksgiving, Mother's Day, quarterly-on-the-first-Monday).

- Add `bymonth?: number[]` to `Repeat`.
- Restructure `matchesInPeriod` (`expansion.ts:233`) so the yearly branch
  expands over the months `bymonth` names — defaulting to the anchor's month —
  and within each month reuses the monthly branch's candidate selection
  (`bymonthday`, or `byweekday` + `bysetpos`, or the anchor's day).
- Apply `bymonth` as a *limit* for daily/weekly/monthly.

The exact shape to port is `periodCandidates` / `monthCandidates` /
`passesLimits` (`rruleToRepeat.ts:328-410`), already written against the RFC's
expansion-vs-limit table.

**Watch:** the yearly branch currently returns at most one date per period.
`periodsBetween`'s analytic skip (`expansion.ts:212`) must stay correct once
yearly can produce many dates per period, and `PERIOD_WALK_LIMIT` (the backstop
PR 2 left behind) applies here too.

**Why Opus:** this decides what `yearly` *means* in the file format. A subtly
wrong answer is silent, lands in vault files, and survives.

**Acceptance:** Thanksgiving (`FREQ=YEARLY;BYMONTH=11;BYDAY=4TH`), Mother's Day
(`FREQ=YEARLY;BYMONTH=5;BYDAY=2SU`), and a twice-yearly `BYMONTH=3,9` all
produce correct dates across a leap year. `repeatToRrule.test.ts`'s corpus
extended to cover the newly representable shapes, and the `STILL_DECLINED` list
in it trimmed of the entries this PR claims.

---

### PR 7 — Importer claims the yearly/`bymonth` shapes

**Model: Opus 5** (Sonnet 5 if PR 6 enumerates the shapes) · 0.5–1d

Delete the anchor-equality checks at `rruleToRepeat.ts:205-208`, map `BYMONTH`,
and allow yearly with `BYDAY` + `BYSETPOS`. Following the file's own convention,
every newly claimed shape gets its equivalence argument written at the check.

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
- For the three format-touching PRs (5, 6, 9): a YAML round-trip case, and a
  check that no existing fixture or snapshot in
  `src/model/__tests__/__snapshots__/` silently encodes the old behaviour.
