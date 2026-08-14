# Multi-vault Meridian, with iCal subscriptions as the first read-only vault kind

## Context

Meridian's onboarding asks a lot: pick a folder, or sign in to GitHub and connect a repo. An
**iCal subscription** is a far cheaper first step — paste a URL, see your real calendar in
Meridian in seconds — and it is the strongest argument for the app before anyone commits to
writing files anywhere. But a feed is only useful *next to* your own notes and tasks.

The cheap route (iCal as a read-only overlay on one "active" vault) was considered and
rejected: it produces exactly the confusing UI it was meant to avoid — the sidebar saying
"pick one vault" while the filter says "show these calendars" — and it teaches an arbitrary
rule that iCal merges but your work and personal vaults never can.

The root cause is `activeVaultId`, which today silently means four things at once: which
content is loaded, where new entries go, which backend syncs, and whose preferences are live.
Splitting off only the first leaves the name meaning the other three. So this plan takes the
concept apart and replaces it with three independent ideas:

| Concept | Means | Controlled from |
|---|---|---|
| **Registered** (= mounted) | Loaded into the store and kept in sync | Settings → Add / Remove vault |
| **Visible** | Shown in agenda / calendar / lists | The view filter |
| **Default** | Where new entries go unless overridden | Settings; overridable per entry |

Writability then becomes an ordinary per-vault property, so an iCal feed is simply "a vault
kind that happens to be read-only" — no special case anywhere.

### Decisions taken

| | |
|---|---|
| **Scope** | **Full multi-vault first.** N vaults registered, read *and* write, each syncing. iCal lands on the foundation. |
| **Entry identity** | **Branded composite string** `EntryKey` = `${vaultId}::${fileSlug}`. |
| **Vault id** | **One identifier, used in URLs too.** New vaults get readable derived ids; existing UUIDs stay as they are. No alias field, no migration. |
| **Mount vs. view** | **Separate.** Every registered vault syncs; visibility is purely a UI filter. |
| **Filter shape** | **Nested** — vault rows expand to the people in that vault, with per-vault person state. |
| **New entries** | A **default vault**, overridable per entry before the first save. |
| **Moving entries** | **Supported** between writable vaults; the confirm dialog warns which wikilinks break. |
| **Move UI** | The **vault chip in the editor** becomes a picker. |
| **Wikilinks** | **Scoped per vault.** |
| **Sync loop** | **Serial, oldest-synced first**, per-vault minimum intervals and per-vault backoff. |
| **Fetching iCal** | **Proxy through the existing Cloudflare Worker** (`meridian-oauth`). |
| **Naming** | **Any vault can be renamed** (except the synthesized Tutorial vault). |
| **Non-writable entries** | **Two distinct modes**, not one: `sandbox` (Tutorial — full edit UI, "not saved" banner, unchanged) vs `read-only` (iCal — a genuinely plain, non-editable view). |
| **Delivery** | A behaviour-identical prep PR, then six feature PRs, each independently shippable. |

### On identifiers — no new UUIDs

Worth stating plainly, because the occurrence-id trouble is the relevant precedent: **this
plan mints nothing at parse time.** `EntryKey` composes two identifiers that already exist and
are already stable, and the iCal slug is a deterministic hash of the event's `UID` — the same
pattern `model/storeItems.ts:189` already uses (`stableId(\`${fileSlug}|occ|${date}|${time}\`)`)
after the move away from random occurrence UUIDs. A feed re-fetched unchanged therefore
produces byte-identical slugs, and reconcile sees no change.

The vault id itself cannot be derived from vault properties — checked per kind:
`owner/repo@branch` is a genuine natural key but contains `/` and `@` (unusable as a path
segment); a local folder's name is neither unique nor stable across re-picking; an iCal URL is
unique but is the user's secret address. So it stays an assigned id — but assigned **once at
vault creation and persisted**, never regenerated, which is the property that matters.

---

## Architecture

### 1. `EntryKey` — a branded composite string

An entry's identity is `(vault, slug)`. `Roots` is a `Map`, and JS Maps compare object keys by
reference, so a tuple can never be a lookup key. A **branded** string gives the type safety of
a distinct type while staying a real string for `Map`, `Set`, route params, Dexie and
localStorage:

```ts
// src/fileIO.ts — beside pathToSlug/slugToPath, the existing owner of this mapping
declare const EntryKeyBrand: unique symbol
/**
 * In-memory identity of an entry: `${vaultId}::${fileSlug}`. Branded so a bare
 * string cannot be passed where a key is required — the bare-slug-vs-key mix-up
 * is a compile error, not a runtime bug. Never written to a file; files and URLs
 * carry the two halves separately. Mirrors the Dexie cache's own
 * `vp(vaultId, path)` composite key.
 */
export type EntryKey = string & { readonly [EntryKeyBrand]: true }

export function entryKey(vaultId: string, fileSlug: string): EntryKey
export function parseEntryKey(key: EntryKey): { vaultId: string; fileSlug: string }
export function keyVaultId(key: EntryKey): string
export function keySlug(key: EntryKey): string       // the bare slug, for display
export function pathToKey(vaultId: string, path: string): EntryKey
export function keyToPath(key: EntryKey): string
```

`fileIO.ts` is already a root resident imported by `model/`, `storage/`, `editor/` and
`debug/`, and already owns `pathToSlug`/`slugToPath` — so this needs **no new root file and no
eslint config change**, and `model/` (which may import only `types.ts`, `fileIO.ts`,
`wikilinks.ts`) can use it without violating invariant 1.

Then:

