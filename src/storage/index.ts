// Register the storage adapter for the core persistence port once on first import.
import { setEntityPersistence } from '../persistencePort'
import { writeEntityToCache, deleteFromBackend } from './sync'
import { moveEntityInCache } from './moveEntry'
setEntityPersistence({
  writeEntity: (key, content) => { void writeEntityToCache(key, content) },
  deleteEntity: key => { void deleteFromBackend(key) },
  moveEntity: (fromKey, toKey, content) => { void moveEntityInCache(fromKey, toKey, content) },
})

export {
  restoreVaults, setDefaultVault, reconnectVault,
  addLocalVault, addGitHubVaultOAuth, reauthGitHubVault, addIcalVault, addExampleVault, removeVault, renameVault, onVaultChanged,
} from './vaultRegistry'

export { previewIcalFeed } from './icalBackend'
export { entriesToIcs } from './ical/entriesToIcs'

export { isFolderPickerSupported } from './fs'

export { syncToBackend, autoSyncTick, resetSyncBackoff, flushPendingPush } from './sync'

export { cacheDirtyCount } from './cache/files'

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
} from './githubOAuth'
export type { OAuthTokens, InstalledRepo } from './githubOAuth'

export type { VaultRef } from '@/vaultRef'
