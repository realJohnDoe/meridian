import type { EntryKey } from './fileIO'

/**
 * How the core makes an entry durable, without knowing what "durable" means.
 *
 * **A write carries the entry's content, not just its key.** The storage
 * adapter used to be handed a key alone and left to resolve the content out of
 * the live store for itself — which meant the two sides could disagree about
 * what that key held, and the adapter had no way to tell a genuine change from
 * a store it was reading at the wrong moment. It guessed, with a branch that
 * skipped the write when the entry "looked" incomplete; nothing ever came back
 * to write it, and the entry was lost. Passing the bytes removes the lookup,
 * the guess, and the branch: the adapter's whole job is to make what it was
 * given durable at the key it was given.
 *
 * It also puts the decision that needs the data next to the data. "Is this a
 * write or a delete?" is answered by the committing layer, which is holding the
 * store state that answers it, rather than inferred downstream from an absence.
 */
export interface EntityPersistence {
  /** Make `content` durable as `key`'s file. */
  writeEntity(key: EntryKey, content: string): void
  deleteEntity(key: EntryKey): void
  /**
   * Cross-vault move. One call rather than a write plus a delete at the call
   * site, so the durability ordering — the target's content durable *before*
   * the source's tombstone — lives in one place and cannot be got wrong by a
   * caller that happens to issue the two in the other order. `content` is the
   * entry as it will exist at `toKey`.
   */
  moveEntity(fromKey: EntryKey, toKey: EntryKey, content: string): void
}

let _impl: EntityPersistence | null = null

export function setEntityPersistence(impl: EntityPersistence): void {
  _impl = impl
}

function requireImpl(): EntityPersistence {
  if (!_impl) {
    throw new Error('persistencePort: no EntityPersistence registered — call setEntityPersistence() first')
  }
  return _impl
}

export function writeEntity(key: EntryKey, content: string): void {
  requireImpl().writeEntity(key, content)
}

export function deleteEntity(key: EntryKey): void {
  requireImpl().deleteEntity(key)
}

export function moveEntity(fromKey: EntryKey, toKey: EntryKey, content: string): void {
  requireImpl().moveEntity(fromKey, toKey, content)
}
