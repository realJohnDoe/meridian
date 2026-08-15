import { setData } from './storeBridge'
import { writeEntity, deleteEntity, moveEntity } from './persistencePort'
import type { StoreData } from '@/model'
import type { EntryKey } from './fileIO'

/** Commit to store and persist every listed entry. */
export function commitNext(next: StoreData, keys: EntryKey[]): void {
  setData(next)
  keys.forEach(writeEntity)
}

/** Commit to store, persist the backlink-edited entries, and delete the primary from its backend. */
export function commitDelete(next: StoreData, key: EntryKey, backlinkKeys: Iterable<EntryKey>): void {
  setData(next)
  for (const k of backlinkKeys) writeEntity(k)
  deleteEntity(key)
}

/**
 * Commit a cross-vault move: the re-keyed store first, then the durable
 * two-vault write through the port.
 *
 * No backlink keys, unlike `commitDelete` — a move deliberately edits no other
 * file (see `moveEntryKey`), so the only files that change are the two the port
 * writes. The store write must land first regardless: the port reads the
 * *target* vault's layer to serialize the content it makes durable.
 */
export function commitMove(next: StoreData, fromKey: EntryKey, toKey: EntryKey): void {
  setData(next)
  moveEntity(fromKey, toKey)
}
