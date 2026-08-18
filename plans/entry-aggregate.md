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

## Step 2 — `Entries` as the stored form, flat arrays as derived views

The widest blast radius is `expandRange(items, roots, from, to)`
([model/expansion.ts](../src/model/expansion.ts)) and every calendar view behind
it. Don't migrate them in the same pass:

1. Add `Entry`/`Entries` and make `store.ts` hold `Entries` as the single stored
   form.
2. Derive `items`/`roots` from it as memoized selectors, so `expandRange` and
   the calendar keep their current signatures and no view changes.
3. Migrate `storeOps.ts` to take and return `Entries`. This is where the payoff
   is — each `apply*` function then updates one object instead of two
   collections, and `updateRoot` stops being callable on its own.
4. Migrate `fileOccurrence.ts`, `storage/sync.ts`'s merge path, and
   `occurrenceActions.ts`.
5. Only then, if it still looks worthwhile, push `Entries` down into
   `expandRange`. It may not be: expansion genuinely wants a flat occurrence
   list, and a memoized selector at that boundary is a reasonable permanent
   answer.

Steps 1–3 are where the invariant is won. Steps 4–5 are cleanup and can be
dropped or deferred without losing the guarantee.

## Cost, honestly

Step 1 is contained — `store.ts` plus its two callers in
[storage/vaultRegistry.ts](../src/storage/vaultRegistry.ts) and
[storage/sync.ts](../src/storage/sync.ts).

Steps 2–3 touch `storeOps.ts` (the largest file in `model/`) and every test that
builds a `StoreData` literal — including the fixtures in
`src/model/__tests__/`. That is a large mechanical diff with a real risk of
smuggling in a behaviour change while "just" reshaping data. It wants its own
PR, its own review, and the round-trip fixtures (`yaml-roundtrip.test.ts`,
`round-trip-totality.test.ts`) run before and after with identical output as the
gate.

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
