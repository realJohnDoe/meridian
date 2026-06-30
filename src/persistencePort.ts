export interface EntityPersistence {
  writeEntity(slug: string): void
  deleteEntity(slug: string): void
}

let _impl: EntityPersistence | null = null

export function setEntityPersistence(impl: EntityPersistence): void {
  _impl = impl
}

export function writeEntity(slug: string): void {
  _impl?.writeEntity(slug)
}

export function deleteEntity(slug: string): void {
  _impl?.deleteEntity(slug)
}
