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

## The work, as six PRs

Each is green and shippable on its own, and each is defensible to a reviewer
without reference to the ones after it. **They are not all independently
*valuable*, though, and it's worth being straight about which are which:** PRs 1
and 2 stand on their own merits and can be done at any time, even if the rest
never happens. PRs 3–5 are one migration delivered in three reviewable slices —
only the last of them pays out. PR 6 is optional cleanup.

Tiers follow [the survey conventions](./surveys/README.md#recommended-model-tiers):
the cheapest tier that can do the PR well, each with the hazard that sets it,
and a lower tier named where stating the hazard in the task is what makes it
viable. The tier rates **the change** — re-running `build`, `lint`, the suites
and the round-trip fixtures to confirm one is fully scripted and suits the
cheapest tier regardless.

| PR | Delivers | Stands alone? | Recommended model |
|---|---|---|---|
| 1 | Two missing invariant tests | Yes — real coverage gaps today | **Sonnet 5** — if the task says to assert reference identity |
| 2 | `layers` stops being a stored copy | Yes — removes a representation | **Sonnet 5** — if the task states the merged-order rule; else **Opus 5** |
| 3 | Store holds `Entries`; flat arrays derived | Shippable, not yet valuable | **Opus 5** |
| 4 | `storeOps.ts` on `Entries` | Shippable, not yet valuable | **Opus 5** |
| 5 | Non-empty items; workarounds deleted | **This is the payoff** | **Opus 5** |
| 6 | Remaining consumers read `Entries` | Optional cleanup | **Sonnet 5** — if 3–5 landed and the eviction contract is stated; else **Opus 5** |

**Where you can stop.** After PR 2: one less representation, no migration debt.
After PR 5: the bug is a compile error and the plan is done — 6 is garnish.
Stopping *between* 3 and 5 is the one bad outcome: the store is reshaped and
nothing has been collected for it yet, so don't start 3 without intending to
reach 5.

---

### PR 1 — Pin the two invariants this migration can break quietly

Tests only, no production change.

- A **memo-identity test**: an edit to one entry leaves every other entry's root
  and item references untouched, and leaves `roots` itself reference-identical
  when only an occurrence changed.
- An **`extra`/`fileConvention` carry-forward test** across all four edit
  scopes, asserting on serialized output rather than on the store.

Worth having whether or not the rest of this plan ever runs: both properties are
load-bearing today and neither is covered.

- **Recommended model:** **Sonnet 5**, *if the task says the memo test must
  assert reference identity* (`toBe`, and `expect(next.roots).toBe(prev.roots)`)
  — otherwise **Opus 5**. The hazard is that the obvious way to write it,
  `toEqual`, passes against a full rebuild and so passes forever, leaving a test
  that looks like a guard and guards nothing. That is the same failure the whole
  plan exists to prevent, reproduced in the test suite.

### PR 2 — `layers` becomes a derived view

[store.ts](../src/store.ts) holds a *third* and *fourth* representation of the
same data: `layers` (per vault) alongside the merged `items`/`roots`, kept in
step by `partitionLayers` and `flattenLayers`. The derivation runs **both ways**
depending on which entry point you came through:

- `setData` treats merged `items`/`roots` as canonical and re-derives `layers`.
- `setVaultLayer` treats `layers` as canonical and re-derives merged.

Two representations, each authoritative on alternate code paths, is why "where
does this data actually live?" has no single answer — and why tracing the
original bug meant ruling the sync path in and out repeatedly.

**This does not need `Entries`.** Every entry already carries its vault in its
key, so `getVaultLayer(vaultId)` is a memoized filter over the merged store, and
`setVaultLayer(vaultId, data)` is "replace this vault's slice". That is why it
sits before the migration rather than inside it.

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

### PR 3 — The store holds `Entries`; `items`/`roots` become derived

`Entry` is born at the parse boundary, where it has real consumers on day one:
`parseToStoreItems` already returns `{ items, root }` and only needs its key, so
`parseFiles` hands `Entry[]` to the store instead of two shredded collections.
`store.ts` then holds `Entries` as its single stored form, and exposes
`items`/`roots` as memoized selectors so `expandRange`, the calendar,
`storeOps.ts` and every view keep their current signatures and change nothing.

**The non-empty tuple can be enforced from birth, here.** Verified against the
current parser: across empty files, bare `title:`, `instances: []`,
`instances:` null, all-excluded children, nested empty containers and
body-only files, `parseToStoreItems` always returns at least one item. The one
probed input that yields nothing does so by *throwing* — `---\n---\n`, an empty
frontmatter block, which YAML reads as two documents — and that already routes
to `unreadableFiles`, which holds neither a root nor items and so is consistent
with the invariant rather than a hole in it. The boundary therefore needs a
**narrowing that is provably total**, not a fallback branch. Keep the throw path
exactly as it is; re-run the probe before relying on this.

- **Recommended model:** **Opus 5.** The highest-risk PR in the plan and the one
  that fails most quietly. Reference identity is load-bearing in four
  independent caches: `setData` reuses the backlink index when
  `roots === prevRoots` ([store.ts](../src/store.ts)); `fileOccurrenceMap`
  memoizes on `items`/`roots` identity and its incremental path on
  `prevRoots.get(key) === roots.get(key)`
  ([fileOccurrence.ts](../src/fileOccurrence.ts)); `computeExpansionCache`
  overlays only items failing `item === prev.items[i]`; `useAgendaSections`
  caches on top of that. A selector that rebuilds a fresh array or Map per call
  satisfies every type and every assertion in the suite while turning all four
  into full rebuilds on every keystroke. PR 1's memo-identity test is what turns
  that from a reading exercise into a red test — which is the entire reason it
  goes first.

### PR 4 — `storeOps.ts` takes and returns `Entries`

Each `apply*` function updates one object instead of two collections, and
`updateRoot` stops being callable on its own — which is the specific two-line
slip that produced the original bug.

- **Recommended model:** **Opus 5.** Most of a wrong edit here lands loudly on
  the round-trip fixtures, which is what makes the *quiet* part worth naming:
  `updateRoot` deliberately carries `prev?.extra` (the user's unknown
  frontmatter keys) and `prev?.fileConvention` (their line endings) forward
  across every edit. Both are optional fields, so dropping either type-checks,
  passes the scope tests, and silently deletes hand-authored YAML or rewrites
  every `\r\n` in the file — visible to the user only as a mystery git diff
  weeks later. PR 1's second test covers exactly this.

### PR 5 — Non-empty items, and delete what worked around their absence

The payoff, and a mostly-deletion diff. `items: [StoreItem, ...StoreItem[]]`
makes `{ root, items: [] }` a compile error, and these all become dead:

- `applyEdit`'s "the entry has no items left, rebuild it" branch
  ([model/storeOps.ts](../src/model/storeOps.ts));
- `entryContent`'s null case in [storeCommit.ts](../src/storeCommit.ts) — key
  presence in `Entries` *is* the write-vs-delete answer;
- `collapseToYaml`'s `items.length === 0` branch
  ([model/collapse.ts](../src/model/collapse.ts));
- `fileOccurrence.ts`'s root-only fallback loop, after which the occurrence map
  is total by construction rather than by an explicit sweep.

- **Recommended model:** **Opus 5.** The hazard is the regression tests, not the
  code. Each of those four workarounds has tests asserting the behaviour that is
  about to become impossible — `entry-without-occurrences.test.ts`,
  the root-only cases in `linking.test.ts` and `FileResultsList.test.tsx`, and
  `storeCommit.test.ts`'s delete case. Deleting them along with the code loses
  the regression; each needs re-pointing at whatever still enforces the property
  (a compile-time check, or the parse boundary's narrowing) rather than removing.
  A PR that just makes the suite green by deletion is the failure mode here.

### PR 6 — Remaining consumers read `Entries` directly (optional)

`fileOccurrence.ts`, `storage/sync.ts`'s merge path, and `occurrenceActions.ts`
stop going through the derived flat views. Cleanup only — the invariant is
already won by PR 5.

- **Recommended model:** **Sonnet 5**, *if 3–5 have landed and the task states
  `mergeChangedIntoStore`'s evict-then-reparse contract* — otherwise **Opus 5.**
  The trap is that the merge path evicts an affected key's items and roots
  together and re-adds whatever parses, so a port that evicts by one shape and
  re-adds by another drops entries on a sync rather than at edit time: a
  delayed, hard-to-attribute failure. `restoreEntries`' undo semantics (absent
  entry ⇒ delete) have to survive too; that one is covered by
  `storeCommit.test.ts`.

### Deliberately not planned — pushing `Entries` into `expandRange`

`expandRange(items, roots, from, to)`
([model/expansion.ts](../src/model/expansion.ts)) and the calendar behind it
keep taking flat arrays. Expansion genuinely wants a flat occurrence list, the
memoized selector at that boundary is a reasonable permanent answer, and the
invariant is already won without it. Revisit only if a feature makes it
necessary — the honest default is "don't".

## Cost, honestly

PRs 1 and 2 are contained: tests, plus `store.ts` and its two callers in
[storage/vaultRegistry.ts](../src/storage/vaultRegistry.ts) and
[storage/sync.ts](../src/storage/sync.ts).

PRs 3–5 touch `storeOps.ts` (the largest file in `model/`) and every test that
builds a `StoreData` literal — including the fixtures in `src/model/__tests__/`.
That is a large mechanical diff with a real risk of smuggling in a behaviour
change while "just" reshaping data. Run the round-trip fixtures
(`yaml-roundtrip.test.ts`, `round-trip-totality.test.ts`) before and after each,
and require byte-identical output as the gate.

Not worth doing as a background refactor. Worth doing the next time this area is
being changed for a feature reason anyway — and PRs 1 and 2 are worth doing
before then, on their own account.

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
