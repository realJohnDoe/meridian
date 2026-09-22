/**
 * Moving a calendar in, as opposed to subscribing to one.
 *
 * A subscription (`icalBackend.ts`) re-synthesizes its entries from the feed on
 * every refresh: they live in memory, are `readOnly`, and vanish with the vault.
 * An import runs the same converter once and then lets go — the entries land in
 * a writable vault as ordinary `.md` files and are the user's from that moment,
 * editable, linkable, and outliving the calendar they came from.
 *
 * Two things follow from "yours from that moment", and they are what this file
 * is for:
 *
 * - **Readable filenames.** `icsToEntries` slugs by a hash of the event's UID
 *   because for a subscription the UID *is* the identity and a re-fetch must be
 *   byte-identical. An imported entry has no such obligation, so it takes the
 *   name the editor would have given it — `titleToSlug`. The converter is left
 *   alone; the re-slug happens here, where subscriptions can't see it.
 * - **Idempotence on re-import.** With the filename no longer derived from the
 *   UID, something else has to recognise an event that is already here. The UID
 *   is still in the frontmatter (`extras.uid`, round-tripped like any unknown
 *   key), so it is the match key: a second import of the same calendar updates
 *   N entries instead of creating N more.
 *
 * Planning and committing are deliberately separate calls (see
 * `planEntryImport`) so the confirm dialog and the import itself cannot
 * disagree about what is about to happen.
 *
 * Two front doors reach that one planner. `planIcsImport` reads a `.ics`
 * document; `vaultImportCandidates` reads a subscription already mounted in the
 * store, which is how "stop subscribing to this calendar and keep it" works.
 * They converge deliberately: the re-slug and the UID dedupe are the same
 * decisions whichever way an event arrives, and a second definition of either
 * is a second thing to keep true.
 */
import { freeEntryKey, parseToStoreItems, serializeEntry } from '@/model'
import type { StoreData } from '@/model'
import { titleToSlug, keyToPath } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { getVaultLayer, getSlugSnapshot } from '@/storeBridge'
import type { Entry } from '@/types'
import { icsToEntries } from './icsToEntries'

/**
 * One event on its way into a vault, whatever it came from.
 *
 * The planner needs exactly three things — a name to slug, an identity to
 * dedupe on, and the bytes — so it asks for those rather than for a
 * `SynthesizedEntry` (which satisfies this structurally) or an `Entry`. That is
 * what lets a file, and a subscription already sitting in the store, arrive at
 * the same place: see `planIcsImport` and `vaultImportCandidates`.
 */
export interface ImportCandidate {
  title:   string
  uid:     string
  content: string
}

/** What an import would do, in the terms the confirm dialog states it in. */
export interface IcsImportPlan {
  /** Events with no entry in the target vault yet — new files. */
  added:   number
  /** Entries a previous import of the same event made, which this one overwrites. */
  updated: number
  /** The store as it will be, ready for `commitNext`. */
  next:    StoreData
  /** Every key `next` touches — `commitNext`'s second argument. */
  keys:    EntryKey[]
}

/**
 * The `uid` a previous import left on this entry, if any.
 *
 * Both halves are checked because which one holds an unknown frontmatter key
 * depends on the file's shape: a root that is itself an item carries its own
 * keys on that item's metadata, while a pure container root hands them to
 * `FileMetadata` (see `model/storeItems.ts`). Every file `icsToEntries` emits is
 * the first kind today, but reading only that half would make the dedupe
 * quietly shape-dependent.
 */
function entryUid(entry: Entry): string | undefined {
  const root = entry.root.extra?.['uid']
  if (typeof root === 'string') return root
  for (const item of entry.items) {
    const own = item.metadata.extra?.['uid']
    if (typeof own === 'string') return own
  }
  return undefined
}

/** `uid` → the entry already holding that event, for everything in `vaultId`. */
function importedUids(vaultId: string): Map<string, EntryKey> {
  const byUid = new Map<string, EntryKey>()
  for (const entry of getVaultLayer(vaultId).values()) {
    const uid = entryUid(entry)
    // First wins: two entries claiming one UID is a vault someone hand-edited,
    // and picking by iteration order at least picks the same one every time.
    if (uid !== undefined && !byUid.has(uid)) byUid.set(uid, entry.key)
  }
  return byUid
}

/**
 * Every event a subscription is currently showing, ready to be imported.
 *
 * Read out of the **store**, not re-fetched: the entries are already there
 * (an iCal vault's layer is built by `parseFiles` like any other vault's), and
 * taking them from there means the user moves in exactly what they were
 * looking at when they decided to. A re-fetch would import a feed that may have
 * changed since, and would need a network path and its own failure modes to do
 * it.
 *
 * `serializeEntry` is the same call the write path makes, so the bytes are the
 * ones a save would have produced — which is why re-parsing them at the target
 * key below is sound rather than merely convenient: it re-keys every item's
 * `vaultId`/`fileSlug` by construction instead of by hand.
 *
 * An entry with no `uid` is skipped. Everything `icsToEntries` emits carries
 * one, so in practice this only drops a file someone hand-edited into the
 * vault — and without an identity there is nothing to dedupe a second run on.
 */
export function vaultImportCandidates(fromVaultId: string): ImportCandidate[] {
  const out: ImportCandidate[] = []
  for (const entry of getVaultLayer(fromVaultId).values()) {
    const uid = entryUid(entry)
    if (uid === undefined) continue
    out.push({ title: entry.root.title, uid, content: serializeEntry(entry.items, entry.root) })
  }
  return out
}

/**
 * Work out an import in full without performing any of it.
 *
 * Nothing is committed and nothing is written, so a caller may plan purely to
 * show the user what they are about to agree to, and plan again to do it. That
 * second plan is what commits: re-planning against a fresh snapshot costs one
 * more parse and means a sync that landed while the dialog was open is not
 * silently rolled back by a `setData` built before it.
 *
 * The whole plan is assembled before anything leaves this function, so a
 * candidate that fails to parse throws having changed nothing, rather than
 * leaving half a calendar imported.
 */
export function planEntryImport(vaultId: string, candidates: readonly ImportCandidate[]): IcsImportPlan {
  const byUid = importedUids(vaultId)
  // Copied so the accumulating plan can be mutated in place: `freeEntryKey`
  // reads `next.entries`, which is how each allocation sees the ones before it
  // and two events with the same title get `-2` rather than one file.
  const snapshot = getSlugSnapshot()
  const entries = new Map(snapshot.entries)
  const next: StoreData = { ...snapshot, entries }

  const keys: EntryKey[] = []
  let added = 0
  let updated = 0
  for (const event of candidates) {
    const existing = byUid.get(event.uid)
    const key = existing ?? freeEntryKey(next, vaultId, titleToSlug(event.title))
    entries.set(key, parseToStoreItems(keyToPath(key), event.content, vaultId))
    keys.push(key)
    if (existing) updated++
    else added++
  }
  return { added, updated, next, keys }
}

/**
 * The same import, from a `.ics` document.
 *
 * Returns `null` when the text is not a calendar at all — the same answer
 * `icsToEntries` gives, and the same failure the subscription wizard turns into
 * "that doesn't look like a calendar".
 */
export function planIcsImport(vaultId: string, text: string): IcsImportPlan | null {
  const synthesis = icsToEntries(text)
  // `SynthesizedEntry` satisfies `ImportCandidate`; its `fileSlug` is the one
  // thing the planner deliberately does not take, since re-slugging is the
  // point (see this file's header).
  return synthesis && planEntryImport(vaultId, synthesis.entries)
}
