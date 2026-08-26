# Glossary

Meridian's ubiquitous language: the ~35 terms that carry domain meaning, and
which word to reach for when two are close enough to confuse.

## How to use (and extend) this file

**This is an index, not an encyclopedia.** Each entry is one sentence of
orientation plus a pointer to the authoritative definition in code. The
definition itself lives at the symbol — usually as a doc comment in
`src/types.ts` or `src/model/AGENTS.md` — and is *not* restated here.

That constraint is load-bearing. `src/glossary.test.ts` asserts every symbol
named below still resolves, which is only checkable because entries name
symbols rather than describe behaviour. A rename that misses this file fails
the test suite. Two rules follow:

- **Never restate behaviour here.** If you want to explain *how* something
  works, put it beside the code. This file says which term to use and where to
  look, nothing more.
- **Pointers name a file and symbols, never line numbers.** Line numbers drift
  on every edit above them; a symbol name drifts only on rename, which is
  exactly the event worth catching.

Entry format — pointers come last, one line per file:

```
### term
One sentence of orientation.
→ `relative/path.ts` · `symbolA`, `symbolB`
```

An entry that contrasts things living in different files carries one pointer
line each (see *occurrence renderers*), which is how a disambiguation entry
gets every side of the contrast checked rather than just the first.

---

## Identity

### EntryKey
An entry's vault-qualified identity, `vaultId::fileSlug`. Branded, so the
compiler rejects a bare slug passed where one of these belongs.
→ `fileIO.ts` · `EntryKey`, `entryKey`, `parseEntryKey`

### fileSlug
The bare, file-level slug — what `[[wikilinks]]` and the URL carry, and the
second half of an `EntryKey`. Not unique on its own: the same slug in two
vaults is two distinct entries.
→ `fileIO.ts` · `keySlug`, `titleToSlug`

### slug (avoid)
Ambiguous — it has meant both `fileSlug` and `EntryKey` since the EntryKey
migration. Always write `fileSlug` or `entryKey`; never bare `slug`.
→ `types.ts` · `FileMetadata`

### path
A backend-relative file path (`notes/foo.md`). Storage-layer vocabulary only —
above `storage/` an entry is identified by its `EntryKey`.
→ `fileIO.ts` · `pathToKey`, `keyToPath`

---

## Vaults and backends

### Vault
One registered source of entries. Registered *is* mounted: every vault syncs
and contributes a layer. There is deliberately no "active vault".
→ `vaultRef.ts` · `VaultRef`, `VaultKind`

### VaultLayer
One vault's slice of the store's `Entries`, derived on demand rather than stored.
→ `store.ts` · `VaultLayer`, `vaultLayer`

### Entry / Entries
One entry as a single object — its `key`, its `root`, and the non-empty `items`
sharing that key. `Entries` is the whole store, keyed by `EntryKey`; it is the
store's single stored form, and `items`/`roots` are derived from it.
→ `types.ts` · `Entry`, `Entries`

### Roots
`Map<EntryKey, FileMetadata>` — file-level metadata for every entry. A view
derived from `Entries`, not a stored collection of its own.
→ `types.ts` · `Roots`, `FileMetadata`

### StorageBackend
The per-vault I/O interface (local FS, GitHub, iCal, example). Four real
implementations.
→ `storage/backend.ts` · `StorageBackend`, `RawFile`

### mounted
A backend present in the registry and syncing. Synonymous with "registered" —
they are the same state, not two.
→ `storage/backends.ts` · `mountBackend`, `getBackend`

### hasRemote vs readOnly
Two different questions. `readOnly` gates whether writes are pushed;
`hasRemote` gates whether there is anything to poll. The Tutorial vault is
read-only with no remote; an iCal feed is read-only *with* one.
→ `storage/backend.ts` · `StorageBackend`

### needsAttention
Replaces the boolean `needsReconnect`: null, or which of four actionable
states a vault is in (`fs-permission`, `reauth`, `access`, `config`) plus a
message, so the UI can render more than one row shape instead of a flag.
→ `store.ts` · `VaultAttention`, `AttentionKind`