- **`OccurrenceEntry.fileSlug` / `RepeatPattern.fileSlug` are renamed to `entryKey`.**
  `Roots` becomes `Map<EntryKey, FileMetadata>`. `model/` treats the key as opaque — it never
  parses it — so the domain core stays vault-agnostic.
- **`FileMetadata` gains two runtime-only fields**, in the same never-serialized family as the
  existing `fileConvention`:
  ```ts
  /** Which vault this file came from. Runtime-only, never serialized. */
  vaultId:  string
  /** The bare, file-level slug — what `[[wikilinks]]` and the URL carry. */
  fileSlug: string
  ```
  Neither is in `INLINE_FIELDS` (`model/fieldRegistry.ts`), so `collapseToYaml` never emits
  them. **`updateRoot` in `model/storeOps.ts` must carry both forward** alongside
  `fileConvention` and `extra`, or an edit silently drops provenance.
- Because `AppMetadata = OccurrenceMetadata & Omit<FileMetadata,'extra'> & …` and
  `joinFileMeta` spreads the root into every expanded occurrence, **every `Occurrence` gets
  `vaultId` and a display `fileSlug` for free** — no change to the expansion engine or to any
  view's data plumbing.

The rename touches ~371 references across ~33 non-test files. It is mechanical and fully
TypeScript-checked, and lands as its own commit so the semantic diff is reviewable separately
from the noise. The branding is what makes it worth doing: after this change two slug-shaped
strings coexist (the key, in memory; the bare slug, in files and URLs), and the compiler now
refuses to confuse them.

### 2. Vault ids and URLs — one identifier

No alias field. `VaultRef.id` is the single identity: the Dexie partition key
(`vp(vaultId, path)`), the credential key, the localStorage pref suffix, **and** the URL
segment.

New vaults get a readable id derived once at creation, replacing `crypto.randomUUID()` in
`addLocalVault` / `addGitHubVaultOAuth`:

```ts
// storage/vaultRegistry.ts
newVaultId(name: string, taken: Set<string>): string   // titleToSlug + '-2', '-3' on collision
```

`realjohndoe/meridian` → `realjohndoe-meridian`; a folder called Notes → `notes`, a second one
→ `notes-2`. The Tutorial vault already uses the readable id `example`, so this is consistent
rather than new. Vaults you already have keep their UUIDs — no Dexie rows, credentials or pref
keys move, and no migration can orphan a GitHub token or an FS handle. The trade you accepted
is that their URLs stay ugly until re-added.

```
/meridian/entry/realjohndoe-meridian/meeting-notes
/meridian/entry/family-cal/ical-9f8e7d6c
```

**Renaming never changes the id**, so bookmarks survive — but the URL keeps the word the vault
was created with. Worth one line of copy in the rename field so it isn't a surprise.

Route call sites are few and mostly funnel through `routes/-entryRoute.ts`
(`entryRoute`/`slugRoute`/`newEntryRoute`); only two raw `to: '/entry/$slug'` literals exist,
both in `editor/useEntryEditor.ts`. Keep the old `_app.entry.$slug.tsx` as a **redirect route**
resolving a bare slug against the default vault, so existing bookmarks keep working.

### 3. Registered = mounted; visibility is separate

Adding a vault in Settings mounts it; removing unmounts it. **So `store.vaults` already *is*
the mounted set — there is no separate mounted-ids state.** Every registered vault is loaded
into the store and kept in sync. The only new state is view visibility and the default target:

```ts
// src/store.ts
/** Parsed content per registered vault. `items`/`roots` are the flattened merge. */
layers: Map<string, { items: StoreItem[]; roots: Roots }>
setVaultLayer:    (vaultId: string, data: { items: StoreItem[]; roots: Roots }) => void
removeVaultLayer: (vaultId: string) => void

/** Where new entries go unless overridden. Always a writable, registered vault. */
defaultVaultId: string | null
```

`items`/`roots` stay the flattened view every existing consumer already reads, so nothing
downstream changes shape. `backlinks` and `warmFileOccurrenceMap` recompute off the merge
exactly as today.

⚠️ **The Tutorial vault is synthesized into the list on every load** (`EXAMPLE_REF`,
`vaultRegistry.ts:54`), so "visible by default" would drop tutorial entries into a real agenda
forever. Hide it as soon as the first real vault is registered.
`onboarding/CoachTour.tsx:71` gates on `activeVaultId === 'example'` and must become "no
writable vault registered yet".

⚠️ **`activateExampleVault` must switch from `setData(...)` to `setVaultLayer('example', ...)`.**
Today it calls `setData`, which replaces the whole store — harmless when it's the only vault, but
under the layered model it would silently wipe out every other registered vault's content the
moment the Tutorial vault (re-)activates. It stays on its own cache-free path (no Dexie, no
`runSync`, per §4) — only the store write needs to become a normal layer write like every other
backend's.

⚠️ `storage/sync.ts` reads `getItems()`/`getRoots()` in two places that must see **one layer,
not the merge** — `mergeChangedIntoStore` (rebuilds the store by filtering out affected keys)
and `writeEntityToCache` (collapses one file back to YAML). Add `getVaultLayer(vaultId)` to
`storeBridge.ts` and use it at both sites.

