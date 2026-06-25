export { restoreVaults, setActiveVault, addLocalVault, addGitHubVault, removeVault, onVaultChanged } from './vaultRegistry'
export type { GitHubVaultConfig } from './vaultRegistry'

export { syncToBackend, autoSyncTick, resetSyncBackoff, writeEntityToCache, deleteFromBackend } from './sync'

export { tokenSave } from './cache'

export { ConflictError, TransientSyncError, AuthSyncError, isTransientSyncError } from './conflictError'

export type { VaultRef, VaultKind, StorageBackend, RawFile, LocalVaultRef, ExampleVaultRef, GitHubVaultRef } from './backend'
