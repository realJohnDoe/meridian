export interface EntityPersistence {
  writeEntity(slug: string): void
  deleteEntity(slug: string): void
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

export function writeEntity(slug: string): void {
  requireImpl().writeEntity(slug)
}

export function deleteEntity(slug: string): void {
  requireImpl().deleteEntity(slug)
}
