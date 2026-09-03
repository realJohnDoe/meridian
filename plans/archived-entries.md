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

Four PRs: the flag and the hiding (1), the actions and editor banner (2), the
settings escape hatch (3), then the retention sweep that does most of the
archiving in practice (4). Because archiving is mostly automatic, the manual
entry point is deliberately tucked inside the delete dialogs rather than given
a topbar button.

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

## PR 4 — the retention sweep

Auto-archiving on a per-vault age threshold. This is what makes the feature
useful day to day, so it follows PR 2 rather than drifting; PRs 1–3 prove the
filters and give the manual escape hatch first. It is the largest of the four
and can be split at the 4b/4d seam if it gets unwieldy.

**Decided:** the age signal is a **real last-modified from the backends**, and
the condition is **age plus finished**. Age alone would archive an undone
overdue task, which is backwards. The cheaper alternative — ageing by the
entry's newest occurrence date, no backend work — was rejected because a
*dateless done task* has nothing to age by (`done` is a bare boolean with no
completion timestamp, `src/model/fieldRegistry.ts:30`), and those should
auto-archive too. That gap is the whole reason for the plumbing in 4b.

**4a. The predicate.** Pure, in `model/`, over the entry's `StoreItem[]`. A
file is a candidate when **every** item is finished:

| Item shape | Finished? |
|---|---|
| tracked, `done: true` | yes |
| tracked, `done: false` | **no** — that's the backlog/overdue, dated or not |
| untracked, past date | yes |
| untracked, future date | no |
| undated and untracked (a note) | **no** — neither done nor past; deliberately left for later |
| `schedule` series with `repeat.end` absent | **no** — unbounded, never all past |
| `schedule` series, bounded and exhausted | yes, if every occurrence is done (tracked) or past (event) |
| `after_completion` series | yes, when it has **no open occurrence left** — see below |

Two traps in that table:

- **"Never ends" is the *absence* of `end`.** The domain type is
  `end?: RepeatEnd` where `RepeatEnd` is only `until | count`
  (`src/types.ts:16`). The `RepeatEndType = 'never' | 'until' | 'count'` union
  in `src/model/repeat.ts:123` is the **form** vocabulary for the repeat
  dialog, not the persisted shape — don't reach for it here.
- **`isTracked` is presence-based** (`src/types.ts:236`): `done: false` is
  still a task. Never simplify to `!!done`.

**`after_completion` needs its own rule, and the codebase already has the
concept.** "All occurrences done" is not a fixed point for these: `done` is
what generates the next occurrence (`src/model/expansion.ts:108`), so
completing the last one just makes another. What *does* end the chain is
having no **open** occurrence — none that is simultaneously undone and
non-excluded — which happens when the last one is cancelled rather than
completed.

`deletionEndsAfterCompletionSeries` (`src/model/storeOps.ts:841`) already
encodes exactly this notion of open, as the *hypothetical* "would deleting
this occurrence end the series?", and its warning copy in
`src/editor/save.ts:309` states the semantics in the user's own words. The
sweep needs the current-state sibling: *does this series have an open
occurrence right now?* — the same `!excluded && !metadata.done` test over the
items the series owns, minus that function's `io.id !== occ.id` clause, which
exists only because it is asking about a deletion that hasn't happened.

Extract that shared "open occurrence" test so the two can't drift apart; it is
the one place where cancelling and completing must keep meaning different
things.

No expansion pass is needed for this branch. `after_completion` "is bounded by
its own instances rather than an open-ended rule"
(`src/model/expansion.ts:966`), so its occurrences are already materialised in
`StoreItem[]` — the predicate reads them directly. Only bounded `schedule`
series need a date walk.

**4b. `lastModified` on the file interface.**

- `RawFile.lastModified?: number` (`src/storage/backend.ts:8`) and
  `DexieFileRow.lastModified?: number` (`src/storage/cache/db.ts:13`).
- **No Dexie version bump.** The field is unindexed, and `stores()` declares
  the primary key and indexes, not the row shape — `baseContent`'s comment
  (`src/storage/cache/db.ts:31`) is the precedent, including its rule that
  readers treat absence on a pre-existing row as its own case rather than a
  default. Here, absent → unknown → never archive. Fails safe.
- **Local FS: free.** `statVersion` and `diskReadAll` already hold the `File`
  object, so `file.lastModified` is right there (`src/storage/fs.ts:76`). Note
  that local `version` is a **content hash** now — `mtime:size` is the legacy
  shape being migrated off (`LEGACY_VERSION_RE`, `src/storage/fs.ts:65`) — so
  this is a new field, not a revival of that token.
- **GitHub: backfill once, then free.** Blobs carry no dates; per-path commit
  dates come from aliased GraphQL `history` queries, the same batching shape as
  `buildBlobQuery` (`src/storage/githubBackend.ts:90`). Path-filtered `history`
  is point-expensive on GitHub's rate limiter, so its batch size needs its own
  tuning rather than inheriting `GRAPHQL_BATCH_SIZE`. Do this on `readAll` only.
- **Incremental sync needs no extra requests at all.** `statAll` already reports
  which paths' version tokens changed, and a changed token *is* the
  modification — stamp `lastModified = now` during reconcile. After a long
  offline stretch this records pull time rather than commit time, which errs
  recent, i.e. fails safe.
- **Say the semantics in the doc comment.** FS mtime is "bytes written on this
  machine"; a GitHub commit date is "committed to this branch". A fresh clone,
  a new device, or a Dropbox/Syncthing resync resets FS mtimes to now, so
  nothing archives for a retention period afterwards — again failing safe. A
  squash-merge or history rewrite does the same on the GitHub side.
- Do **not** reuse `CacheRecord.updatedAt` for this. It is when *this device's*
  cache row was written, and the bulk reconcile stamps `updatedAt: now` on
  every record it refreshes (`src/storage/cache/files.ts:201`), so after a
  fresh pull every file looks edited today.

**4c. The setting.** `retentionDays?: number` on `VaultRefBase`
(`src/vaultRef.ts:29`), beside `color` — optional, so no store migration.
A row in the vault's settings screen, hidden when `!isWritableVault(vault)`:
`example` and `ical` have no writable side, and for a subscription the feed is
upstream anyway.

**4d. The sweep.** Runs per vault after a successful sync settles — not on a
timer, not on render. A file is archived when it passes 4a **and** its
`lastModified` is older than `retentionDays`. Archive through PR 2's
`setArchived`, then one toast: `Archived N entries in <vault> · Undo`. Undo is
real here, unlike the rejected move design — it is a flag flip on files that
never went anywhere.

**Tests.** The 4a table, case by case, including both traps and both
`after_completion` directions: a series whose last occurrence was **cancelled**
archives, one whose last occurrence was **completed** does not (it has just
generated another). A cache row with no `lastModified` never archives. The
sweep respects the per-vault setting and skips vaults where `isWritableVault`
is false.

---

## Deferred

**Rejected, for the record.** A `showArchived` view toggle (misses search, and
the requirement is unconditional hiding); making archived entries read-only;
archiving a single occurrence of a series rather than the whole file — the
model puts file-level fields on the root only, so per-occurrence archiving has
nowhere to live (`extractItemMetadata`, `src/model/storeItems.ts:38`).
