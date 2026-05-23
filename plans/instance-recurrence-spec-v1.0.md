# Instance Recurrence Model — Specification

**Version:** 1.0  
**Status:** Draft  
**Depends on:** YAML Node Inheritance Model v1.0

---

## Changelog from v0.9

- **Document split:** The inheritance model (previously §§1–3) is now a
  separate specification: *YAML Node Inheritance Model v1.0*. This document
  covers only the temporal, recurrence, and task semantics that build on top
  of it. Cross-references to merge behaviour now point to that document.
- **§1 condensed:** Introduction retains motivation and prior art but removes
  the inheritance model explanation, which now lives in the base spec.
- **§2 updated:** Node structure section now explicitly notes which fields are
  defined here versus inherited from the base spec.
- **§3 removed:** Inheritance model section removed; replaced by a reference
  to the base spec.
- All section numbers shifted accordingly.

---

## 1. Introduction

### 1.1 Design Goals

The model is:

- **Human-readable and human-editable** — no opaque IDs, no encoded mutation
  algebra, no fields that only a machine can produce
- **YAML-native** — the structure is valid, idiomatic YAML with no
  domain-specific encoding
- **Compositional** — instances nest recursively; inheritance follows the
  rules defined in the YAML Node Inheritance Model
- **Type-agnostic** — the same schema applies to events, tasks, habits,
  reminders, and notes; type is inferred from fields present, not declared
- **Standards-compatible internally** — schedule recurrence maps to RFC 5545
  RRULE; durations normalize to ISO 8601; implementations may use standard
  calendar libraries internally without exposing their complexity to users

### 1.2 Rationale

Existing standards and tools handle recurrence in one of two ways, both with
significant drawbacks for human-editable plaintext workflows.

**iCalendar / RFC 5545** is comprehensive but machine-oriented. Its recurrence
model (`RRULE`, `EXDATE`, `RDATE`, `RECURRENCE-ID`) is powerful but opaque —
modifying a single occurrence of a recurring item requires understanding
recurrence mutation algebra. Files are not human-editable in practice, and the
format conflates scheduling semantics with transport encoding.

**Task-manager recurrence** (as seen in tools like TaskNotes, Things, Todoist)
is simpler but task-centric. Recurrence means "regenerate after completion" or
"repeat on a schedule," but the two are separate modes, events and tasks use
different fields, and there is no compositional model for mixed or evolving
recurrence patterns. Overriding a single occurrence typically requires
application-specific workarounds.

This spec takes a different approach:

- **One node structure for everything.** Events, tasks, habits, and notes all
  use the same fields. Type is inferred from which fields are present, not
  declared explicitly. A node with `date` is schedulable; a node with `done`
  is a task; a node with both is both.

- **Recurrence as a property, not a type.** Any node can repeat, regardless
  of whether it is an event or a task. Two recurrence styles — schedule-based
  and completion-based — are available on the same node structure and can
  coexist across sibling instances.

