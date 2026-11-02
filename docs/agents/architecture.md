# Architecture reference

The rules themselves are in `CLAUDE.md`. This file holds what they rest on:
the root residents, why there are no cycles, and how the two lint gates split
the work.

## Root residents

Root-level files are intentionally cross-cutting: they are imported by three or
more unrelated layers and have no single owning directory. The deliberate root
residents are:

- `types.ts` — pure domain type declarations, plus the four `isX`
  discriminated-union guards that belong beside their unions (`isSeries`,
  `isStandaloneOcc`, `isTracked`, `isEditScope`). No runtime registries or
  logic. The YAML field-parse registry that used to live here is
  `model/fieldRegistry.ts`, private to `model/` since every consumer lives
  there.
- `vaultRef.ts` — the `VaultRef`/`VaultKind`/`GitHubVaultRef` family; a root
  leaf (not `storage/`) because `components/` is barred from importing
  `@/storage` at all (invariant 2), and `@/vaultActions` re-exports `VaultRef`
  for it.
- `store.ts` + `storeBridge.ts` — Zustand store for durable, cross-cutting
  state (vault data, sync status, favorites, prefs); `storeBridge` is imported
  by `storage/`, `editor/`, and `occurrenceActions.ts`/`storeCommit.ts`.
  View-local ephemeral state does not belong here (invariant 5).
- `fileIO.ts` — YAML/frontmatter parse+serialize, the path↔slug mapping, and
  the branded `EntryKey` (`${vaultId}::${fileSlug}`) that composes with it;
  used by `debug/`, `editor/`, `model/`, `storage/`. `EntryKey` lives here
  rather than in a new root file because `model/` may import `fileIO.ts`
  (invariant 1) and this module already owns the identity mapping.
- `wikilinks.ts` — wikilink parse+resolve; used by `editor/`, `model/`, and
  root. Resolution is **per vault**: files store a bare `[[slug]]`, so
  `resolveWikilink` takes the linking file's vaultId and `buildResolveIndex`
  partitions by it.
- `occurrenceActions.ts` — user-action orchestration, including its
  delete-undo toast; used by `editor/` and `calendar/`.
- `storeCommit.ts` + `persistencePort.ts` — persistence-port abstraction
  (invariant 3); used by `editor/`, `storage/`, and `occurrenceActions.ts`.
- `autoSaveFlushPort.ts` — the open entry editor's pending-autosave flush port;
  a root leaf for the same reason as `persistencePort.ts`: `routes/__root.tsx`
  needs to call it at page teardown without statically importing the
  `@/editor` barrel (and with it, CodeMirror) into every route's entry chunk.
- `vaultActions.ts` — used by `components/` and `routes/`.
- `entryRoute.ts` — `newEntryRoute`/`entryRoute`/`keyRoute`, the pure TanStack
  Router Link/navigate descriptor builders for an entry; used by `editor/`,
  `hooks/useOpenEntry.ts`, and `routes/` (`-searchBar.tsx`, `-appSidebar.tsx`).
  A root leaf rather than `routes/-entryRoute.ts` (where it used to live)
  because `routes/` imports all three of those to compose its pages, so a
  feature dir importing it back from `routes/` created a real cycle.
- `format.ts`, `fileOccurrence.ts`, `occView.ts` — view-model helpers; each
  used by three or more feature dirs (`calendar/`, `components/`, `editor/`,
  `hooks/`, `routes/`, `storage/`, `search/`). `occView.ts` also owns the
  display vocabulary: `OccState` (what an occurrence is, derived by its own
  `occState()`) and the painting layer on top of it — `OccHue`/`OccTone`, the
  `colorBy` preference, and the `OccPainter` that resolves both plus the card's
  one chip (bound to the store by `hooks/useOccPainter.ts`).

## Why no cycles, and how to remove one

This is a hard rule and not a stylistic one, for two separate reasons. A
*runtime* cycle means some module in the loop necessarily executes against a
half-initialised copy of the next, so whether it works at all depends on the
order the bundler happens to emit. The failure is silent until it isn't, and
it lands at load time, where there is no stack to read. A *type-only* cycle has
no such bug and is still forbidden: two modules that name each other's types
cannot be read, moved, tested or extracted independently, which is most of
what the boundary was for. Treating the two differently would also make the
rule one keystroke wide: deleting `type` from an import would turn a tolerated
loop into a real one with nothing to catch it. So the checked graph counts type
edges (`tsPreCompilationDeps`), and a shared type gets the same fix as shared
code: put it where neither consumer has to import the other. Usually that is
the module that *produces* values of it. `FilterOccs` sits in
`calendar/useCalendarFilter.ts`, which builds the live filter, not in either of
the two builders that take one.

A cycle is a **placement bug**, not something inherent to feature-sliced React.
Every one this codebase has had turned out to be a file sitting in the wrong
directory, and the two shapes it takes both have a standard fix:

- **A leaf layer importing a feature back.** `components/` is imported by the
  features; nothing in it may import `@/calendar`, `@/search`, `@/editor` or
  any other feature module. When a component genuinely needs one, it is not a
  shared component. It is a composite that belongs beside whatever mounts it.
  `SearchBar`/`AppSidebar` were exactly this, and moved to
  `routes/-searchBar.tsx`/`routes/-appSidebar.tsx`.
- **A downstream module calling back upstream.** Return the request as data and
  let the caller act on it, rather than importing the caller. See
  `storage/sync.ts`'s `SyncCycleResult`: the sync core reports "these vaults
  want a push" and `syncScheduler.ts`, which is upstream of it, does the
  pushing. The type-level form of this is a low layer enumerating its own
  consumers: `storage/cache/db.ts`'s `meta` row is `value: unknown` rather than
  a union naming `VaultRef[]` and `PendingMove[]`, because every reader
  validates what came out of IndexedDB anyway.

Both are ordinary dependency inversion; reach for them before considering
anything more exotic. A cycle is never fixed by adding an exception to
`.dependency-cruiser.mjs`.

## Two lint gates

`pnpm run lint` is `eslint … && pnpm run lint:deps`. ESLint is per-file: it
enforces the module boundaries (invariants 1–3, 5) by asking of each import in
isolation "is this file allowed to import that one". `lint:deps` is
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser), which
builds the whole `src/` module graph first and then asks the questions no
single file can answer, today just one: invariant 4's "is there a cycle".
`import type` is counted as an edge, so type-only loops fail too. Config and
reasoning: `.dependency-cruiser.mjs`.

It reads the same `tsconfig.app.json` path aliases as vite and tsc, so it needs
`src/routeTree.gen.ts` for the same reason the type-aware ESLint rules do. Run
it alone with `pnpm run lint:deps`;
`pnpm exec depcruise src --output-type dot | dot -Tsvg > graph.svg` draws the
graph when you want to look at it.
