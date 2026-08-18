import { setData } from './storeBridge'
import { writeEntity, deleteEntity, moveEntity } from './persistencePort'
import { entryKeyItems, serializeEntry } from '@/model'
import type { StoreData } from '@/model'
import type { EntryKey } from './fileIO'

/**
 * One entry's file content as of `data`, or null when `data` no longer holds
 * that entry at all.
 *
 * Null is the delete signal, and it is deliberately narrow: an entry with a
 * root but no occurrences is still an entry (its file-level fields are what is
 * left of it) and serializes fine. Only a key with neither is gone.
 */
function entryContent(data: StoreData, key: EntryKey): string | null {
  const items = entryKeyItems(data.items, key)
  const root  = data.roots.get(key)
  if (items.length === 0 && !root) return null
  return serializeEntry(items, root)
}

/**
 * Persist each of `keys` from `data` — its file when the entry is there, a
 * delete when it is not.
 *
 * Exported for the deferred commits in `occurrenceActions.ts`, which fire from
 * a toast long after their own `setData` and so must serialize against the
 * store as it stands when they run, not as it stood when they were armed.
 */
export function persistEntries(data: StoreData, keys: Iterable<EntryKey>): void {
  for (const key of keys) {
    const content = entryContent(data, key)
    if (content === null) deleteEntity(key)
    else writeEntity(key, content)
  }
}

/** Commit to store and persist every listed entry. */
export function commitNext(next: StoreData, keys: EntryKey[]): void {
  setData(next)
  persistEntries(next, keys)
}

/** Commit to store, persist the backlink-edited entries, and delete the primary from its backend. */
export function commitDelete(next: StoreData, key: EntryKey, backlinkKeys: Iterable<EntryKey>): void {
  setData(next)
  persistEntries(next, backlinkKeys)
  deleteEntity(key)
}

/**
 * Commit a cross-vault move: the re-keyed store first, then the durable
 * two-vault write through the port.
 *
 * No backlink keys, unlike `commitDelete` — a move deliberately edits no other
 * file (see `moveEntryKey`), so the only files that change are the two the port
 * writes.
 *
 * The content is taken from `next` at the *target* key, because that is where
 * the re-key has already put the entry. Nothing there means the caller built
 * `next` wrong: writing an empty file over the target and then tombstoning the
 * source would destroy the entry outright, so the whole move is refused —
 * including the store commit, which is why the check comes first.
 */
export function commitMove(next: StoreData, fromKey: EntryKey, toKey: EntryKey): void {
  const content = entryContent(next, toKey)
  if (content === null) return
  setData(next)
  moveEntity(fromKey, toKey, content)
}
