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

*Internal engine*:
- `ExpandNode<M>` — structural fields the engine actually reads: `date`, `time`,
  `repeat`, `excluded`, `done`, `instances`. `metadata: M` is unconstrained
  pass-through — the engine never reads it. `done` and `excluded` are structural
  because they affect what gets generated; everything else is metadata.
- `ExpandedOcc<M>` — output of `expandNode`: same structural fields plus `jsTime`.
  No cast hacks needed at the `expandRange` boundary.
- `mergeNode<M>(parent, child)` — merges two `ExpandNode<M>`s; structural fields
  take the child's value when present; `metadata` is shallow-merged.
- `expandNode<M>(node, from, to)` — core recurrence engine; returns `ExpandedOcc<M>[]`.

*Main-app entry point* (domain-aware):
- `expandRange(items, roots, from, to)` — takes a `StoreItem[]` and a `Roots`
  map and expands all series and standalones within the date window, returning
  `OccurrenceEntry<AppMetadata>[]` with file-level metadata joined from `roots`,
  `jsTime` and `ownerId` populated.
- `expandWithMultiday` — like `expandRange` but also generates virtual
  occurrences for days 2..N of multi-day events.
- `collectUndated` — collects store items with no date.
- `joinFileMeta`, `stableOccId` — metadata join and deterministic occurrence ID.

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

---

## Unknown-key preservation

A file is regenerated from the store on every save, so anything the model has no
name for would be deleted on the first edit. To prevent that, each node's
**remainder** — its keys outside the reserved vocabulary — is carried verbatim in
an `extra` bag on `OccurrenceMetadata` / `FileMetadata` and re-emitted on collapse.

**Reserved vocabulary** (`src/types.ts`): `STRUCTURAL_KEYS` = `date`, `time`,
`repeat`, `excluded`, `instances`, `defaults` — plus every `INLINE_FIELDS` key at
both levels. `unknownKeys(fields)` returns everything else, or `undefined` when
there is nothing to carry (never `{}`, so files without unknown keys keep
byte-identical metadata).

**Ownership rule — the root is an item, or the file owns it, never both.** The
remainder is computed **per node**, not per file; a per-file remainder spread back
over the collapse output re-emits `date`/`repeat`/`instances` twice (once fresh
from the model, once stale from the raw node) and gives the file a duplicate,
wrong schedule. The only node with two candidate homes is the file root, which
maps to `FileMetadata` *and*, in three of the four collapse shapes, to a
`StoreItem`. `nodeIsItem()` in `storeItems.ts` decides:

- **root is an item** → `FileMetadata.extra` stays empty; the root's keys (its own
  and its `defaults:` block's) ride on that item's metadata via
  `base = { ...childDefaults, ...fields }`.
- **container root** → `FileMetadata.extra` = the root's **own** keys only, read
  from `rawNode` without the legacy `defaults:` fallback that `buildRoot` uses for
  `title`/`tags`/`items`. Keys inside the root `defaults:` reach the items by
  inheritance and hoist back into `defaults:` on collapse.
- **every other node** → remainder of `{ ...childDefaults, ...fields }`.

**Exactly-once emission**, by collapse shape:

| Shape | file extra | occurrence extra |
|---|---|---|
| flat single series | ∅ | root, via `occMetaToYaml` |
| flat single standalone | ∅ | root |
| single series + `instances:` | ∅ | `defaults:`; children diffed away |
| container | root, via `fileMetaToYaml` | shared → root `defaults:`; divergent → local `defaults:` / instance |

Extras hoist and diff on the same rules as typed fields, but with `deepEqual`
(`inlineFieldEqual` is `===` for non-array kinds and cannot compare nested YAML
values). Hoisting is an optimisation — a key that fails to hoist stays on each
item and still round-trips. `emitExtra` skips `STRUCTURAL_KEYS` defensively so a
hand-built `StoreItem` can never overwrite the schedule it is emitting.