### view-only vs sandbox
UI access modes, deliberately not called "read-only" so they can never be
confused with the backend flag above. `sandbox` is the Tutorial vault (full
edit UI, writes discarded); `view-only` is a subscription (no edit
affordances).
→ `hooks/useEntryAccess.ts` · `EntryAccess`, `useEntryAccess`

---

## An entry and its parts

### Entry
One Markdown file in a vault — the aggregate. Its file-level fields live in
`FileMetadata`, its schedule in one or more `StoreItem`s.
→ `types.ts` · `FileMetadata`

### items (disambiguation)
Two unrelated meanings. `FileMetadata.items` is a **frontmatter checklist**
(`string[]`). `StoreItem[]` / `store.items` is the **parsed store records**.
→ `types.ts` · `FileMetadata`, `StoreItem`

### extra
Frontmatter keys the model has no name for, carried verbatim so a save never
deletes hand-authored data. Owned per node — by the file root *or* by an item,
never both.
→ `types.ts` · `FileMetadata`, `OccurrenceMetadata`

### fileConvention
The source file's line-ending / trailing-newline convention, captured at parse
time so a save doesn't rewrite every `\r` because one field changed.
→ `fileIO.ts` · `FileConvention`

---

## Store records

### StoreItem
A parsed, unexpanded record: either a `StoreSeries` (recurring) or a
`StoreOcc` (single). Carries occurrence-level metadata only — no file-level
fields.
→ `types.ts` · `StoreItem`, `StoreSeries`, `StoreOcc`

### series
A recurring rule that generates occurrences. Stored flat, never nested.
→ `types.ts` · `RepeatPattern`, `isSeries`

### standalone
A single dated occurrence that is neither a series nor an override child of
one.
→ `types.ts` · `isStandaloneOcc`

### override
A stored child of a series that replaces the generated occurrence on one date.
Also called an *instance* in YAML (`instances:`) and in `model/AGENTS.md`.
→ `model/storeOps.ts` · `upsertOverride`, `findSeries`

### exclusion
An override that suppresses a generated occurrence rather than replacing it.
Metadata written on it survives.
→ `model/storeOps.ts` · `excludeOccurrence`

### tracked
An item whose `done` field is *present* — i.e. a task. A presence check, not
truthiness: `done: false` is still tracked.
→ `types.ts` · `isTracked`

---

## Generated values

### Occurrence
A concrete, dated occurrence produced by expansion, with file-level metadata
joined in. This is what every view renders.
→ `types.ts` · `Occurrence`, `OccurrenceEntry`

### AppMetadata
An expanded occurrence's metadata: occurrence-level fields plus the file-level
ones joined from `roots`. Raw store items never carry this.
→ `types.ts` · `AppMetadata`, `OccurrenceMetadata`

### OccState
The display-styling vocabulary (`task-p1`, `event-past`, `done`, …) — one
domain word per visual variant, derived from occurrence data.
→ `occView.ts` · `OccState`, `occState`, `occKind`

---

## Domain operations

### expansion
Turning stored series and standalones into concrete dated `Occurrence`s within
a window. Inverse of collapse.
→ `model/expansion.ts` · `expandRange`, `expandWithMultiday`

### collapse
Turning store records back into the most compact YAML that round-trips to the
same state. Inverse of expansion.
→ `model/collapse.ts` · `collapseToYaml`

### inheritance
Loading-direction propagation of a `defaults:` block down into children,
producing a tree where every node carries resolved values. Field-agnostic.
→ `model/inheritance.ts` · `buildEffectiveTree`, `EffectiveNode`

### hoisting
The saving-direction inverse of inheritance: lifting fields shared by all items
back into a `defaults:` block.
→ `model/collapse.ts` · `computeSharedFields`, `serializeChildren`

