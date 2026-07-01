// Register the storage adapter for the core persistence port once on first import.
import { setEntityPersistence } from '../persistencePort'
import { writeEntityToCache, deleteFromBackend } from './sync'
setEntityPersistence({ writeEntity: writeEntityToCache, deleteEntity: deleteFromBackend })

export { restoreVaults, setActiveVault, addLocalVault, addGitHubVault, addGitHubVaultOAuth, removeVault, onVaultChanged } from './vaultRegistry'
export type { GitHubVaultConfig, GitHubOAuthVaultConfig } from './vaultRegistry'

export { syncToBackend, autoSyncTick, resetSyncBackoff, writeEntityToCache, deleteFromBackend } from './sync'

export { tokenSave } from './cache'

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
} from './githubOAuth'
export type { OAuthTokens, InstalledRepo } from './githubOAuth'

export { ConflictError, TransientSyncError, AuthSyncError, isTransientSyncError } from './conflictError'

export type { VaultRef, VaultKind, StorageBackend, RawFile, LocalVaultRef, ExampleVaultRef, GitHubVaultRef } from './backend'
