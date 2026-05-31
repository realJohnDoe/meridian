# src/model — Architecture boundaries

## Guiding principle

Every file in this directory is **field-agnostic**: none of them may reference
domain field names such as `title`, `done`, `priority`, `tags`, `body`, or
`duration`.  Field-specific knowledge lives in the application layer
(`src/meridian.ts`, `src/debug/NodeInheritanceDebugger.tsx`, etc.).

---

## Files and responsibilities

### `nodeSchema.ts`
Zod schema and TypeScript type for `RawNode` — the unprocessed shape of a YAML
file.  Pure data definition; no logic.

### `nodeOps.ts`
**Immutable tree operations** on `RawNode` trees.

- `getSubNode` / `setSubNode` — navigate and replace a node at an index path.
- `splitNode(node, occDate)` — split a repeat series at a date; returns
  `[series1, series2]` with series1 capped before `occDate`.
- `doEditFollowing(node, ownerPath, occDate)` — split the series that owns the
  repeat at a given path; handles both root-repeat and child-repeat containers.

No knowledge of field semantics.  No dates beyond structural splitting.

### `inheritance.ts`
**Inheritance model** — the loading ↔ saving round-trip.

*Loading direction* (YAML → effective values):
- `buildEffectiveTree(node, parentDefaults?)` — recursively merges `defaults:`
  blocks into child fields, producing an `EffectiveNode` tree where every node
  carries its fully-resolved field values.

*Saving direction* (effective values → canonical YAML):
- `collapseToYaml(root, body?)` — collapses an `EffectiveNode` tree back to
  the most compact YAML by hoisting fields shared across all direct instances
  into a root `defaults:` block.
- `canonicaliseInstance(raw, parentDefaults, structuralKeys, directKeys?)` —
  restructures a **flat** raw node (all fields explicit) into two-level form:
  - `structuralKeys` stay as direct fields unconditionally.
  - `directKeys` stay direct only when they differ from `parentDefaults`.
  - Everything else that differs from `parentDefaults` goes in a nested
    `defaults:` block (for generated occurrences to inherit).
  - Fields matching `parentDefaults` are dropped entirely.
  The caller supplies both key sets — this function never inspects field names.

### `repeatExpander.ts`
**Temporal expansion** — maps a repeat pattern + override instances onto a
flat list of `OccurrenceEntry` values.

- `expandRepeat(node, endDateStr, ownerPath)` — expands a single
  `EffectiveNode` that has a `repeat` field.
- `collectAllOccurrences(root, endDateStr)` — walks the entire effective tree
  and collects occurrences from every node that has a `repeat`; assigns each
  occurrence an `ownerPath` so callers know which sub-node owns the series.
- `toExpandable(node)` — internal helper that converts an `EffectiveNode` into
  the duck-typed shape consumed by `expandNode` (from `recurrence.ts`).  Lifts
  fields shared by **all** child instances onto the parent when the parent
  lacks them (covers the case where a series stores shared properties in a
  nested `defaults:` block rather than as direct fields).

This file knows about dates and repeat schedules.  It must not contain
special-case logic for any specific field name.

### `expand.ts`
**Inheritance-aware `expandRange` entry point** for the main application.

Wraps `buildEffectiveTree` + `expandNode` so that a `defaults:`-driven
container node is fully resolved before being handed to the recurrence engine.
Also handles multi-day events and container nodes whose repeat lives on a
child instance.

---

## What does NOT belong here

| Concern | Where it lives |
|---|---|
| Domain field names (title, done, priority, …) | `src/meridian.ts`, UI components |
| Persistence / Dexie cache | `src/meridian.ts` |
| React state / store mutations | `src/App.tsx`, `src/store.ts` |
| Which keys are "structural" for a series | Call sites of `canonicaliseInstance` |
| UI formatting, dialogs, editor state | `src/components/`, `src/debug/` |