**The sidebar's per-vault list goes away.** Once "registered", "visible" and "default" are three
separate concepts (see the table above), a second list of vaults in the sidebar — alongside the
filter's — is the same radio-vs-checkbox confusion this plan exists to remove, just relocated
rather than solved. Each concept gets exactly one home instead: **Settings** owns registration
(add/remove/rename) and the default-vault choice (§14); the **filter** owns visibility (§9); the
**`SyncButton`** popover owns status, including the "needs reconnect" indicator that lives in the
sidebar today (§4). The sidebar keeps its single "Settings" entry, unchanged, and drops the
`SidebarGroupLabel className="…">Vaults</SidebarGroupLabel>` block and `vaultIcon` usage
entirely — `Sidebar.tsx` still changes (favourites' `slugRoute` picks up the new URL shape), just
not for a vault list.

### 4. Per-vault backends and a serial, per-vault sync loop

`storage/activeBackend.ts` (a single module slot) becomes `storage/backends.ts`:

```ts
mountBackend(b: StorageBackend): void
unmountBackend(vaultId: string): void
getBackend(vaultId: string): StorageBackend | undefined
getMountedBackends(): StorageBackend[]
```

`storage/sync.ts`'s six module-level singletons — `_syncing`, `_pushTimer`, `_pushQueued`,
`_consecutiveFailures`, `_nextRetryAt`, `_lastErrorSig` — become one `VaultSyncState` record
per vault in a `Map` (PR 0 collects them into the object; PR 2 puts the object in a Map).
`inFlight.ts`'s path registry is keyed by `EntryKey` instead of bare path.

**The tick becomes a scheduler.** `autoSyncTick` walks registered vaults **oldest-synced first
and syncs them one at a time**, skipping any whose own minimum interval hasn't elapsed:

```
minInterval:  local ~30s · github ~60s · ical ~15min   (per-vault, ETag-aware)
```

Serial rather than parallel on purpose: each `GitHubBackend` owns its own throttled Octokit
client, so nothing coordinates bursts across vaults — the same secondary-rate-limit concern
that already makes `reconcileWithBackend` switch to `readAll()` above 50 changed paths. It also
keeps mobile wake cost flat as vaults are added. `flushPendingPush` on `pagehide` must flush
**every** vault.

Store sync state follows:

```ts
syncByVault: Map<string, {
  dirtyCount: number; error: string | null; offline: boolean
  inProgress: boolean; lastSyncedAt: number | null; readOnly: boolean
}>
```

`SyncButton` aggregates for its icon (worst status wins) and lists per-vault rows in its
popover — now the **one** place per-vault status lives, since the sidebar's vault list is gone
(§3). Each row absorbs what the sidebar used to show inline: dirty count, error/offline state,
and the local vault's "needs reconnect" `AlertCircle` (today `pendingDirReconnect`, gated
`vault.kind === 'local'`), with a click there triggering the same interactive permission
re-request `setActiveVault` used to do on a sidebar click. This also retires the two hardcoded
"Tutorial vault — changes aren't saved." strings (`SyncButton.tsx:56`, `EntryEditor.tsx:150`) in
favour of the vault's own name and kind.

**A read-only vault is no longer a dead end.** `runSync` currently bails entirely on
`backend.readOnly`. Narrow that: skip `pushDirty` when read-only, but still reconcile when
`pull` is set. An iCal refresh is then literally `runSync(vaultId, { pull: true })` — **no
separate subscription refresh loop is needed at all.** (The Tutorial vault stays on its own
cache-free `activateExampleVault` path; changing it buys nothing and widens the blast radius.)

### 5. Persistence port — one new method, no signature churn

Invariant 3 says core persistence goes through the port. It stays intact because the vault now
rides inside the key:

```ts
export interface EntityPersistence {
  writeEntity(key: EntryKey): void
  deleteEntity(key: EntryKey): void
  /** Cross-vault move. One call so the durability ordering below lives in one place. */
  moveEntity(fromKey: EntryKey, toKey: EntryKey): void
}
```

`writeEntityToCache(key)` resolves `getBackend(keyVaultId(key))`, refuses a read-only or
unregistered vault, and writes to `keyToPath(key)`. `storeCommit.ts` and `occurrenceActions.ts`
need no logic change for the first two — they already pass through whatever identity they were
handed.

### 6. Moving an entry between vaults

**Durability ordering is the whole design.** `moveEntity` records the local edit in the
*target* vault first, then the local delete in the source:

```
recordLocalEdit(targetVaultId, targetPath, content)   // durable in Dexie, dirty
recordLocalDelete(sourceVaultId, sourcePath)          // durable in Dexie, tombstone
```

