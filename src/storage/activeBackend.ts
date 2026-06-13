import type { StorageBackend } from './backend'

let _activeBackend: StorageBackend | null = null

export function getActiveBackend(): StorageBackend | null {
  return _activeBackend
}

export function setActiveBackend(backend: StorageBackend | null): void {
  _activeBackend = backend
}
