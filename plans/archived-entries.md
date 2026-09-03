# Archived entries

Plan for hiding finished entries from every browsing surface without deleting
or moving their files. Written 2026-09-03, design settled; nothing implemented
yet.

Per `plans/CLAUDE.md`: delete each PR's section from this file in the PR that
implements it, so what remains is only outstanding work.

---

## What this is, and what it replaced

The original ask was a **per-vault retention period** that *deletes* files once
all their occurrences are done or past. That was rejected and then narrowed
twice. The reasoning is recorded here so it isn't re-derived:

- **Deleting was rejected.** The files are the user's own markdown in their own
  folder or repo, a local-FS delete is unrecoverable, and `deleteByEntryKey`
  (`src/model/storeOps.ts:908`) rewrites *other* files' `items:` lists as a side
  effect — a background sweep would silently edit files that aren't expired.
- **Moving to an `archive/` folder was rejected.** The slug is the file's
  identity (`EntryKey` = `vaultId::fileSlug`), so a move breaks `[[wikilinks]]`,
  bookmarked entry URLs, and inbound `items:` references, and needs the
  `PendingMove` staging in `src/storage/moveEntry.ts`.
- **A frontmatter flag won.** No move, no slug change, no link breakage, no
  sync work, no undo machinery, no new derived store state.

The **retention sweep itself is deferred** — see *Deferred* at the bottom. This
plan lands the flag, the hiding and the manual affordances. Archiving will
mostly happen automatically once the sweep exists, so the manual entry point is
deliberately tucked inside the delete dialogs rather than given a topbar button.

---

## The interface

An entry is archived when its file root carries `archived: true`.

| Surface | Archived entry | Why |
|---|---|---|
| Agenda, day, week, month, mini-month, overdue | hidden | the point of the feature |
| Backlog, Notes | hidden | same |
| Search | hidden | explicit requirement — a view-only filter was rejected for missing search |
| Link **pickers** (listed-on, items, wikilink autocomplete) | not offered | you don't link new things to archived files |
| Listed-on chips already on an entry | **shown** | existing links keep working |
| Items list rows already on an entry | **shown** | same |
| `[[wikilink]]` resolution and backlinks | **resolves** | reachability depends on it |
| Entry route (`/entry/<vault>/<slug>`) | **opens** | ditto, and unarchiving needs it |
| Favorites in the sidebar | **shown** | a pin is an explicit pointer, like a link; hiding it would strand the entry |

Opening an archived entry shows an amber banner with an Unarchive button. The
entry stays fully editable — read-only was considered and rejected, because the
archived entry is the one you most need to edit, and `useEntryAccess`
(`src/hooks/useEntryAccess.ts`) carries a pointed comment that its mode is keyed
off `VaultKind` and must stay that way.

**The rule that makes this coherent:** *offering* an entry as a candidate
excludes archived; *resolving or displaying* an existing pointer to one does
not.

---

## The two chokepoints

Everything hides at exactly two places. Do not filter `store.items`,
`store.roots` or `store.entries` — that breaks the entry route, wikilink
resolution and the two link surfaces above, and it was the mistake in an
earlier draft of this design.

### A. Roots-shaped: inside `fileEntries`

`fileEntries(roots, vaultId?)` (`src/fileOccurrence.ts:34`) has exactly four
callers, and **all four** want archived excluded:

| Caller | Surface |
|---|---|
| `src/search/FileResultsList.tsx:56` | search |
| `src/editor/ListedOnRow.tsx:36` | listed-on link picker |
| `src/editor/ItemsList.tsx:79` | items picker |
| `src/editor/WikilinkPopup.tsx:37` | wikilink autocomplete |

So filter inside `fileEntries` itself and all four are covered at once. State
the rule in its doc comment, because the neighbouring function does the
opposite on purpose: `resolveWikilink` (`src/wikilinks.ts:61`, reached from
`src/editor/cm/wikilinkDecorations.ts:113`) must keep resolving archived
targets.

`ListedOnRow` renders its existing chips from `roots.get(key)` directly
(`:72`), and `ItemsList` renders its rows from `fileOccurrenceMap`
(`src/fileOccurrence.ts:254`) — neither goes through `fileEntries`, which is
why the "shown" rows in the table above need no work.

### B. Occurrence-shaped: `useCalendarFilter`

`src/calendar/useCalendarFilter.ts` holds **two** filter compositions, and the
second is easy to miss:

- `filterOccs` (`:85`) — agenda, day, week, month, mini-month, and overdue
  (`src/calendar/overduePool.ts:134` applies it).