A registry key present in `extra` (a known field written in a shape the model
can't represent, e.g. `duration: [1, 2]`) **wins over the typed field** on
emission, because the typed field holds only the `''`/`[]` fallback. The edit path
must therefore strip a registry key out of `extra` whenever it writes that field —
see `storeOps.ts`. The same applies if `INLINE_FIELDS` ever grows: a new entry
must be stripped from existing `extra` bags on load, or a stale raw value shadows
the new typed field forever.

**Deliberate non-goals.** These are normalised away and are *not* bugs: comments,
key order, quoting style, multiple consecutive blank lines (collapsed to the
single one `wrapFrontmatter`'s own separator inserts); a key's position when
collapse relocates it between the root and `defaults:`. Still-open loss, out
of scope here: absent-vs-empty for required arrays.

(Three items used to be in this list and no longer are:
- **Metadata on an excluded instance** — `serializeChildren` now diffs an
  excluded child against the series metadata like any other override, so
  exclusion only suppresses the occurrence, it no longer erases what was
  written on it.
- **Fields on nested container nodes** — a container's own remainder (no
  `StoreItem` of its own to hang it on) is now carried down to its descendant
  items instead of discarded; `hoistSharedMetadata` collapses it back to a
  shared `defaults:` block when every descendant agrees. See `storeItems.ts`'s
  `containerOwnRemainder`.
- **Markdown-body leading/trailing whitespace, and the file's line-ending
  convention** — `fileIO.ts` used to `.trim()` the whole body (stripping
  meaningful indentation on its first line along with the incidental blank
  line Meridian's own separator inserts) and hardcode LF regardless of the
  source, guaranteeing mixed `\r\n`/`\n` output for any CRLF-authored file.
  `loadFile` now strips only the incidental leading blank line and the file's
  own trailing newline, tracks the source's line-ending/trailing-newline
  convention as `FileMetadata.fileConvention`, and `wrapFrontmatter` re-applies
  it to the structural glue it generates — never to the body's own bytes,
  which were never touched to begin with. `fileConvention` is carried forward
  across edits by `updateRoot` in `storeOps.ts`, the same way `extra` is;
  omitting that carry-forward is the trap that would silently revert a file to
  LF on its next edit.

See `__tests__/round-trip-totality.test.ts` and `__tests__/edits.test.ts`'s
`excludeOccurrence` cases for the first; the same file's container-remainder
and line-ending cases for the other two.)

**On the edit side, an edit never mints unknown keys** — they originate only at
parse time and flow through. Every bag reaching `storeOps.ts` is therefore
derived from some parsed base, which is what lets `mergeOccMeta` use a single
rule: typed fields take the patch (the newer, editor-supplied value), unknown
keys take the base (so a series' `owner: alice` cannot overwrite an override's
own `owner: bob` when a scope-`single` edit rebuilds that override from its
series). `storeOps.ts` keeps metadata construction to four functions for this
reason; see the "Metadata constructors" section there before adding a fifth.

The invariant is enforced by two test files:

- `__tests__/unknown-keys.test.ts` — `collectKeyValues` asserts **set
  containment** of every source key/value pair in the saved output, since
  collapse legitimately relocates keys and changes how often they appear.
- `__tests__/extras-preservation.test.ts` — asserts that any item or root
  **surviving an operation under the same id** keeps the unknown keys it had,
  across every exported `storeOps` operation, and fails when a newly exported
  one is neither exercised nor exempted. Its cases deliberately target an
  instance whose key *diverges* from its series: an operation that merges the
  two bags the wrong way round still looks correct on an instance that agrees
  with its series, so an agreeing target would let a clobbering merge pass.

Note that `yaml-roundtrip.test.ts` cannot catch a loss here: it asserts a fixed
point on Meridian's *own* output, and the loss happens on the first pass.

---

### `storeOps.ts`
**Pure edit operations on `StoreData = { items: StoreItem[], roots: Roots }`.**

No store, React, or file I/O dependencies.

- `applyEdit(data, occ, scope, fields, draftId?): StoreData` — apply an editor save
  across four scopes: `'all'`, `'single'`, `'future'` (series split), `'add'`. Updates
  both items (occurrence-level changes) and roots (file-level title/tags/items).
  With `occ == null` it creates a brand-new entry; `draftId` is the editor draft's
  identity, stamped on the created item so a repeat commit for the same draft
  upserts instead of creating a second file.
- `newEntrySlug(data, title, draftId?): string` — the slug a new entry will occupy.
  Never returns a slug another file already owns: colliding titles (`titleToSlug`
  collapses punctuation, accents, and everything past 60 chars) get a `-2`, `-3`, …
  suffix rather than overwriting the file already there. Callers persist the slug
  this returns, not `titleToSlug(title)`.
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
| Structural-field expansion (generic pass-through metadata) | `expandNode`, `mergeNode` (internal) in `expansion.ts` |
| Persistence / Dexie cache | `src/meridian.ts` |
| React state / store mutations | `src/App.tsx`, `src/store.ts` |
| UI formatting, dialogs, editor state | `src/components/`, `src/debug/` |

The `inheritance.ts` / `nodeSchema.ts` files remain fully field-agnostic.
`expansion.ts`'s internal engine (`expandNode`, `mergeNode`) knows only the
structural fields that affect scheduling (`date`, `time`, `repeat`, `excluded`,
`done`); all other domain fields flow through as opaque `M`. `expandRange` is
the domain-aware entry point that bridges `StoreItem[]` into the engine and
assembles typed `OccurrenceEntry<AppMetadata>[]` on the way out.
`collapse.ts` uses the `INLINE_FIELDS` registry rather than hard-coding field names.
