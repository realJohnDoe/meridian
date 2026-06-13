/** Thrown by StorageBackend.write when the CAS precondition fails. */
export class ConflictError extends Error {
  constructor(path: string) {
    super(`Conflict on ${path}: backend version diverged since last sync.`)
    this.name = 'ConflictError'
  }
}