- `useParticipantFilteredOccs` (`:121`) — Backlog and Notes, which deliberately
  bypass `filterOccs` so `showTasks` can't blank them.

Archived belongs in the always-on group with vaults and participants, not with
`showTasks`. That file's own doc comment draws the line: *"The vault and people
legs do apply: hiding a calendar means hiding it everywhere."*

**Unconditional — no `showArchived` pref, and no `describeFilter` change.**
Archived-ness is occurrence data, not filter state, so the agenda's section
caches invalidate on their existing safety condition: array length plus
`jsTime` alignment (`src/calendar/agendaSections.ts:189`). Archiving a file
changes the length.

Archived-ness reaches occurrences for free: `archived` is file-level, and
`joinFileMeta` (`src/model/expansion.ts:783`) spreads the root into every
expanded occurrence's `AppMetadata` — the same mechanism that gives every
occurrence its `vaultId`.

---

## PR 1 — the field and the hiding

Lands invisibly: nothing can set `archived` yet, so nothing hides. Verified by
tests and by hand-editing a fixture.

**1a. Prerequisite refactor (do this first).** Extract the always-on legs
shared by `filterOccs` and `useParticipantFilteredOccs` into one function both
call, so an "applies everywhere" leg can only be added in one place. Adding
`hideArchived` to one and forgetting the other is a silent Backlog bug that
nothing currently catches.

**1b. The field.**
- `src/types.ts` — `archived?: boolean` on `FileMetadata`.
- `src/model/fieldRegistry.ts` — `{ key: 'archived', kind: 'boolean', level: 'file' }`
  in `INLINE_FIELDS`. Not `required`.
- Verified safe: `nodeIsItem` (`src/model/storeItems.ts:34`) keys on
  `repeat`/`date`/`instances` only, so a fourth file-level key doesn't perturb
  root-vs-item classification. `extractFileMetadata` and `fileMetaToYaml`
  iterate `FILE_LEVEL_SPECS` generically.
- This is the **first file-level boolean**, which is the trap below.

> **Trap — `archived: false` would be written to the user's file.**
> `inlineFieldEmpty` (`src/model/fieldRegistry.ts:96`) counts only `undefined`
> and empty arrays as empty, so `fileMetaToYaml` (`src/model/collapse.ts:191`)
> emits any boolean, `false` included. **Unarchive must clear the key
> (`undefined`), never set `false`.** Do *not* "fix" `inlineFieldEmpty` for
> booleans: a hand-written `archived: false` must still round-trip, which is
> the Root-A totality invariant `src/model/roundTripCheck.ts` exists to guard.

**1c. One shared predicate.** Two data shapes need the same question answered
(`Occurrence` in the calendar, `FileMetadata` in `fileEntries`), and since
`archived` rides `joinFileMeta` onto occurrences, one predicate over
`{ archived?: boolean }` serves both. Define it once rather than inlining
`meta.archived` at five sites.

**1d. The filters.** Chokepoint A and chokepoint B, as above.

**1e. `GLOSSARY.md`.** An `archived` entry naming the real symbols —
`src/glossary.test.ts` fails otherwise, and that is the point.

**Tests.**
- Registry: `archived: true` survives an unedited round trip; a file with no
  `archived` key still emits none; **unarchiving emits no `archived:` key**
  (the trap above). Neighbourhood: `src/model/__tests__/round-trip-totality.test.ts`.
- `fileEntries` excludes archived roots; `resolveWikilink` still resolves them.
- Both calendar compositions hide archived — including a Backlog/Notes case, so
  the 1a refactor is pinned by a test and not just by discipline.

---

## PR 2 — the actions and the editor UI

**2a. The store op.** `setArchived(data, entryKey, archived): StoreData` in
`src/model/storeOps.ts`, mirroring `moveEntryKey` (`:950`): edits
`entries.get(key).root` only, setting `archived: true` or deleting the key. No
other file is touched — unlike a delete, archiving has no backlink cleanup.

Commit with `commitNext(next, [entryKey])`, the same path `excludeThis` uses
(`src/editor/save.ts:274`). A root-only change serialises correctly:
`fileMetaToYaml` emits file-level fields from the root.

**2b. Archive from the delete dialogs — no topbar button.** Both entry points
widen a callback shape rather than gaining a prop:

- **Single entry.** `deleteNode`'s `onConfirmSingle(title, onConfirm)`
  (`src/editor/save.ts:260`) feeds `pendingDelete: { title, onConfirm }`, which
  feeds `<DeleteDialog>` (`src/editor/DialogStack.tsx:77`). Widen it to carry
  an archive callback and add an "Archive instead" secondary action.
