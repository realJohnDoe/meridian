import type { EntryKey } from './fileIO'

export interface EntityPersistence {
  writeEntity(key: EntryKey): void
  deleteEntity(key: EntryKey): void
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
