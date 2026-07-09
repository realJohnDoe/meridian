// Register the storage adapter for the core persistence port once on first import.
import { setEntityPersistence } from '../persistencePort'
import { writeEntityToCache, deleteFromBackend } from './sync'
setEntityPersistence({
  writeEntity: slug => { void writeEntityToCache(slug) },
  deleteEntity: slug => { void deleteFromBackend(slug) },
})

export { restoreVaults, setActiveVault, addLocalVault, addGitHubVault, addGitHubVaultOAuth, removeVault, onVaultChanged } from './vaultRegistry'

export { syncToBackend, autoSyncTick, resetSyncBackoff } from './sync'

export { tokenSave } from './cache'

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
} from './githubOAuth'
export type { OAuthTokens, InstalledRepo } from './githubOAuth'

export type { VaultRef } from '@/types'
