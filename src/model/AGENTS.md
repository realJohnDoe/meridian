# src/model — Architecture boundaries

## Overview

This directory implements the data pipeline in three conceptually independent
stages:

```
YAML text
  ↓  fileIO.ts  (parse / serialise text ↔ plain objects)
  ↓  inheritance.ts  (defaults: propagation — field-agnostic)
  ↓  storeItems.ts  (EffectiveNode tree → flat StoreItem[])
  ↓  expansion.ts  (StoreItem[] → concrete Occurrence[] in a date window)
                                    ↑
                              storeOps.ts  (pure edits on StoreItem[])
                                    ↑
                              collapse.ts  (StoreItem[] → YAML object for saving)
```

---

## Files and responsibilities

### `nodeSchema.ts`
Zod schema and TypeScript type for `RawNode` — the unprocessed shape of a
parsed YAML file.  Pure data definition; no logic.

### `inheritance.ts`
**Field-agnostic inheritance engine.**

*Loading direction* (`defaults:` propagation):
- `buildEffectiveTree(node, parentDefaults?)` — walks a `RawNode` tree and
  merges every `defaults:` block into its children's `fields`, producing an
  `EffectiveNode` tree.  After this step there are no `defaults:` blocks left;
  every node carries its fully-resolved field values.  `childDefaults` on each
  node holds the accumulated context that will be passed to that node's own
  children (used by the expansion engine to seed generated occurrences).

*Saving direction* (YAML serialisation):
- `serializeRawNode(node)` — serialises a plain `RawNode` object to a YAML
  frontmatter string using the `yaml` library.  Key order: `defaults:` first
  (when present), then structural root fields, then `instances:`.

This file is **field-agnostic**: it never references domain field names.

### `storeItems.ts`
**Tree → flat store.**

Returns `ParseResult = { items: StoreItem[]; root: FileMetadata }` — items carry
only `OccurrenceMetadata` (no file-level fields); file-level identity is in `root`.

- `parseToStoreItems(path, content): ParseResult` — full parse pipeline:
  `yamlParse` → `buildEffectiveTree` → `effectiveNodeToStoreItems` + `buildRoot`.
- `parseYamlToStoreItems(yaml, fileSlug): ParseResult` — same but from a raw
  YAML string (used for seed data).
- `effectiveNodeToStoreItems(tree, fileSlug)` — walks an `EffectiveNode` tree and
  emits a flat `StoreItem[]` using `extractOccurrenceMetadata` (no file-level):
  - Series node (`repeat` present) → `RepeatPattern` + child `OccurrenceEntry`
    overrides.
  - Node with `date` but no `repeat` → standalone `OccurrenceEntry`.
  - Container node (no `date`, no `repeat`) → recurse into instances.
- `buildRoot(rawNode, body): FileMetadata` — extracts file-level metadata from
  the root node via `extractFileMetadata`.

### `dateUtils.ts`
**Date formatting and parsing helpers** — exported for UI and model use.

`fmtISO(d)`, `fmtMonth(d)`, `parseMonth(s)`, `fmtT(v)`, `parseDateString(s)`.

Internal (not exported): `toDate`, `addInterval`, `nodeDateTime`, `jsDateToSpec`
live in `expansion.ts` and are only used there.

### `duration.ts`
**Duration string parsing helpers** — exported for UI and model use.

`parseDurationDays(dur)` — whole-day count from a duration string, or null.
`parseDurationHours(dur)` — fractional-hour count from a duration string.

### `expansion.ts`
**Temporal expansion engine.**

*Model types*: `OccurrenceEntry<T>`, `RepeatPattern<T>`.

*Predicates*: `hasRepeat`, `treeHasOccurrences` (used by debug view).

*Multiday helpers*: `multidayDisplayTitle`, `multidayCoversDate`.

*Internal engine* (domain-typed):
- `ExpandNode` — typed input with concrete `date: string`, `time: string | null`,
  `repeat?`, `excluded?`, `instances?`, and `metadata: OccurrenceMetadata`. No
  index signature — structural fields are separated from domain metadata.
- `ExpandedOcc` — typed output of `expandNode`: `date`, `time`, `jsTime: Date`,
  `metadata: OccurrenceMetadata`. No cast hacks needed at the `expandRange` boundary.
