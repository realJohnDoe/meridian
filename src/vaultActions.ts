export {
  addLocalVault, addGitHubVaultOAuth, addIcalVault, removeVault, renameVault,
  setDefaultVault, reconnectVault, isFolderPickerSupported,
} from '@/storage'
export { previewIcalFeed } from '@/storage'
export type { VaultRef } from '@/storage'
export { syncToBackend, cacheDirtyCount } from '@/storage'

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
} from '@/storage'
export type { OAuthTokens, InstalledRepo } from '@/storage'
