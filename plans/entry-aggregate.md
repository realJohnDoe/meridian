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

**Status: PR 3 shipped.** The cheap half of this analysis has shipped — the
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

## The work, as four PRs

Each is green and shippable on its own, and each is defensible to a reviewer
without reference to the ones after it. **They are not all independently
*valuable*, though, and it's worth being straight about which are which:**
PRs 3–5 are one migration delivered in three reviewable slices —
only the last of them pays out. PR 6 is optional cleanup.

Tiers follow [the survey conventions](./surveys/README.md#recommended-model-tiers):
the cheapest tier that can do the PR well, each with the hazard that sets it,
and a lower tier named where stating the hazard in the task is what makes it
viable. The tier rates **the change** — re-running `build`, `lint`, the suites
and the round-trip fixtures to confirm one is fully scripted and suits the
cheapest tier regardless.

| PR | Delivers | Stands alone? | Recommended model |
|---|---|---|---|
| 4 | `storeOps.ts` on `Entries` | Shippable, not yet valuable | **Opus 5** |
| 5 | Non-empty items; workarounds deleted | **This is the payoff** | **Opus 5** |
| 6 | Remaining consumers read `Entries` | Optional cleanup | **Sonnet 5** — if 3–5 landed and the eviction contract is stated; else **Opus 5** |

**Where you can stop.** After PR 5: the bug is a compile error and the plan is
done — 6 is garnish. Stopping *between* 3 and 5 is the one bad outcome: the
store is reshaped and nothing has been collected for it yet, so don't start 3
without intending to reach 5.

---

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
  weeks later.
  [`carry-forward-serialized.test.ts`](../src/model/__tests__/carry-forward-serialized.test.ts)
  covers exactly this.

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

PRs 3–5 touch `storeOps.ts` (the largest file in `model/`) and every test that
builds a `StoreData` literal — including the fixtures in `src/model/__tests__/`.
That is a large mechanical diff with a real risk of smuggling in a behaviour
change while "just" reshaping data. Run the round-trip fixtures
(`yaml-roundtrip.test.ts`, `round-trip-totality.test.ts`) before and after each,
and require byte-identical output as the gate.

Not worth doing as a background refactor. Worth doing the next time this area is
being changed for a feature reason anyway.

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
