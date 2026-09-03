export {
  addLocalVault, addGitHubVaultOAuth, reauthGitHubVault, addIcalVault, addExampleVault, removeVault, renameVault,
  setVaultColor, setDefaultVault, reconnectVault, isFolderPickerSupported,
} from '@/storage'
export { previewIcalFeed } from '@/storage'
export type { VaultRef } from '@/storage'
export { syncToBackend, cacheDirtyCount } from '@/storage'

import { entriesToIcs } from '@/storage'
import { useStore, vaultLayer } from '@/store'

/**
 * A vault's entries as a `.ics` document — the sanctioned bridge into
 * `@/storage` for this, since `components/` may not import it directly
 * (invariant 2). See `storage/ical/entriesToIcs.ts` for what does and doesn't
 * survive the trip (no `after_completion` series, floating times only).
 */
export function exportVaultIcs(vaultId: string): string {
  const { entries } = useStore.getState()
  return entriesToIcs([...vaultLayer(entries, vaultId).values()])
}

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
} from '@/storage'
export type { OAuthTokens, InstalledRepo } from '@/storage'