### EditScope
Which occurrences an editor save applies to: `single`, `future`, `all`, or
`add`.
→ `types.ts` · `EditScope`, `isEditScope`

### wikilink
A `[[slug]]` reference. Resolution is **per vault** — files store a bare slug,
so resolving one needs the linking file's `vaultId`.
→ `wikilinks.ts` · `resolveWikilink`, `buildResolveIndex`

### backlink
The reverse index of wikilinks: target `EntryKey` → the keys that link to it.
Surfaced in the UI as "listed on".
→ `fileOccurrence.ts` · `buildBacklinkIndex`

---

## Sync and durability

### reconcile
Comparing a backend's current state against the cache and folding the
differences into the store.
→ `storage/sync.ts` · `syncToBackend`, `autoSyncTick`

### dirty
A cached entry with local edits not yet pushed. Counted per vault for the sync
indicator.
→ `storage/cache/files.ts` · `cacheDirtyCount`

### ConflictError
Raised when a compare-and-swap write loses — the backend's version token no
longer matches what the writer saw.
→ `storage/conflictError.ts` · `ConflictError`

### base version / base content
Two halves of the same ancestor, on one dirty cache record. The **base
version** is the backend's opaque token (GitHub blob SHA, FS content hash) —
enough to detect that the remote drifted. The **base content** is the file at
that token — enough to work out *what* each side changed, which is what a
three-way merge needs and a version token alone can never supply. Kept on
dirty records only; a clean record's content is its own ancestor.
→ `storage/cache/db.ts` · `DexieFileRow`

### merge / conflict copy
The two outcomes of a genuine divergence, in that order. A **merge** combines
both sides when they touched different things (one reschedules, the other
writes the description) and is silent — nothing was lost. A **conflict copy**
is the fallback when they touched the same thing: the remote keeps the path,
the local content lands beside it under a timestamped name, and the user is
told. A merge needs a base content to work from; without one, every divergence
is a conflict copy.
→ `model/merge.ts` · `mergeFileContent`
→ `storage/conflictName.ts` · `conflictPath`

### touched fields
The fields an editor actually changed, as opposed to the eleven it is holding.
A save writes only these, leaving the rest at whatever the store holds by then
— an editor never re-reads its fields, so writing them all reverts anything
that moved underneath it. Same three-way rule as `merge`, one layer up.
→ `model/merge.ts` · `mergeEditFields`

### staged move / held delete
A cross-vault move, which cannot be one transaction across two vault layers and
two remotes, so it is ordered instead. The target's copy is made durable first;
the source's tombstone is staged — hiding the entry there immediately — but its
**held delete** is kept out of `pushDirty`'s outgoing set until the target's own
remote confirms the copy. The entry is therefore in exactly one remote
throughout, never both and never neither. If the target's copy turns out never
to have become durable, the move is abandoned and the held delete dropped.
→ `storage/cache/pendingMoves.ts` · `PendingMove`, `heldDeletePaths`
→ `storage/moveEntry.ts` · `moveEntityInCache`

### persistence port
The indirection core edit code calls instead of `@/storage`, so `storeCommit`
and `occurrenceActions` don't depend on the storage layer. The adapter
registers the implementation at startup.
→ `persistencePort.ts` · `EntityPersistence`, `setEntityPersistence`

---

## View layer