- **Inheritance instead of mutation.** Rather than a flat series with a list
  of exception patches (iCalendar's model), this spec uses the recursive
  instance tree defined in the YAML Node Inheritance Model. Overrides are
  visible in place rather than scattered across exception lists.

- **Human-editable above all.** The format is valid, idiomatic YAML. Every
  field has an obvious meaning. A user who has never read this spec can read a
  node file and understand it. A user who wants to reschedule one occurrence
  adds a few lines; they do not need to understand `RECURRENCE-ID`.

#### Prior Art

**iCalendar / RFC 5545** is the direct ancestor of the recurrence model here.
`RRULE` and `DTSTART` map directly to `repeat` and `date`/`time`. The `UNTIL`
and `COUNT` rules map to the two variants of `end`. What this spec does not
adopt is the exception machinery (`EXDATE`, `RDATE`, `RECURRENCE-ID`) —
instead replacing it with the instance tree.

**ETM (event and task manager)** is a plaintext calendar and task tool with
rich recurrence since 2013. Its `@r` syntax supports complex schedules
including completion-based restart via `@o r`. ETM is the closest prior art in
terms of plaintext recurrence expressiveness, but its format is a custom terse
DSL, exceptions remain a flat list, and there is no inheritance model.

**Org-mode** (Emacs) has three repeater styles — `+`, `++`, `.+` — that
correspond closely to the two recurrence styles in this spec. Org-mode's model
is well-proven but Emacs-specific, not YAML-native, and has no instance
inheritance.

**TaskNotes** (Obsidian plugin) uses RRULE strings in YAML frontmatter with
separate arrays for completed and skipped instances. It is the most direct
inspiration for the Obsidian-compatible framing of this spec.

The key contribution of this spec relative to all of the above is the
**recursive instance tree** defined in the base YAML Node Inheritance Model.
Every existing system uses a flat exception list to modify a generated series.
This spec makes each exception a structured node that inherits from its parent,
can carry arbitrary metadata, and can define its own independent recurrence
regime.

### 1.3 Obsidian Compatibility

Nodes stored as Obsidian markdown frontmatter are fully compatible. Obsidian
parses standard YAML including nested dicts. The properties UI (Obsidian 1.4+)
displays nested fields as raw objects, which is cosmetically unpolished but
does not affect file validity, Dataview queries, or plugin access via
`app.metadataCache`.

### 1.4 What This Spec Does Not Cover

- The inheritance and merge model — see YAML Node Inheritance Model v1.0
- Identity, naming, or linking of nodes — these are application concerns
- Rendering, display, or UI concerns
- How duration should be visualized
- File naming conventions or storage layout
- Timezone display preferences
- Interoperability wire formats (ICS export is an implementation concern)

---

## 2. Node Structure

Every entity in this model is a **node** as defined in the YAML Node
Inheritance Model. This section defines the temporal and task fields that this
spec adds to the open node schema.

### 2.1 Fields

```yaml
# Temporal (defined by this spec)
date:        # optional date (YYYY-MM-DD); series anchor date and first occurrence
time:        # optional wall-clock time ("HH:MM" or "HH:MM:SS"); requires date
timezone:    # optional IANA timezone name; inherited; absent means local time
duration:    # optional human-readable duration (see §4)

# Recurrence (defined by this spec)
repeat:      # optional sum type; defines recurrence style (see §5)

# State (defined by this spec)
done:        # optional boolean; present implies task semantics
excluded:    # optional boolean; excluded occurrences are not emitted in output

# Hierarchy (defined by the base spec)
instances:   # optional list of child nodes; not inherited (see base spec §2.3)

# Arbitrary metadata
# Any additional keys are valid, inherited as scalar product fields,
# and passed through to output unchanged.
```

All fields are optional at the schema level. Applications may impose
additional required fields for their own purposes. Identity and display fields
(such as `title`, `slug`, or `id`) are application concerns and outside this
spec — they are treated as arbitrary metadata and inherited normally.

### 2.2 Inheritance Behaviour

All temporal and state fields (`date`, `time`, `timezone`, `duration`, `done`,
`excluded`) are **scalar product fields** per the YAML Node Inheritance Model.
They merge independently: a child can override any one without repeating the
others.

The `repeat` field is a **sum type** (it contains a `type` key). It replaces
entirely on inheritance — a child's `repeat` block replaces the parent's
wholesale, enabling a child to switch from schedule-based to
completion-based recurrence or to define its own independent recurrence regime.

---

## 3. Temporal Fields

### 3.1 `date`

`date` is a calendar date in `YYYY-MM-DD` format. It is the **series anchor
date and first occurrence date**. Subsequent occurrence dates are generated
from `date` forward according to `repeat`. Absence means the node is
unscheduled (a floating task or note with no calendar position).

### 3.2 `time`

`time` is a wall-clock time in `"HH:MM"` or `"HH:MM:SS"` format (quoted
string). It is optional. If present, `date` must also be present (see V11).

`time` is a scalar product field and propagates independently through
inheritance. A child instance that sets only `time` overrides the wall-clock
time while keeping the parent's `date` and `timezone`. This is the canonical
way to express "same recurring date, different time of day."

> **YAML quoting note:** Bare `HH:MM` values are parsed as integers by
> YAML 1.1 parsers (minutes since midnight). Always quote `time` values:
> `time: "19:00"` not `time: 19:00`.

### 3.3 `timezone`

`timezone` is an IANA timezone name (e.g. `Europe/Vienna`, `America/New_York`,
`UTC`). It is optional and inherited as a scalar product field. Absence means
the node uses local time — the consumer is responsible for interpreting local
time in context.

A top-level `timezone` applies to all generated occurrences and instance
children unless explicitly overridden. This is the recommended pattern for
items involving collaborators across timezones: set `timezone` once at the
root, and override only in the rare instance where an occurrence happens in a
different zone.

Implementations normalize `date + time + timezone` to UTC for recurrence
expansion and JSON output (see §7.1).

### 3.4 `duration`

`duration` is optional. Its absence means the node has no defined duration
(point-in-time). How absent or present duration is visualized is a consumer
concern. It is a scalar product field and is inherited and overridden
independently.

#### Human-Readable Syntax

```yaml
duration: 1h
duration: 2 days
duration: 1d 3h
duration: 15 minutes
duration: 1 week
```

#### Grammar

```
duration     = component (ws component)*
component    = number ws? unit
number       = [0-9]+
unit         = "d" | "day" | "days"
             | "h" | "hour" | "hours"
             | "m" | "min" | "minute" | "minutes"
             | "w" | "week" | "weeks"
ws           = " "+
```

Units are case-insensitive.

#### Internal Normalization

| Human input | ISO 8601 |
|---|---|
| `1h` | `PT1H` |
| `2 days` | `P2D` |
| `1d 3h` | `P1DT3H` |
| `15 minutes` | `PT15M` |
| `1 week` | `P7D` |

### 3.5 Backward Compatibility

Parsers encountering the v0.8 unified `time` field in `YYYY-MM-DDTHH:MM`
format should split it on ingest:

- The date component (`YYYY-MM-DD`) becomes `date`
- The time component (`HH:MM`) becomes `time`
- A UTC offset suffix (e.g. `+01:00`) is recorded but does not automatically
  populate `timezone` (which requires an IANA name, not an offset)

A bare date in the v0.8 `time` field (e.g. `time: 2026-05-21`) maps directly
to `date: 2026-05-21` with no `time`.

This rule applies to both root fields and instance child fields.

---

## 4. `repeat` Field

`repeat` is a **sum type** (tagged union). Per the YAML Node Inheritance Model,
sum types replace entirely on inheritance — no key-level merging occurs. The
active variant is identified by the required `type` field.

Two variants are defined.

### 4.1 Schedule Recurrence (`type: schedule`)

Maps to RFC 5545 RRULE internally.

```yaml
repeat:
  type: schedule
  freq: weekly              # required: daily | weekly | monthly | yearly
  byweekday: [mo, we, fr]  # optional: mo tu we th fr sa su
  bymonthday: [1, 15]      # optional: 1–31; day(s) of month
  bysetpos: 1               # optional: integer; selects the Nth match within
                            # each period (negative counts from end: -1 = last)
  interval: 2               # optional: every N freq-units (default: 1)
  end:                      # optional sum type; absent means unbounded
    type: until
    date: 2026-03-31
```

`freq` is the only required field within a `type: schedule` repeat.

Note: `end.type: until` uses `date` (not `time`) to specify the boundary date.

### 4.2 Completion-Based Recurrence (`type: after_completion`)

The next occurrence is derived from the last recorded completion:

1. Find the child instance in `instances` with the greatest `date`/`time`
   where `done: true`
2. Add `interval` to that effective datetime
3. If the resulting datetime falls within the query range, emit it as the
   next occurrence

If no child instance has `done: true`, the anchor (`date` + `time`) is the
first (and current pending) occurrence.

```yaml
repeat:
  type: after_completion
  interval: 2 days
```

`interval` accepts the same human-readable duration syntax as `duration` (§3.4).

### 4.3 The `end` Field

`end` is a **sum type** nested within `repeat.type: schedule`. It defines
when the series terminates. If absent, the series is unbounded.

**Until a date:**

```yaml
end:
  type: until
  date: 2026-03-31
```

**After a number of occurrences** (not counting the anchor itself):

```yaml
end:
  type: count
  occurrences: 10
```

---

## 5. `instances` Field

`instances` is a list of child nodes as defined in the YAML Node Inheritance
Model. Each child participates in inheritance from its parent. This section
defines the temporal semantics specific to this spec.

### 5.1 Override Matching

A child node in `instances` is matched to a generated occurrence using its
effective `date` and `time` fields (after merge). The matching rule is:

- If the child has both `date` and `time`: match any generated occurrence
  on that calendar date within 60 seconds of that wall-clock time (UTC-
  normalized). This handles floating-point arithmetic drift in date expansion.
- If the child has only `date` (no `time`): match **any** generated occurrence
  on that calendar date, regardless of time of day. This is the canonical form
  for day-level exclusions and day-level overrides.
- A child with neither `date` nor `time` is invalid in the context of
  override matching (see V13).

A child whose `date` (and optional `time`) does not match any generated
occurrence is treated as an **explicit one-off instance** and is emitted in
addition to the generated series, unless its effective `excluded` is `true`.

### 5.2 Rescheduling an Occurrence

To reschedule a generated occurrence, use two explicit child entries: one to
exclude the original slot, one for the new time. Because `date` and `time`
are independent scalar product fields, you can reschedule to the same day at a
different time, or to a different day at the same time, without repeating
unchanged components:

**Move to a different day (same time inherited):**

```yaml
date: 2026-01-05
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-01-26
    excluded: true            # suppresses the generated Monday occurrence
  - date: 2026-01-27         # one-off on Tuesday — time "09:00" inherited
    tags: [rescheduled]
```

**Move to a different time (same day):**

```yaml
instances:
  - date: 2026-01-26
    excluded: true
  - date: 2026-01-26
    time: "10:30"             # same day, later time; explicit one-off
    tags: [rescheduled]
```

**Day-level exclusion (time irrelevant):**

```yaml
instances:
  - date: 2026-06-11
    excluded: true            # excludes all occurrences on June 11,
                              # regardless of time of day
```

This is intentionally explicit. There is no implicit "nearest occurrence"
matching.

### 5.3 Adding One-Off Occurrences

A child whose date does not match any generated occurrence is emitted as an
additional one-off alongside the series. This is the mechanism for adding
extra dates to a series — makeup sessions, exceptions that are *added* rather
than excluded:

```yaml
date: 2026-01-05
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-01-09         # Friday — not a generated Monday; emitted as one-off
    tags: [makeup]
```

For nodes without `repeat`, `instances` entries with their own `date` fields
act as additional occurrences of the same item, turning a single-date node
into a multi-date one without introducing a recurrence pattern.

---

## 6. Validation Rules

Validation is applied **after** inheritance merge, not on raw YAML input.

| Rule | Condition |
|---|---|
| **V1** | A node subject to recurrence expansion must have a resolvable `date` after merge. A node with `repeat` but no `date` reachable via the merge chain is invalid. |
| **V2** | `repeat.type` must be one of: `schedule`, `after_completion` |
| **V3** | A `repeat` with `type: schedule` must include `freq` |
| **V4** | `repeat.end.type` must be one of: `until`, `count` |
| **V5** | `date` must be a valid calendar date in `YYYY-MM-DD` format |
| **V6** | `duration` must conform to the grammar in §3.4 |
| **V7** | `repeat.interval` (for `type: after_completion`) must conform to the duration grammar in §3.4 |
| **V8** | `done` and `excluded`, if present, must be boolean |
| **V9** | `repeat.end.date` (for `type: until`) must be a valid `YYYY-MM-DD` date |
| **V10** | `repeat.end.occurrences` (for `type: count`) must be a positive integer |
| **V11** | `time` must not be present without `date` |
| **V12** | `timezone`, if present, must be a valid IANA timezone name |
| **V13** | A child node in `instances` intended as an override must have at least `date` after merge |

---

## 7. Expansion Algorithm

### 7.1 UTC Normalization

Throughout expansion, "UTC-normalized datetime" means:

```
datetime_utc = date + time (or 00:00 if absent) interpreted in timezone
               (or local time if timezone absent), converted to UTC
```

### 7.2 Single Node Expansion

Given a node `N` with effective fields (after inheritance merge per the YAML
Node Inheritance Model) and a query range `[from, to]` (UTC datetimes):

1. Compute the anchor datetime `A` = UTC-normalize(`N.date`, `N.time`,
   `N.timezone`). If `N.date` is absent, stop (unscheduled node).
2. If `A` falls within `[from, to]` and `N.excluded` is not `true`, emit
   it as the first occurrence with `N`'s effective metadata.
3. If `N.repeat` is absent, check `instances` for one-off entries (step 5)
   then stop.
4. If `N.repeat.type` is `schedule`:
   - Build an RRULE from `A` (as `DTSTART`) and the repeat fields (§7.4),
     bounded by the query range.
   - For each generated occurrence date `D` within `[from, to]`:
     - Find the matching child in `N.instances` using the rule in §5.1:
       - If a child matches and its effective `excluded` is `true`, skip
       - If a child matches and `excluded` is not `true`, emit the merged child
       - If no child matches, emit `D` with `N`'s effective `time` and metadata
5. Emit any children in `N.instances` whose `date`/`time` does not match
   any generated date — these are explicit one-off instances (§5.3). Skip
   those with effective `excluded: true`.
6. If `N.repeat.type` is `after_completion`:
   - Find the child instance `L` with the greatest effective datetime where
     `done: true`
   - If `L` exists: compute `next = L.datetime + repeat.interval`; if
     `next` falls within `[from, to]`, emit it with `N`'s effective metadata
   - If no `L` exists: `A` is the current pending occurrence (already emitted
     in step 2 if in range)

### 7.3 Tree Expansion

For each child node `C` in `N.instances` that defines its own `repeat`:

1. Compute `effective_C = merge(N, C)` per the YAML Node Inheritance Model
   (with `instances` not propagated)
2. Expand `effective_C` recursively as a root within the same query range
3. Collect all emitted occurrences across all branches

Sort all collected occurrences by UTC datetime ascending.

### 7.4 RRULE Mapping

| `repeat` field | RRULE component |
|---|---|
| `type: schedule` | — (`DTSTART` set from anchor datetime) |
| `freq` | `FREQ` |
| `byweekday` | `BYDAY` |
| `bymonthday` | `BYMONTHDAY` |
| `bysetpos` | `BYSETPOS` |
| `interval` | `INTERVAL` |
| `end.type: until` → `end.date` | `UNTIL` |
| `end.type: count` → `end.occurrences` | `COUNT` |

The anchor datetime maps to `DTSTART`. Since the anchor is emitted directly
in step 2, implementations should generate RRULE occurrences starting after
`DTSTART` (skip the first RRULE result if it equals `DTSTART`).

---

## 8. Output Schema

The expansion algorithm emits a flat, ordered list of **occurrences**.
An occurrence is a fully resolved node — all inheritance has been applied,
`repeat`, `instances`, and `excluded` are absent, and `datetime` is always
present. Occurrences with `excluded: true` are never emitted.

### 8.1 JSON Representation

Each occurrence is a JSON object:

```jsonc
{
  "datetime": "2026-01-05T09:00:00Z",  // required; ISO 8601, normalized to UTC
  "date": "2026-01-05",                // required; calendar date
  "time": "09:00",                     // optional; omitted if node has no time
  "timezone": "Europe/Vienna",         // optional; omitted if absent on node
  "duration": "PT30M",                 // optional; ISO 8601, omitted if absent
  "done": false,                       // optional; omitted if not set
  // all other metadata fields are passed through unchanged
}
```

`datetime` is the primary sort key and the canonical output field for
calendar consumers. `date`, `time`, and `timezone` are preserved in output
for consumers that want the un-normalized components.

The output schema is **open** — unknown fields from the source node are
preserved in output occurrences and never dropped.

### 8.2 Query Range

All expansion calls **must** specify a query range:

```jsonc
{
  "from": "2026-01-01T00:00:00Z",  // inclusive
  "to":   "2026-03-31T23:59:59Z"   // inclusive
}
```

Only occurrences whose `datetime` falls within `[from, to]` are emitted.
Unbounded expansion is never performed.

---

## 9. Examples

Each example shows the YAML input followed by the JSON output for a given
query range. Excluded occurrences are never present in output.

---

### 9.1 Single Occurrence

**Input:**

```yaml
date: 2026-06-15
time: "19:00"
timezone: Europe/Vienna
duration: 3h
tags: [dinner, team]
```

**Query range:** `2026-06-01` to `2026-06-30`

**Output:**

```json
[
  {
    "datetime": "2026-06-15T17:00:00Z",
    "date": "2026-06-15",
    "time": "19:00",
    "timezone": "Europe/Vienna",
    "duration": "PT3H",
    "tags": ["dinner", "team"]
  }
]
```

19:00 Vienna time in June is UTC+2, so UTC output is 17:00.

---

### 9.2 Recurring Weekly

**Input:**

```yaml
date: 2026-01-05
time: "09:00"
tags: [standup, work]
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
```

**Query range:** `2026-01-01` to `2026-01-26`

**Output:**

```json
[
  { "datetime": "2026-01-05T09:00:00Z", "date": "2026-01-05", "time": "09:00", "tags": ["standup", "work"] },
  { "datetime": "2026-01-12T09:00:00Z", "date": "2026-01-12", "time": "09:00", "tags": ["standup", "work"] },
  { "datetime": "2026-01-19T09:00:00Z", "date": "2026-01-19", "time": "09:00", "tags": ["standup", "work"] },
  { "datetime": "2026-01-26T09:00:00Z", "date": "2026-01-26", "time": "09:00", "tags": ["standup", "work"] }
]
```

---

### 9.3 Overrides, Exclusions, and Rescheduling

**Input:**

```yaml
date: 2026-01-05
time: "09:00"
tags: [standup, work]
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-01-12
    done: true
  - date: 2026-01-19
    excluded: true
  - date: 2026-01-26
    excluded: true
  - date: 2026-01-26
    time: "10:00"
    tags: [standup, work, rescheduled]
```

**Query range:** `2026-01-01` to `2026-02-02`

**Output:**

```json
[
  { "datetime": "2026-01-05T09:00:00Z", "date": "2026-01-05", "time": "09:00", "tags": ["standup", "work"] },
  { "datetime": "2026-01-12T09:00:00Z", "date": "2026-01-12", "time": "09:00", "tags": ["standup", "work"], "done": true },
  { "datetime": "2026-01-26T10:00:00Z", "date": "2026-01-26", "time": "10:00", "tags": ["standup", "work", "rescheduled"] },
  { "datetime": "2026-02-02T09:00:00Z", "date": "2026-02-02", "time": "09:00", "tags": ["standup", "work"] }
]
```

---

### 9.4 Partial Time Override

A child overrides only `time`, keeping the parent's `date` via inheritance.

**Input:**

```yaml
date: 2026-03-02
time: "18:00"
timezone: Europe/Berlin
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-03-23
    time: "20:00"
    tags: [rescheduled-time]
```

**Query range:** `2026-03-01` to `2026-03-30`

**Output:**

```json
[
  { "datetime": "2026-03-02T17:00:00Z", "date": "2026-03-02", "time": "18:00", "timezone": "Europe/Berlin" },
  { "datetime": "2026-03-09T17:00:00Z", "date": "2026-03-09", "time": "18:00", "timezone": "Europe/Berlin" },
  { "datetime": "2026-03-16T17:00:00Z", "date": "2026-03-16", "time": "18:00", "timezone": "Europe/Berlin" },
  { "datetime": "2026-03-23T19:00:00Z", "date": "2026-03-23", "time": "20:00", "timezone": "Europe/Berlin", "tags": ["rescheduled-time"] },
  { "datetime": "2026-03-30T16:00:00Z", "date": "2026-03-30", "time": "18:00", "timezone": "Europe/Berlin" }
]
```

March 29 switches to CEST (UTC+2); March 30 18:00 Berlin = 16:00 UTC.

---

### 9.5 One-Off Addition to a Series

A child whose date falls on a non-generated day is emitted as an additional
one-off occurrence alongside the series.

**Input:**

```yaml
date: 2026-01-05
time: "09:00"
tags: [standup]
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-01-09         # Friday — not a Monday; emitted as one-off
    tags: [standup, makeup]
```

**Query range:** `2026-01-01` to `2026-01-15`

**Output:**

```json
[
  { "datetime": "2026-01-05T09:00:00Z", "date": "2026-01-05", "time": "09:00", "tags": ["standup"] },
  { "datetime": "2026-01-09T09:00:00Z", "date": "2026-01-09", "time": "09:00", "tags": ["standup", "makeup"] },
  { "datetime": "2026-01-12T09:00:00Z", "date": "2026-01-12", "time": "09:00", "tags": ["standup"] }
]
```

`time: "09:00"` is inherited by the Friday one-off from the root node.

---

### 9.6 Switching Recurrence Style

A child with its own `repeat` defines an independent recurrence regime,
entirely replacing the parent's `repeat` via the sum type rule.

**Input:**

```yaml
done: false
tags: [exercise]
instances:

  - date: 2026-01-01
    time: "18:00"
    timezone: Europe/Vienna
    repeat:
      type: schedule
      freq: weekly
      byweekday: [mo, we, fr]
      end:
        type: until
        date: 2026-01-09
    instances:
      - date: 2026-01-03
        done: true
      - date: 2026-01-05
        excluded: true

  - date: 2026-01-12
    time: "07:00"
    timezone: Europe/Vienna
    repeat:
      type: after_completion
      interval: 2 days
    instances:
      - date: 2026-01-12
        done: true
```

**Query range:** `2026-01-01` to `2026-01-20`

**Output:**

```json
[
  { "datetime": "2026-01-01T17:00:00Z", "date": "2026-01-01", "time": "18:00", "timezone": "Europe/Vienna", "tags": ["exercise"], "done": false },
  { "datetime": "2026-01-03T17:00:00Z", "date": "2026-01-03", "time": "18:00", "timezone": "Europe/Vienna", "tags": ["exercise"], "done": true },
  { "datetime": "2026-01-07T17:00:00Z", "date": "2026-01-07", "time": "18:00", "timezone": "Europe/Vienna", "tags": ["exercise"], "done": false },
  { "datetime": "2026-01-09T17:00:00Z", "date": "2026-01-09", "time": "18:00", "timezone": "Europe/Vienna", "tags": ["exercise"], "done": false },
  { "datetime": "2026-01-12T06:00:00Z", "date": "2026-01-12", "time": "07:00", "timezone": "Europe/Vienna", "tags": ["exercise"], "done": true },
  { "datetime": "2026-01-14T06:00:00Z", "date": "2026-01-14", "time": "07:00", "timezone": "Europe/Vienna", "tags": ["exercise"], "done": false }
]
```

---

### 9.7 Completion-Based Habit

**Input:**

```yaml
date: 2026-05-10
time: "08:00"
done: false
tags: [health]
repeat:
  type: after_completion
  interval: 1 day
instances:
  - date: 2026-05-10
    done: true
  - date: 2026-05-11
    done: true
```

**Query range:** `2026-05-01` to `2026-05-31`

**Output:**

```json
[
  { "datetime": "2026-05-10T08:00:00Z", "date": "2026-05-10", "time": "08:00", "tags": ["health"], "done": true },
  { "datetime": "2026-05-11T08:00:00Z", "date": "2026-05-11", "time": "08:00", "tags": ["health"], "done": true },
  { "datetime": "2026-05-12T08:00:00Z", "date": "2026-05-12", "time": "08:00", "tags": ["health"], "done": false }
]
```

---

### 9.8 Monthly — First Monday

**Input:**

```yaml
date: 2026-01-05
time: "10:00"
tags: [team-meeting]
repeat:
  type: schedule
  freq: monthly
  byweekday: [mo]
  bysetpos: 1
```

**Query range:** `2026-01-01` to `2026-04-30`

**Output:**

```json
[
  { "datetime": "2026-01-05T10:00:00Z", "date": "2026-01-05", "time": "10:00", "tags": ["team-meeting"] },
  { "datetime": "2026-02-02T10:00:00Z", "date": "2026-02-02", "time": "10:00", "tags": ["team-meeting"] },
  { "datetime": "2026-03-02T10:00:00Z", "date": "2026-03-02", "time": "10:00", "tags": ["team-meeting"] },
  { "datetime": "2026-04-06T10:00:00Z", "date": "2026-04-06", "time": "10:00", "tags": ["team-meeting"] }
]
```

RRULE equivalent: `FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1`

---

## 10. Reference Implementation Notes

- Normalize all `duration` and `repeat.interval` values to ISO 8601 on
  ingest; store normalized form internally
- When parsing, split the v0.8 unified `time` field (§3.5) before any
  further processing
- Always quote `time` values in YAML output (`time: "09:00"` not
  `time: 09:00`) to prevent YAML 1.1 parsers from treating `HH:MM` as
  an integer
- Map `repeat` (when `type: schedule`) to RRULE using the table in §7.4;
  use a standard RRULE library for expansion (e.g. `rrule.js`,
  `python-dateutil`)
- Implement the merge algorithm exactly as specified in the YAML Node
  Inheritance Model; treat any dict with a `type` key as a sum type
- Always require a query range for expansion; never expand unboundedly
- For `type: after_completion`: find the child instance with the greatest
  effective datetime where `done: true`, add `repeat.interval`, emit if
  within range
- Normalize `date + time + timezone` to UTC for JSON output; preserve the
  original `date`, `time`, and `timezone` fields in output occurrences
- Override matching in `instances` uses `date` (and optionally `time`) per
  §5.1, not full datetime equality; implement the 60-second tolerance window
  for timed matches to absorb date-arithmetic floating-point drift
- Pass through all unknown metadata fields in output occurrences unchanged;
  omit `excluded`, `repeat`, and `instances` from output
- Separate the YAML parse layer, the inheritance merge layer, the recurrence
  expansion layer, and the JSON serialization layer cleanly — they have
  independent test surfaces
- Validate V1–V13 **after** merge, not on raw YAML input
- The fixture suite (companion document) is the normative source of truth
  for expansion behaviour; implementations should pass all fixtures before
  claiming compliance
