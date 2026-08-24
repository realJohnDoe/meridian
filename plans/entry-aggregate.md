# The entry aggregate: one object per entry, instead of two collections

The store held an entry's two halves in two unrelated top-level collections, so
"update the root, then match no item" was a two-line slip rather than a type
error. It happened: an entry created from the search overlay ended up with a
root and no occurrences, which rendered as an invisible gap in search and was
never written to disk.

**Status: done.** The store holds `Entries` (`types.ts`), `storeOps.ts` edits one
`Entry` at a time, and `Entry['items']` is a non-empty tuple — so
`{ root, items: [] }` no longer compiles and the bug is a compile error rather
than something tested for. The four workarounds that existed for that state are
gone: `applyEdit`'s rebuild branch, `entryContent`'s half-present-entry case,
`collapseToYaml`'s `items.length === 0` branch, and `fileOccurrence.ts`'s
root-only sweep.

What remains is optional cleanup.

---

## PR 6 — `fileOccurrence.ts` reads `Entries` directly (optional)

`fileOccurrenceMap(items, roots)` and `updateFileOccurrenceMap(prevFom, prevItems,
prevRoots, items, roots)` ([fileOccurrence.ts](../src/fileOccurrence.ts)) still
take the derived flat views and re-group by `entryKey` internally (`prevByKey`,
`newByKey`) to recover the entries they were built from. Handing them `Entries`
deletes that regrouping.

Cleanup only — the invariant is already won, and the map is already total by
construction. This is the last consumer that still undoes the grouping; the two
others this section used to name have since been converted:
`mergeChangedIntoStore` ([storage/sync.ts](../src/storage/sync.ts)) evicts and
re-adds in one shape, and `occurrenceActions.ts` reads `getEntries()` and
restores whole entries.

- **Recommended model:** **Sonnet 5**, *if the task states the incremental
  path's reuse contract* — otherwise **Opus 5.** The trap is that the
  incremental path reuses a cached representative only when the entry's items
  group AND its root are both reference-identical
  ([`linking.test.ts`](../src/model/__tests__/linking.test.ts)'s "drops a key
  whose items are gone" and "root-only change (title rename) re-resolves
  affected slug" pin the two halves). With `Entries` that collapses to one
  check — the `Entry` object itself — which is simpler and easy to get subtly
  wrong: comparing the entry by reference is correct, comparing only its
  `items` array silently stops noticing a rename.

## Deliberately not planned — pushing `Entries` into `expandRange`

`expandRange(items, roots, from, to)`
([model/expansion.ts](../src/model/expansion.ts)) and the calendar behind it
keep taking flat arrays. Expansion genuinely wants a flat occurrence list, the
memoized derivation at that boundary (`deriveViews` in
[store.ts](../src/store.ts)) is a reasonable permanent answer, and the invariant
is already won without it. Revisit only if a feature makes it necessary — the
honest default is "don't".

## If you touch this area

The gate that matters is byte-identical serialized output: run
`yaml-roundtrip.test.ts` and `round-trip-totality.test.ts`, and check
`src/model/__tests__/__snapshots__` is unchanged. The two quiet failure modes
have dedicated tests — [`memo-identity.test.ts`](../src/model/__tests__/memo-identity.test.ts)
plus [`store.test.ts`](../src/store.test.ts) for the reference identity four
caches depend on, and
[`carry-forward-serialized.test.ts`](../src/model/__tests__/carry-forward-serialized.test.ts)
for `editedEntry` carrying the user's unknown frontmatter keys and line endings
forward.