- **Series / multi-item files.** `SeriesDeleteDialog`
  (`src/editor/dialogs/SeriesDeleteDialog.tsx`) is a radio group of
  `SeriesSheetOption`s (`src/editor/save.ts:44`) that chooses *which
  occurrences to delete*, under a destructive "Delete" footer button. Archive
  is file-level, so it must **not** be a fourth radio option — it doesn't
  answer that question and it isn't destructive. Add the same "Archive
  instead" secondary action, labelled to say it applies to the whole file, and
  give `SeriesSheetConfig` (`:52`) an optional archive callback.

  Keeping one affordance shape across both dialogs is the point; a scope
  selector and a file-level action must not look like peers.

**2c. The banner.** Top of `src/editor/EntryEditor.tsx`, above the title block
(around `:200`). Reuse the existing warning idiom verbatim — it appears twice
already, at `src/editor/dialogs/SeriesDeleteDialog.tsx:74` and
`src/settings/VaultSettings.tsx:316`:

```
flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning
```

with `<TriangleAlert size={14} className="shrink-0 mt-0.5" />`. `--warning` is
amber and defined in all four themes (`src/index.css:161`, `:313`, `:409`,
`:492`), so it is theme-safe without extra work.

Banner text says the entry is archived and hidden from the calendar and search,
and carries the **Unarchive** button. Archived state comes from
`roots.get(effectiveKey)?.archived`.

`src/editor/EntryViewOnly.tsx` needs the banner too if an archived entry can be
reached in a view-only vault — check whether `archived` can occur there before
adding it (iCal feeds have no frontmatter, so it may be unreachable).

**Tests.** Archiving from each dialog sets the flag and leaves other files
untouched; unarchiving clears the key; the banner renders only when archived.

---

## PR 3 — the Archived list in vault settings

**Required, not a nicety.** An archived entry that nothing links to is hidden
from every view *and* from search, so with no inbound link it is unreachable —
and standalone notes and one-off tasks are exactly what people archive.

Add an **Archived** row to the Data section of `src/settings/VaultSettings.tsx`
(`:272`, beside Export and Remove): iterate `roots` for that vault's archived
entries, list titles, unarchive from there. It doubles as the place to see how
much has accumulated.

Small and independent — fold into PR 2 if that PR comes in smaller than
expected.

---

## Deferred

**The retention sweep.** Auto-archiving on an age threshold, per vault. This is
what makes the feature useful day to day, so it should follow immediately
rather than drift — but it needs the age signal below, and the manual half
proves the filters first.

**"Last modified" for the age signal.** Findings, so they aren't re-derived:

- There is no usable last-edited timestamp today. Local-FS `version` is a
  **content hash** (`mtime:size` is the legacy shape being migrated off —
  `LEGACY_VERSION_RE`, `src/storage/fs.ts:65`); GitHub `version` is a **blob
  SHA**; and `CacheRecord.updatedAt` is when *this device's* cache row was
  written — the bulk reconcile stamps `updatedAt: now` on every record
  (`src/storage/cache/files.ts:201`), so after a fresh pull everything looks
  edited today.
- Local FS mtime is free if wanted: `statVersion` already holds the `File`
  object (`src/storage/fs.ts:76`).
- GitHub *can* supply it, contrary to a first assessment. Per-path commit dates
  come from aliased GraphQL `history` queries — the same batching shape as
  `buildBlobQuery` (`src/storage/githubBackend.ts:90`). Cheaper still for the
  retention question specifically, which needs a boolean rather than a date:
  `GET /commits?until=<cutoff>&per_page=1` for the boundary commit, then
  `GET /compare/{sha}...{branch}` returns every path touched since — two
  requests, flat, whatever the repo size. Caveats: point-based GraphQL rate
  limits mean batch size needs its own tuning, `compare` truncates on very
  large diffs, and a squash-merge or history rewrite resets every date it
  touches.
- Alternative that needs no backend work: age by the entry's **newest
  occurrence date**, already in the store. Undated notes then never age, which
  is probably correct.

**Rejected, for the record.** A `showArchived` view toggle (misses search, and
the requirement is unconditional hiding); making archived entries read-only;
archiving a single occurrence of a series rather than the whole file — the
model puts file-level fields on the root only, so per-occurrence archiving has
nowhere to live (`extractItemMetadata`, `src/model/storeItems.ts:38`).
