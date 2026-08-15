import type { EntryKey } from './fileIO'

export interface EntityPersistence {
  writeEntity(key: EntryKey): void
  deleteEntity(key: EntryKey): void
  /**
   * Cross-vault move. One call rather than a write plus a delete at the call
   * site, so the durability ordering — the target's content durable *before*
   * the source's tombstone — lives in one place and cannot be got wrong by a
   * caller that happens to issue the two in the other order.
   */
  moveEntity(fromKey: EntryKey, toKey: EntryKey): void
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

export function writeEntity(key: EntryKey): void {
  requireImpl().writeEntity(key)
}

export function deleteEntity(key: EntryKey): void {
  requireImpl().deleteEntity(key)
}

export function moveEntity(fromKey: EntryKey, toKey: EntryKey): void {
  requireImpl().moveEntity(fromKey, toKey)
}