Both land in IndexedDB before either push cycle runs, so a crash or an offline window can at
worst leave the entry present in both remotes — visible and recoverable — never absent from
both. This mirrors the rule `sync.ts:resolveCollision` already documents at length ("the local
content must be durable *somewhere* before the dirty record holding it is cleared", and "an
edit beats a delete").

Around that:

- **Slug collision in the target** — reuse `model/storeOps.newEntrySlug`'s allocation against
  the target layer, so moving `meeting-notes` into a vault that already has one lands as
  `meeting-notes-2` rather than clobbering.
- **Wikilinks break, visibly and by design.** Links are per-vault, so a move orphans every
  `[[slug]]` in the source vault that pointed here, and every link *inside* the moved file that
  pointed at the source vault. The confirm dialog counts both — from `backlinks` and the file's
  own parsed links — and says so plainly. Broken links already render distinctly (`.wl-broken`,
  `editor/EntryBody.tsx` theme), so the damage is legible and hand-repairable.
- **Follow-through** — the entry's `EntryKey` changes, so: favourites migrate from the source
  vault's list to the target's, the open route navigates to the new `/entry/$vault/$slug`, and
  the `fileOccurrenceMap`/`backlinks` indexes rebuild off the new merge.
- **Scope** — writable ↔ writable only; never into or out of a read-only vault. No undo (two
  durable writes in two vaults); the confirm dialog carries the weight instead.
- **UI** — the source chip in the editor becomes a picker offering registered writable vaults,
  the same control as the new-entry vault chip.

### 7. New entries

`defaultVaultId` (settable in Settings) is the target, **overridable per entry**:
`newEntryRoute` gains an optional `vault`, and `_app.entry.new.tsx` renders the same vault
chip — defaulting to `defaultVaultId`, listing registered writable vaults — changeable before
the first save; that chip is the marker, so no separate sidebar indicator is needed.
`defaultParticipants` is read from the *target* vault at create time
(today it reads the active vault's), so the seed matches where the entry lands.

### 8. Preferences: per-vault vs global, settled

Everything participant-related is per-vault, full stop — two vaults can each have a "Bob" who is
a different person, and nothing should conflate them. `hiddenParticipants` in §9 already models
this correctly (`Record<vaultId, string[]>`, so hiding one vault's Bob leaves another's checked);
an earlier draft of this table mislabeled it "global" alongside `hiddenVaultIds`/`defaultVaultId`,
which really are cross-vault (a set of vault ids; a pointer to one vault) rather than per-vault
values at all. Fixed here:

| Pref | Scope | Loading | Why |
|---|---|---|---|
| `favorites` | per vault | **eager** — every registered vault at once | A favourite belongs with its vault; entries are `EntryKey`s, so writes route by `keyVaultId` and a move migrates cleanly. The sidebar's Favorites list spans every registered vault simultaneously, so this can't wait for a vault to "activate" the way `loadVaultPrefs` does today. |
| `hiddenParticipants` | per vault | **eager** — every registered vault at once | Same reason as favourites: the filter popover (§9) shows every registered vault's people at once, so a "Bob" hidden in Work must have no effect on Personal's Bob, and both must be visible in the tree without switching vaults first. |
| `defaultParticipants` | per vault | **lazy** — one vault at a time, on demand | Only ever consulted for *one* vault: the new entry's target, or whichever vault Settings currently has open. The existing per-vault-key, load-on-demand mechanism (`lib/vaultStorage.ts`) fits unchanged. |
| `showTasks` | global | n/a | A view question, not a vault question. |
| `hiddenVaultIds`, `defaultVaultId` | global | n/a | Genuinely cross-vault — a set of vault ids, and a pointer to one vault — never partitioned by vault at all. |

**The eager ones are a real departure from today's loading pattern**, worth flagging for PR 2:
`storeBridge.loadVaultPrefs(vaultId)` is called once, for whichever single vault just activated.
With several vaults registered simultaneously, `favorites` and `hiddenParticipants` instead need
to be loaded once at startup for *every* registered vault, and re-read when a vault is added or
removed — `defaultParticipants` is the only field left that still fits the old one-vault-at-a-time
call. Storage-wise this is simpler than it sounds: `favorites` needs no per-vault key at all
(`EntryKey` already carries the vault id, so one flat `EntryKey[]` under a single localStorage key
works), and `hiddenParticipants` persists as one key holding the whole `Record<vaultId, string[]>`
blob rather than via `${prefix}_${vaultId}` per vault.

### 9. One nested filter: vaults, expanding to their people

Per your point about feeds from a particular person: **no data-model coupling** — an iCal vault
is never modelled as belonging to a participant. The nesting is in the filter only.

`components/ParticipantFilterButton.tsx` becomes `components/ViewFilterButton.tsx`: the same
topbar pill, whose popover is now a two-level tree. Vault rows are tri-state parents (all /
some / none); each expands to the participants appearing **in that vault**, plus that vault's
"No participants" row. `components/ui/collapsible` is already vendored and unused. The tree
collapses to a flat people list when only one vault is registered, so nothing changes for
single-vault users.

```
Calendars & people                Clear
▾ ☑ Work
     ☑ Alice   ☑ Bob   ☑ No participants
▾ ☑ Personal
     ☑ Alice   ☑ Sam
▸ ☑ Alice's calendar    (no attendees)
▸ ☐ Tutorial
```

**State is "hidden", not "shown", throughout** — so a newly added vault, and a newly appearing
attendee, are visible by default rather than silently filtered out:

```ts
hiddenVaultIds:     string[]
hiddenParticipants: Record<string /* vaultId */, string[]>   // '' sentinel = no-participants row
```

This **inverts today's `participantFilter` semantics** (today: empty = show all, checked =
narrow to those). One-time migration at load: `hidden = allParticipants − oldFilter` when the
old value is non-empty, `[]` otherwise — computed against the participant set known at
migration time, and best-effort by nature.

`calendar/useCalendarFilter.ts` is the single choke point all five view call sites funnel
through, so the vault leg composes there ahead of the existing two, keyed off
`occ.metadata.vaultId`:

```ts
filterOccs = hideVaults ∘ hideTasks ∘ hidePeoplePerVault
```

⚠️ `calendar/agendaSections.ts` keys its reuse cache on `filterOccs` **by reference**
(≈ lines 332/347/512) and applies it per day bucket. Both new state fields must join
`useCalendarFilter`'s `useCallback` deps — complete *and* referentially stable — or the agenda
cache thrashes on every render. `hiddenParticipants` being a `Record` makes this sharper than
before: it must be replaced, never mutated.

### 10. Wikilinks, scoped per vault

Files store bare `[[slug]]`, so resolution must happen *within the linking file's vault*:

```ts
resolveWikilink(ref: string, roots: Roots, vaultId: string): EntryKey | undefined
buildResolveIndex(roots: Roots): Map<string /* vaultId */, Map<string, EntryKey>>
```

`buildBacklinkIndex(roots)` resolves each root's `items` inside its own vault and returns
`Map<EntryKey, EntryKey[]>`. This falls out of the identity change rather than being a feature
— and it means a link can never silently retarget an event in a subscription whose UID changes
on the next refresh.

`editor/ItemsList.tsx`, `ListedOnRow.tsx` and `usePendingLinks.ts` are where bare slugs (what
goes in the file) meet keys (what the store holds); the branding in §1 turns every such site
into a compile error rather than a lurking bug.

### 11. Per-entry access, and the plain read view

Two different vaults are read-only today, for two different reasons, and the UI should say so
differently. The **Tutorial vault** is a sandbox — its whole pedagogical point is that you can
poke at the type toggle, try a repeat rule, tick a checkbox, and see it work, with a banner
explaining that none of it is saved. An **iCal feed** has no such use case: there is no source
to write back to, so offering property chips and a save button would mislead rather than
onboard. So this is not one "read-only" mode, it's two, and only one of them gets the new plain
view:

```ts
// src/hooks/useEntryAccess.ts
export type EntryAccess =
  | { mode: 'edit';      vault: VaultRef }
  | { mode: 'sandbox';   vault: VaultRef }   // Tutorial: full edit UI, writes silently discarded — unchanged from today
  | { mode: 'read-only'; vault: VaultRef }   // subscription: no edit affordances — nothing to save back to

/**
 * ⚠️ Keyed off `VaultKind`, NOT off `StorageBackend.readOnly` — and it must stay that way.
 * Both `example` and `ical` are `readOnly` to the sync layer (neither pushes writes), so
 * "simplifying" this to read that flag would hand the sandbox vault the no-affordances view
 * and destroy the tutorial's whole point. The two notions are genuinely independent: the
 * backend flag answers "do writes get pushed", this answers "what does the editor offer".
 */
function accessMode(kind: VaultKind): EntryAccess['mode'] {
  if (kind === 'example') return 'sandbox'
  if (kind === 'ical')    return 'read-only'
  return 'edit'
}
export function useEntryAccess(occ: Occurrence | null): EntryAccess
```

`sandbox` is not a new coinage — it is the word the tutorial's own copy already uses four times
(`exampleBackend.ts`: "This is a read-only sandbox — poke around freely", "this sandbox is
read-only"), so this aligns the code vocabulary with the product's.

Deriving the mode from `VaultKind` alone is deliberate and keeps this cheap: it needs no new
field on `StorageBackend` or per-vault sync state, just a lookup already available where hooks
live (`components`/`hooks` may not import `@/storage` anyway).

**`sandbox` gets no new work at all** — `EntryEditor` already renders it exactly as today
(full affordances, the "changes aren't saved" banner from §4, generalized to the vault's own
name). Only `read-only` routes to a new sibling component. `EntryEditor`'s always-required
hook members (`setEntry`, `handleSave`, `handleOpenDlg`, `handleOpenRepeatDlg`,
`handlePromoteTask`) are all mutators, so bending it into a read view for `read-only` would
mean disabling a dozen affordances — a sibling presentational component is cleaner and is what
"a different look, so as not to confuse users" actually asks for:

```
editor/EntryReadonlyView.tsx
```

Title as static text, a source chip (vault icon + name, **not** a picker in this mode),
date/time/duration/participants as `Badge variant="tag"` chips instead of pressable
`PropChip`s, `LOCATION`/`URL`/organizer from `extra`, and the body through **`EntryBody` with a
new `readOnly` prop** (`EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`).
Reusing `EntryBody` is deliberate: `markdownLivePreview` renders formatting on every line that
has no cursor, so read-only mode renders the markdown *better* than editing mode does, and
wikilink decorations keep working for free.

`routes/-entryTopbar.tsx` needs a prop to drop the delete button for `read-only` only — the
Tutorial vault's topbar is unchanged, whatever its current quirks (its delete button today is
already a no-op past the storage layer; not this plan's concern to fix).

### 12. iCal vault kind

With the foundation in place this is just another backend. `storage/exampleBackend.ts` is the
template: it synthesizes virtual `.md` files with YAML frontmatter and rides the entire
existing pipeline — `parseToStoreItems` → expansion → agenda → search → backlinks. **No
parallel parse path.**

```
storage/ical/icsParse.ts      — line unfolding, property+param tokenizer, VEVENT extraction (pure)
storage/ical/rruleToRepeat.ts — RRULE → Meridian `Repeat`, with a bounded-expansion fallback
storage/ical/icsToEntries.ts  — VEVENT[] → { slug, content }[] markdown + frontmatter (pure)
storage/icalBackend.ts        — StorageBackend; readOnly = true; write/delete throw
```

No new dependency — hand-rolled, matching how the repo already hand-rolls its YAML round-trip
semantics. `ical.js` is large; `node-ical` is Node-only.

| ICS | Meridian |
|---|---|
| `SUMMARY` | `title` |
| `DTSTART` (DATE) | `date` |
| `DTSTART` (DATE-TIME) | `date` + `time` |
| `DTEND` / `DURATION` | `duration` |
| `DESCRIPTION` | markdown body |
| `ATTENDEE` (CN param) | `participants` |
| `RRULE` | `repeat` |
| `EXDATE` | `instances: [{ date, excluded: true }]` |
| `RECURRENCE-ID` | `instances: [{ date, … }]` override |
| `LOCATION`, `URL`, `UID`, `ORGANIZER`, original TZID | `extra` (rendered in the read view) |
| `STATUS:CANCELLED` | skipped |

**Timezones — the sharpest edge.** `OccurrenceMetadata.timezone` is parsed and round-tripped
but *never consumed anywhere* (`grep timezone src/` finds only `fieldRegistry`, `storeOps`,
`types`). So don't rely on it: convert `TZID=`/`Z` timestamps to the **viewer's local wall
clock at synthesis time**, store plain local `date`/`time`, keep the original TZID in `extra`.
The temporal engine stays untouched and the agenda is correct. Feeds are re-synthesized on
every refresh, so a device timezone change is picked up next refresh. `VTIMEZONE` blocks are
ignored in favour of `Intl` on the IANA id.

**Unrepresentable RRULEs** (odd `BYSETPOS`, `BYYEARDAY`, …): expand them ourselves over a
bounded window (−1 y … +2 y) and emit explicit dated occurrences. Honest, bounded, no engine
change.

**Version tokens.** `statAll()` must return per-path versions but a feed has one ETag.
`IcalBackend` fetches once per sync cycle and memoizes; per-entry version is a content hash.
Reconcile then works unmodified, and only genuinely changed events re-render.

**Slugs.** `ical-<short hash of UID>` — deterministic, flat and URL-safe, no `/` (which would
break the `$slug` path segment). Cross-vault uniqueness comes from `EntryKey`.

### 13. Worker proxy

```
worker/src/icalFetch.ts   — GET /ical?url=<encoded>
worker/src/icalFetch.test.ts
```

Wired into `worker/src/index.ts` beside `/oauth/token`, reusing `corsHeadersFor`. Must: accept
`https:` and `webcal:` (rewritten to https); **reject private/loopback/link-local hosts
(SSRF)**; cap response size (~5 MB) and timeout (~10 s); pass `If-None-Match` through and
return `ETag`; respond `text/calendar`.

Hoist `WORKER_ORIGIN` out of `storage/githubOAuth.ts:6` into `storage/workerOrigin.ts` so both
callers share it. The privacy trade-off is real and belongs in the wizard copy: the calendar
URL and its contents pass through Meridian's worker.

### 14. Settings: vault-scoped vs general

The split exists structurally already; it just isn't legible. Restructure `SettingsDialog` into
two labelled regions with explicit scope captions:

- **General** — *"Applies to Meridian on this device"*: Appearance/theme, default vault for new
  entries.
- **Vaults** — *"Settings for the selected vault only"*: the vault picker, then `VaultSettings`
  with **Name** (new, editable), the kind-specific detail row (Folder / Repository /
  **Calendar URL + refresh interval + last refreshed + Refresh now**), Default participants,
  that vault's sync status, Remove vault.

Adding and removing here is what mounts and unmounts — the caption says so, which is where the
difference from the view filter gets stated. `renameVault(id, name)` goes through the existing
`updateVaultRefs` helper and leaves `VaultRef.id` untouched, so URLs survive; the field notes
that the URL keeps the original name. The Tutorial vault is synthesized fresh on every load, so
exclude it from renaming rather than inventing an override store.

---

## Files

**New**

```
src/storage/backends.ts                 (replaces activeBackend.ts)
src/storage/ical/icsParse.ts            + .test.ts
src/storage/ical/rruleToRepeat.ts       + .test.ts
src/storage/ical/icsToEntries.ts        + .test.ts   (+ __fixtures__/*.ics)
src/storage/icalBackend.ts              + __tests__/icalBackend.test.ts
src/storage/moveEntry.ts                + __tests__/moveEntry.test.ts
src/storage/workerOrigin.ts
src/hooks/useEntryAccess.ts             + .test.ts
src/editor/EntryReadonlyView.tsx        + .test.tsx
src/editor/VaultPicker.tsx              (the chip; new-entry + move)
src/components/ViewFilterButton.tsx     (replaces ParticipantFilterButton.tsx)
src/components/VaultChip.tsx
src/routes/_app.entry.$vault.$slug.tsx  (+ old route kept as a redirect)
worker/src/icalFetch.ts                 + .test.ts
```

**Modified**, grouped by reason — several are the same one-line pattern repeated:

- *Identity*: `types.ts`, `fileIO.ts`, `wikilinks.ts`, `fileOccurrence.ts`,
  `model/storeOps.ts` (`updateRoot`, `fileSlugItems`, `newEntrySlug`, `slugTaken`),
  `model/storeItems.ts`, `model/expansion.ts` (`joinFileMeta`), `test-utils/index.ts`
  (`makeRoots`), plus the mechanical `fileSlug`→`entryKey` rename across ~33 non-test files.
- *Routing*: `routes/-entryRoute.ts`, `routes/-entryTopbar.tsx`, `editor/useEntryEditor.ts`
  (two raw `to:` literals), `hooks/useOpenEntry.ts`, `components/Sidebar.tsx` (favourites'
  `slugRoute` picks up the new URL shape), `components/SearchBar.tsx`,
  `storage/vaultRegistry.ts` (`newVaultId`).
- *Multi-vault*: `store.ts`, `storeBridge.ts`, `storage/vaultRegistry.ts`, `storage/sync.ts`,
  `storage/inFlight.ts`, `persistencePort.ts`, `storeCommit.ts`, `occurrenceActions.ts`,
  `components/SyncButton.tsx` (per-vault rows, absorbing the sidebar's old "needs reconnect"
  indicator), `components/Sidebar.tsx` (**remove** the per-vault list — see §3),
  `onboarding/CoachTour.tsx`.
- *New `VaultKind`* (TypeScript finds all of these): `vaultRef.ts`,
  `storage/cache/registry.ts`, `storage/vaultRegistry.ts`, `components/vaultIcon.ts`,
  `components/AddVaultWizard.tsx`, `components/VaultSettings.tsx`, `storage/index.ts` +
  `vaultActions.ts` re-exports — components may not import `@/storage`, lint-enforced.
- *Filter / settings*: `calendar/useCalendarFilter.ts`, `routes/_app.tsx` (topbar mount),
  `components/SettingsDialog.tsx`, `components/VaultSettings.tsx`.
- `worker/src/index.ts`.

**Reuse — do not rebuild**

| Need | Existing |
|---|---|
| Synthesized virtual `.md` vault | `storage/exampleBackend.ts` (the template) |
| Register + activate a vault | `registerAndActivate` / `updateVaultRefs`, `vaultRegistry.ts` |
| Offline cache, already vault-partitioned | `storage/cache/files.ts`, `vp(vaultId, path)` — **no schema migration** |
| Durable local edit / delete for a move | `recordLocalEdit`, `recordLocalDelete` (`cache/files.ts`) |
| Write-before-delete ordering rule | documented on `sync.ts:resolveCollision` — follow it |
| Free-slug allocation on move | `model/storeOps.newEntrySlug` / `slugTaken` |
| Deterministic id derivation | `model/expansion.stableOccId`, `storeItems.stableId` — the pattern for iCal slugs |
| Readable vault ids | `fileIO.titleToSlug` |
| Per-vault prefs | `lib/vaultStorage.ts`, `persistedArrayField`, `loadVaultPrefs` |
| Editing a non-active vault's settings | `VaultSettings.handleParticipantsChange` — the precedent |
| Refresh loop for a read-only vault | `runSync({ pull: true })`, once the `readOnly` bail is narrowed |
| CORS wrapper | `worker/src/cors.ts` `corsHeadersFor` |
| Filter choke point | `calendar/useCalendarFilter.ts` (all five view call sites funnel here) |
| Collapsible filter sections | `components/ui/collapsible` (vendored, currently unused) |
| Chips / badges | `components/ui/badge` (`tag`/`link`), `components/TagChip.tsx` |
| Broken-link styling | `.wl-broken` in `editor/EntryBody.tsx`'s theme |
| Vault → icon | `components/vaultIcon.ts` |

**Note:** CLAUDE.md's "Entry editor search params: `editor`, `edate`, `escope`, `etitle`" line
is stale — those params exist nowhere in `src/`. Fix it in PR 1, which touches the route anyway.

---

## PR sequence

**PR 0 — Prepare the storage layer (behaviour-identical).** No user-visible change, existing
tests unchanged; this is what keeps the risky PR 2 mechanical.

- Thread `backend` explicitly through `sync.ts` instead of calling `getActiveBackend()` inside
  `updateSyncUI`, `runSync`, `scheduleAutoPush`, `writeEntityToCache`, `deleteFromBackend`
  (`reconcileWithBackend` and `pushDirty` already take it).
- Collect `sync.ts`'s six module-level mutables into one `VaultSyncState` object — still a
  single instance.
- Split `vaultRegistry.ts`'s "load this vault's content into the store" from "make it the
  active one" (`activateWritableVault` / `activateVaultRef` / `restoreVaultsInner` currently
  conflate them).
- Make `store.ts`'s `persistedArrayField` / `persistedBoolField` take an explicit vaultId
  instead of reading `get().activeVaultId`.

**PR 1 — Vault-qualified entry identity.** Branded `EntryKey` helpers in `fileIO.ts`;
`fileSlug`→`entryKey` rename (own commit); `FileMetadata.vaultId`/`fileSlug` + `updateRoot`
carry-forward; per-vault wikilink and backlink resolution; readable ids for new vaults;
`/entry/$vault/$slug` with a redirect from the old URL; favourites migrated to keys. Still one
vault registered, so the only visible change is the URL shape.

**PR 2 — Several vaults, registered and synced.** `storage/backends.ts` registry; per-vault
sync state and the serial oldest-first scheduler; layered store + `getVaultLayer`;
`defaultVaultId` replacing `activeVaultId`, shown via the new-entry vault chip; the nested
**Calendars & people** filter with hidden-semantics migration; the sidebar's per-vault list
**removed**, its status folded into a per-vault `SyncButton` popover; new-entry vault chip;
Tutorial auto-hidden and `CoachTour` re-gated; source chip on `OccurrenceCard`. **The big one** —
the filter ships with it rather than after, because without it a real vault and the Tutorial
vault would share one agenda.

**PR 3 — iCal vault kind.** ICS parser, RRULE mapping, synthesis, worker proxy, `IcalBackend`,
wizard source card with a validate-and-preview URL step, registry wiring, settings detail row,
`runSync` read-only pull path.

**PR 4 — Plain read-only entry view.** `useEntryAccess`, `EntryReadonlyView`, `EntryBody`
`readOnly` prop, route + topbar branching — scoped to `read-only` mode (iCal) only. The Tutorial
vault's existing `EntryEditor`-with-banner behavior is untouched, so this PR carries no
regression risk for onboarding.

**PR 5 — Move entries between vaults.** `moveEntity` on the port, `storage/moveEntry.ts` with
the write-before-delete ordering, slug-collision allocation, the link-breakage confirm dialog,
favourites migration, and the editor vault chip becoming a picker.

**PR 6 — Vault names and settings scope restructure.** `renameVault`, the Name field, the
General/Vaults regions with scope captions.

> **Branch:** PR 0 lands on the assigned branch `claude/ical-vault-type-edl9cm`. PRs 1–6 need
> their own branches — I'll confirm naming with you before creating them rather than pushing to
> anything unassigned.

> **Risk:** PR 2 is the largest and touches the durability layer. Mitigation: PR 0 removes most
> of its mechanical content; the existing suites (`storage/__tests__/sync.test.ts`,
> `reconcile.test.ts`, `sync-collision.test.ts`, `vaultRegistry.test.ts`, and `cache.test.ts`,
> which runs real Dexie against `fake-indexeddb`) are extended rather than replaced; and the
> Dexie schema is unchanged — `files` is already keyed `${vaultId}::${path}`.

---

## Verification

**Automated** — `pnpm run build` (never `tsc --noEmit`), then tests, then lint *after*
generating types per CLAUDE.md:

```bash
pnpm run build
pnpm --filter meridian-oauth-worker run cf-typegen
pnpm run lint && pnpm test
```

- **PR 0** — the whole existing suite passes untouched. That is the acceptance criterion; any
  test that needs editing means the refactor changed behaviour.
- **Identity** — round-trip `entryKey`/`parseEntryKey`; the same slug in two vaults stays two
  distinct entries; `updateRoot` preserves `vaultId`/`fileSlug`; `roundTripLoss` stays empty
  (the new fields must never reach YAML); `newVaultId` uniquifies and never collides with
  `example`. A type-level test that a bare `string` is rejected where `EntryKey` is required.
- **Wikilinks** — the same bare slug in two vaults resolves to the linking file's own vault;
  backlinks never cross a vault boundary.
- **Multi-vault** — two layers merge and unmerge; `mergeChangedIntoStore` leaves the other
  layer untouched; `writeEntityToCache` refuses an unregistered or read-only vault; two vaults
  keep independent backoff and dirty counts; the scheduler honours per-vault minimum intervals
  and never runs two cycles at once (extends `storage/__tests__/sync.test.ts`).
- **Filter** — hidden-semantics migration from the old inclusive `participantFilter`; a person
  hidden in one vault stays visible in another; a newly appearing attendee and a newly added
  vault are visible by default; `filterOccs` stays referentially stable when nothing changed
  (guards the `agendaSections` cache).
- **Move** — target edit is durable before the source tombstone (assert Dexie ordering with
  `fake-indexeddb`); a mid-move failure leaves the entry in the source, never lost; slug
  collision in the target allocates a free slug; favourites migrate; the confirm dialog's
  inbound/outbound counts match `backlinks` and the file's parsed links.
- **ICS** — line unfolding at 75 octets; escaped commas/semicolons in `SUMMARY`; `DTSTART` in
  DATE / DATE-TIME / `Z` / `TZID=` forms; `X-WR-CALNAME`; `STATUS:CANCELLED`; multi-`ATTENDEE`
  with and without `CN`; CRLF and bare-LF; a truncated document. RRULE: daily/weekly/monthly/
  yearly, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `UNTIL` vs `COUNT`, and an unrepresentable rule
  proving the bounded-expansion fallback. **Re-parsing an unchanged feed yields byte-identical
  slugs** — the deterministic-id guarantee, pinned. Golden snapshot over real Google and
  Outlook exports, asserting the emitted markdown parses through `parseToStoreItems` with no
  `roundTripLoss`.
- **Worker** — SSRF rejection of private/loopback hosts, size cap, `webcal:` rewrite, ETag
  passthrough, CORS headers.
- **Coverage** — `vitest.config.ts` enforces a global floor (statements 57 / branches 54 /
  functions 48 / lines 59) that catches a large unexercised module, so the ICS parser needs
  real tests, not smoke tests. Add per-file floors for `storage/ical/*` once measured.

**Manual** (per CLAUDE.md I won't start the dev server and drive it myself unless you ask):

1. `pnpm dev`, open `http://localhost:5173/meridian/`.
2. Settings → add a second vault. Both appear in the vault picker with their own sync status
   in `SyncButton`'s popover — the sidebar has no separate vault list. Both sets of entries
   appear in the agenda, each with a source chip. Tutorial is hidden automatically. The new
   vault's entry URLs read `/entry/<name>/<slug>`.
3. Filter (topbar): vault rows expand to the people in that vault. Hide Alice under Work — her
   Personal entries stay. Hide a whole vault: it disappears from agenda, month, week, day,
   Backlog and Notes, while `SyncButton` keeps showing it syncing — the mount/view distinction
   made visible. Both survive a reload.
4. Create an entry: it lands in the default vault. Create another, switching the vault chip
   first: it lands in the other. Both save and sync independently.
5. Open an entry, use the vault chip to move it. The dialog names how many links will break;
   after the move the entry opens under its new URL, the old vault no longer lists it, and the
   previously-linking entries show broken links.
6. Settings → Add vault → Calendar subscription → paste a Google/Outlook "secret iCal address".
   The preview shows the calendar name and event count before you commit.
7. Open a subscription event: plain view, no type toggle, no property chips, no delete, body
   rendered read-only. Open one of your own: fully editable, unchanged.
8. Rename a vault: the filter, `SyncButton` popover and chips all follow; an entry URL
   bookmarked before the rename still opens (and still carries the original name — expected).
9. Go offline and reload: every registered vault still renders from the Dexie cache.
10. Remove the subscription: its entries disappear and its cache rows are dropped
    (`cacheDeleteAll`).

**Worker deploy:** `/ical` only exists once `worker/` is deployed
(`pnpm --filter meridian-oauth-worker run deploy`). Until then the wizard fails at the fetch
step against production; locally, `wrangler dev` plus a pointed `WORKER_ORIGIN` covers it.