Only the view names that are *not* self-explanatory: where two components look
like alternatives but aren't, or where the relationship between them is
invisible from the names. A component whose name already answers the question
(`SearchBar`, `VaultList`) is deliberately absent, and one whose subtlety
is already explained in its own header comment (`DayView`'s carousel seam,
`TimedBlock`'s badge gating) stays explained there.

### occurrence renderers
Three, chosen by context, all rendering the same `Occurrence`.
`OccurrenceCard` is the **list** renderer (agenda, search, backlog, wikilink
popup); `OccurrencePill` is the **compact grid** renderer (month cells, all-day
strips); `TimedBlock` is the **timeline** renderer, placed by time geometry —
and it wraps `OccurrenceCard` rather than replacing it. Named for the one
thing it actually keys off (`!!o.time`), not for occurrence kind: a timed task
renders here too, not just events.
→ `components/OccurrenceCard.tsx` · `OccurrenceCard`
→ `calendar/OccurrencePill.tsx` · `OccurrencePill`
→ `calendar/TimedBlock.tsx` · `TimedBlock`

### MarkdownTaskCard
Despite the shape of the name, **not** a fourth occurrence renderer: it draws
one `FileMetadata.items` checklist line (`text` + `done`), which is the other
meaning of *items*. Its `onPromote` is what turns such a line into a real
entry.
→ `components/MarkdownTaskCard.tsx` · `MarkdownTaskCard`

### View vs Pane / Grid
A `*View` is the swipeable carousel container; the `*Pane` or `*Grid` inside it
is one page's content. Holds uniformly — `DayView`→`DayPane`,
`WeekView`→`WeekPane`, `MonthView`→`MonthGrid`. Reach for the Pane/Grid when
changing what a day or month *shows*, the View when changing navigation
between them.
→ `calendar/DayView.tsx` · `DayView`
→ `calendar/DayPane.tsx` · `DayPane`
→ `calendar/MonthGrid.tsx` · `MonthGrid`

### AgendaRow (disambiguation)
Two things in one directory, kept apart only by TypeScript's separate type and
value namespaces. The **type** is a row descriptor in the agenda's flat
virtualized list (`header` / `month` / `week` / `occ` / `day-empty`); the
**component** renders just the `occ` case.
→ `calendar/agendaSections.ts` · `AgendaRow`
→ `calendar/AgendaRow.tsx` · `AgendaRow`

### ui/ vs primitives/
`components/ui/` mirrors the **shadcn registry** — only CLI-written files;
`components/primitives/` holds **our own** shared primitives. The split is
load-bearing for coverage, knip, and `shadcn diff`; see CLAUDE.md's *Directory
structure* for what each exemption keys off.
→ `components/primitives/responsive-modal.tsx` · `ResponsiveModal`

### visible viewport
The strip of the layout viewport not covered by an on-screen keyboard — `top`,
`height`, and the `keyboardInset` the keyboard eats. The one measurement every
keyboard-aware surface reads, reconciling three incompatible platform APIs.
→ `hooks/use-visual-viewport.ts` · `useVisibleViewport`, `useKeyboardInset`, `readVisibleViewport`

## Retired names

Renamed or removed. Listed so a stale doc, an old commit message, or a
months-old PR comment can be translated forward. `src/glossary.test.ts`
asserts none of these have come back.

| Retired | Now |
|---|---|
| `fileSlugItems` | `entryKeyItems` |
| `deleteByFileSlug` | `deleteByEntryKey` |
| `newEntrySlug` | `newEntryKey` |
| `parseYamlToStoreItems` | removed — use `parseToStoreItems` |
| `hoistSharedMetadata` | `computeSharedFields` |
| `activeVaultId` | `defaultVaultId` (plus the view filter and per-vault sync) |
| `participantFilter` | `hiddenParticipants` (inverted: hidden, not shown) |
| `needsReconnect` | `needsAttention` (a typed reason, not a boolean) |
| `updateRoot` | `editedEntry` (takes the entry's occurrences too, so a root can't be updated alone) |
| `rootOnlyOccurrence` | removed — `Entry['items']` is non-empty, so `fileOccurrenceMap` is total by construction |
| `useVisualViewportHeight` / `useVisualViewportOffsetTop` | `useVisibleViewport` (one snapshot, with the Firefox-Android fallback) |
| `useShellMode` / `ShellMode` | removed — `_app` and `_entry` each own their own layout chain, so nothing needs to release a shared one |
| `SettingsDialog` | removed — Settings is a route (`routes/_app.settings.*`), not a modal |
| `requestVaultSettings` / `onVaultSettingsRequested` | removed — a vault's settings screen has a URL, so callers link to it |
