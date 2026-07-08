export { addLocalVault, addGitHubVault, addGitHubVaultOAuth, removeVault, setActiveVault } from '@/storage'
export type { VaultRef } from '@/storage'
export { syncToBackend, tokenSave } from '@/storage'

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
} from '@/storage'
export type { OAuthTokens, InstalledRepo } from '@/storage'
