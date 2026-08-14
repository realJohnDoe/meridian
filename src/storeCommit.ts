import { setData } from './storeBridge'
import { writeEntity, deleteEntity } from './persistencePort'
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