- `mergeNode(parent, child)` — typed merge of two `ExpandNode`s; structural fields
  take the child's value when set; `metadata` is shallow-merged.
- `expandNode(node, from, to)` — core recurrence engine; returns `ExpandedOcc[]`.

*Main-app entry point* (domain-aware):
- `expandRange(items, roots, from, to)` — takes a `StoreItem[]` and a `Roots`
  map and expands all series and standalones within the date window, returning
  `OccurrenceEntry<AppMetadata>[]` with file-level metadata joined from `roots`,
  `jsTime` and `ownerId` populated.
- `expandWithMultiday` — like `expandRange` but also generates virtual
  occurrences for days 2..N of multi-day events.
- `collectUndated` — collects store items with no date.
- `joinFileMeta`, `stableOccId` — metadata join and stable ID memo.

### `collapse.ts`
**Reverse-inheritance: `StoreItem[]` + `FileMetadata` → YAML object for saving.**

- `collapseToYaml(items, root?: FileMetadata)` — takes all `StoreItem`s for one
  `fileSlug` plus the optional per-file root metadata and produces the most
  compact `Record<string, unknown>` that round-trips back to the same store state.
  File-level fields (title, tags, topics) are emitted at the YAML root from `root`;
  occurrence fields (done, priority, duration, …) are emitted via the hoisting
  algorithm.

  The inheritance algorithm is driven by `hoistSharedMetadata`:
  - **Simple cases** (single item, no override children): flat output — metadata
    alongside structural fields at root, no `defaults:` block.
  - **Single series with instances**: `defaults:` carries all series metadata;
    only structural fields (`date`, `time`, `repeat`) at root; each instance
    stores only its diff from the series.
  - **Multi-series / container**: `defaults:` carries metadata shared across
    *all* series and standalones; each series root holds only structural fields;
    series-specific metadata goes in the series' local `defaults:` block.

- `hoistSharedMetadata(metas)` — pure, domain-agnostic helper.  Given N
  `InlineMetadata` objects, returns `rootDefaults` (fields shared by all) and
  `localDefaults` (per-item diverging fields).  Knows nothing about YAML
  structure, dates, or series.

- `serializeChildren(children, seriesMeta)` — serialises override instances,
  diffing each against the series metadata.

### `storeOps.ts`
**Pure edit operations on `StoreData = { items: StoreItem[], roots: Roots }`.**

No store, React, or file I/O dependencies.

- `applyEdit(data, occ, scope, fields): StoreData` — apply an editor save across
  four scopes: `'all'`, `'single'`, `'future'` (series split), `'add'`. Updates
  both items (occurrence-level changes) and roots (file-level title/tags/topics).
- `updateRoot(roots, fileSlug, fields): Roots` — update file-level metadata for
  one slug and return a new roots map.
- `toggleDone`, `excludeOccurrence`, `deleteByFileSlug`, `deleteFollowing`
  — take and return `StoreItem[]` only (no roots needed).
- `upsertOverride`, `findSeries`, `fileSlugItems`

### `__tests__/`
Test suite (Vitest).  See `__tests__/fixtures/` for canonical `.md` files used
as round-trip and edit-operation golden inputs.

---

## Layering rules

| Concern | Where it lives |
|---|---|
| Domain field names used in logic | `storeOps.ts`, `storeItems.ts`, `collapse.ts` via `INLINE_FIELDS` registry |
| Field-agnostic tree / inheritance | `inheritance.ts`, `nodeSchema.ts` |
| Domain-typed low-level expansion | `expandNode`, `mergeNode` (internal) in `expansion.ts` |
| Persistence / Dexie cache | `src/meridian.ts` |
| React state / store mutations | `src/App.tsx`, `src/store.ts` |
| UI formatting, dialogs, editor state | `src/components/`, `src/debug/` |

The `inheritance.ts` / `nodeSchema.ts` files remain fully field-agnostic.
`expansion.ts` is field-agnostic at the engine level but domain-aware at the
`expandRange` entry point.  `collapse.ts` uses the `INLINE_FIELDS` registry
rather than hard-coding field names.
