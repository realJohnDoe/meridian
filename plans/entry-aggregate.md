# The entry aggregate: one object per entry, instead of two collections

The store keeps an entry's two halves in two unrelated top-level collections:

```ts
// src/model/storeOps.ts
interface StoreData {
  items: StoreItem[]                    // every occurrence, every entry, every vault
  roots: Map<EntryKey, FileMetadata>    // every entry's file-level fields
}
```

An entry *is* the pair — a root plus the items sharing its `EntryKey` — but
nothing in the type says so, so nothing stops the halves diverging. They did:
an entry created from the search overlay ended up with a root and no
occurrences, which rendered as an invisible gap in search and was never written
to disk. That instance is fixed; the shape that allowed it is not.

**Status: not started.** The cheap half of this analysis has shipped — the
persistence port now carries content rather than a key, so the store↔disk seam
can no longer disagree with itself (see [What already
shipped](#what-already-shipped)). What remains is the store's own shape.

---

## Why the split is the problem

`updateRoot(roots, key, fields)` and the items update are two separate
statements in every one of `applyAll` / `applySingle` / `applyFuture` /
`applyAdd` ([model/storeOps.ts](../src/model/storeOps.ts)). "Update the root,
then match no item" is a two-line slip, not a type error. Twenty-one sites in
`src/` construct an `{ items, roots }` pair, and each is independently
responsible for keeping them consistent.

The telling part is that **both ends of the pipeline already use the
aggregate**, and only the middle doesn't:

| Stage | Shape |
|---|---|
| `parseToStoreItems` ([model/storeItems.ts](../src/model/storeItems.ts)) | returns `{ items, root }` — one entry |
| `parseFiles` ([storage/sync.ts](../src/storage/sync.ts)) | shreds it into two flat collections |
| `store.ts` / `storeOps.ts` | two flat collections |
| `serializeEntry` ([model/collapse.ts](../src/model/collapse.ts)) | takes `(items, root)` — one entry |

So the pipeline is aggregate → shredded → aggregate, and every layer in between
re-groups by `entryKey` to undo the shredding: `entryKeyItems` in
[storeCommit.ts](../src/storeCommit.ts), [model/storeOps.ts](../src/model/storeOps.ts)
and [editor/save.ts](../src/editor/save.ts), plus `newByKey`/`prevByKey` in
[fileOccurrence.ts](../src/fileOccurrence.ts). The split buys nothing either end
wants.

## The target shape

```ts
interface Entry {
  key:   EntryKey
  root:  FileMetadata
  items: [StoreItem, ...StoreItem[]]   // non-empty by construction
}
type Entries = Map<EntryKey, Entry>
```

The non-empty tuple is the point: `{ root, items: [] }` stops compiling, so the
bug this plan exists for becomes unrepresentable rather than merely tested for.

Consequences worth having:

- `fileOccurrenceMap` becomes total by construction. Today it is total because
  of an explicit fallback loop that synthesizes a representative for roots with
  no items — a workaround for a state that would no longer exist.
- `applyEdit`'s "the entry has no items left, rebuild it" branch goes away, as
  does `entryContent`'s null case in [storeCommit.ts](../src/storeCommit.ts):
  an `Entries` map either has the key or it doesn't, and that *is* the
  write-vs-delete answer.
- `collapseToYaml`'s `items.length === 0` branch becomes dead.

## Recommended models

Tiers follow [the survey conventions](./surveys/README.md#recommended-model-tiers):
the cheapest tier that can do the step well, each with the specific hazard that
sets it. The tier rates **the fix** — re-running `build`, `lint`, the suites and
the round-trip fixtures to confirm one is fully scripted and suits the cheapest
tier regardless.

| Step | What it changes | Recommended model |
|---|---|---|
| 1 | `layers` becomes a view, not a stored copy | **Sonnet 5** — if the task states the merged-order rule; else **Opus 5** |
| 2.1–2.2 | `Entries` stored; `items`/`roots` as derived selectors | **Opus 5** |
| 2.3 | `storeOps.ts` takes and returns `Entries` | **Opus 5** |
| 2.4 | `fileOccurrence` / sync merge / `occurrenceActions` | **Sonnet 5** — if 2.1–2.3 have landed and the eviction semantics are stated; else **Opus 5** |
| 2.5 | push `Entries` into `expandRange` | **Opus 5** to decide *whether*; **Sonnet 5** for the edit once decided |
| whole plan | as one piece of work | **Opus 5 in plan mode, multi-PR** |

**Sequencing note:** 2.1–2.3 all touch `store.ts` and `storeOps.ts`; doing them
as one PR avoids rebasing both files three times. Step 1 is independent of
everything else and can land first or last — first is better, since it shrinks
what 2.1 has to reason about.

## Step 1 — collapse `layers` into the same structure

[store.ts](../src/store.ts) holds a *third* and *fourth* representation of the
same data: `layers` (per vault) alongside the merged `items`/`roots`, kept in
step by `partitionLayers` and `flattenLayers`. The derivation runs **both ways**
depending on which entry point you came through:

- `setData` treats merged `items`/`roots` as canonical and re-derives `layers`.
- `setVaultLayer` treats `layers` as canonical and re-derives merged.

Two representations, each authoritative on alternate code paths, is why
"where does this data actually live?" has no single answer — and why tracing
this bug meant ruling the sync path in and out repeatedly.

With `Entries`, a layer is a *view*, not a stored copy: every entry carries its
vault in its key, so "this vault's entries" is a filter, not a partition to
maintain. `partitionLayers`/`flattenLayers` both delete. Do this step first —
it is self-contained, it removes a whole class of "which one is stale?", and it
shrinks the surface the rest of the migration has to touch.

Cheaper than the comments in `store.ts` suggest. `partitionLayers`' `seedIds`
machinery exists so a registered-but-empty vault stays a key in `layers`, "or
`getVaultLayer` would report it as missing" — but `vaultLayer()` returns
`EMPTY_LAYER` for a missing vault anyway, and since the persistence port started
carrying content there is exactly **one** production reader left
(`mergeChangedIntoStore`, [storage/sync.ts](../src/storage/sync.ts)), which
filters the layer's items and roots and so cannot tell empty from absent. Check
that still holds, then drop the machinery rather than porting it.

- **Recommended model:** **Sonnet 5**, *if the task states the merged-order
  rule* — otherwise **Opus 5**. The hazard is not the layer map, it is the order
  of the flat `items` array that falls out of it. `hasSameStructure` and
  `computeExpansionCache` ([model/expansionCache.ts](../src/model/expansionCache.ts))
  compare `a[i]` against `prev.items[i]` **positionally**, so a rebuild that
  emits entries in a different order makes every item look changed: the
  incremental overlay silently degrades to a full re-expansion of every file.
  Nothing fails — the app is just slower, and only on vaults large enough to
  notice. `flattenLayers` documents the current guarantee ("layer insertion
  order decides the merged order, and `Map` preserves it"); any replacement has
  to preserve a stable order per entry, and say which.

## Step 2 — `Entries` as the stored form, flat arrays as derived views

The widest blast radius is `expandRange(items, roots, from, to)`
([model/expansion.ts](../src/model/expansion.ts)) and every calendar view behind
it. Don't migrate them in the same pass:

**2.1** Add `Entry`/`Entries` and make `store.ts` hold `Entries` as the single
stored form.

**2.2** Derive `items`/`roots` from it as memoized selectors, so `expandRange`
and the calendar keep their current signatures and no view changes.

- **Recommended model (2.1–2.2):** **Opus 5.** This is the highest-risk step in
  the plan and the one that fails most quietly. Reference identity is load-
  bearing in at least four independent caches, none of which have a test that
  would go red if it stopped holding:
  `setData` reuses the backlink index when `roots === prevRoots`
  ([store.ts](../src/store.ts)); `fileOccurrenceMap` memoizes on `items`/`roots`
  identity and its incremental path on `prevRoots.get(key) === roots.get(key)`
  ([fileOccurrence.ts](../src/fileOccurrence.ts)); `computeExpansionCache`
  overlays only items failing `item === prev.items[i]`; `useAgendaSections`
  caches on top of that. A selector that rebuilds a fresh array or Map per call
  satisfies every type and every assertion in the suite while turning all four
  into full rebuilds on every keystroke. Whoever does this needs to hold "which
  references must stay stable, and across which transitions" in their head the
  whole way, and to add a memo-identity test — there is none today.

**2.3** Migrate `storeOps.ts` to take and return `Entries`. This is where the
payoff is — each `apply*` function then updates one object instead of two
collections, and `updateRoot` stops being callable on its own.

- **Recommended model:** **Opus 5.** Most of a wrong edit here lands loudly on
  the round-trip fixtures, which is what makes the *quiet* part worth naming:
  `updateRoot` deliberately carries `prev?.extra` (the user's unknown
  frontmatter keys) and `prev?.fileConvention` (their line endings) forward
  across every edit. Both are optional fields, so dropping either type-checks,
  passes the scope tests, and silently deletes hand-authored YAML or rewrites
  every `\r\n` in the file — visible to the user only as a mystery git diff
  later. Four `apply*` scopes plus `applyNew` each have to keep that
  carry-forward through the reshape.

**2.4** Migrate `fileOccurrence.ts`, `storage/sync.ts`'s merge path, and
`occurrenceActions.ts`.

- **Recommended model:** **Sonnet 5**, *if 2.1–2.3 have landed and the task
  states `mergeChangedIntoStore`'s evict-then-reparse contract* — otherwise
  **Opus 5.** The trap is that the merge path evicts an affected key's items and
  roots together and re-adds whatever parses, so a port that evicts by one shape
  and re-adds by another drops entries on a sync rather than at edit time —
  a delayed, hard-to-attribute failure. `restoreEntries`' undo semantics
  (absent entry ⇒ delete) have to survive the reshape too; that one at least is
  covered by `storeCommit.test.ts`.

**2.5** Only then, if it still looks worthwhile, push `Entries` down into
`expandRange`. It may not be: expansion genuinely wants a flat occurrence list,
and a memoized selector at that boundary is a reasonable permanent answer.

- **Recommended model:** **Opus 5** to decide *whether* — it is a judgment call
  about where the aggregate should stop, and the honest answer may be "don't" —
  then **Sonnet 5** for the edit once the boundary is settled and written down.

Steps 1, 2.1–2.3 are where the invariant is won. 2.4–2.5 are cleanup and can be
dropped or deferred without losing the guarantee.

## Cost, honestly

Step 1 is contained — `store.ts` plus its two callers in
[storage/vaultRegistry.ts](../src/storage/vaultRegistry.ts) and
[storage/sync.ts](../src/storage/sync.ts).

Steps 2.1–2.3 touch `storeOps.ts` (the largest file in `model/`) and every test
that builds a `StoreData` literal — including the fixtures in
`src/model/__tests__/`. That is a large mechanical diff with a real risk of
smuggling in a behaviour change while "just" reshaping data. It wants its own
PR, its own review, and the round-trip fixtures (`yaml-roundtrip.test.ts`,
`round-trip-totality.test.ts`) run before and after with identical output as the
gate.

Two of the hazards above have no test that would catch them today. Adding those
first makes the whole plan cheaper, and both are worth having regardless of
whether it ever runs:

- a **memo-identity test** — that an edit to one entry leaves the other entries'
  root and item references untouched, and leaves `roots` itself untouched when
  only an occurrence changed;
- an **`extra`/`fileConvention` carry-forward test** across all four edit
  scopes, asserting on serialized output rather than on the store.

With those in place, 2.1–2.3 drop from "Opus 5 with a named silent-failure
hazard" to "Opus 5 with a red test if it goes wrong" — the difference between
reviewing a large diff by reading and reviewing it by running.

Not worth doing as a background refactor. Worth doing the next time this area
is being changed for a feature reason anyway.

## What already shipped

Not part of the remaining work — recorded so the plan is read against the
current code:

- **The port carries content, not a key.**
  `EntityPersistence.writeEntity(key, content)`
  ([persistencePort.ts](../src/persistencePort.ts)). The storage adapter used to
  be handed a key and resolve the entry from the live store itself, which is
  what let it disagree with the caller and skip a write no one ever came back
  to make. `writeEntityToCache` and `moveEntityInCache` lost their store reads,
  their serialization, and their guess-branches.
- **The write-vs-delete decision moved to `storeCommit.ts`**, where the data
  that answers it is already in hand.
- **`serializeEntry`** ([model/collapse.ts](../src/model/collapse.ts)) replaced
  three hand-written copies of collapse-plus-body, one of which was in the model
  suite's own helpers with a comment promising it "mirrors writeEntityToCache".
- **The test fake records content** (`FakePersistence.contentByKey`). It
  recorded only keys, so every editor test asserted that a save was *requested*
  and nothing anywhere asserted that anything was *written* — which is why a
  write path that silently did nothing passed the whole suite.
