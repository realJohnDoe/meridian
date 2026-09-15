export {
  addLocalVault, addGitHubVaultOAuth, reauthGitHubVault, addIcalVault, addExampleVault, removeVault, renameVault,
  setVaultColor, setVaultRetentionDays, setDefaultVault, reconnectVault, isFolderPickerSupported,
} from '@/storage'
export { previewIcalFeed } from '@/storage'
export type { VaultRef } from '@/storage'
export { syncToBackend, cacheDirtyCount } from '@/storage'

import type { VaultRef } from '@/storage'
import { entriesToIcs } from '@/storage'
import { useStore, vaultLayer } from '@/store'

/**
 * The one ordering for a list of vaults, shared so Settings' vault list and
 * the topbar view filter's calendar tree never drift apart the way they used
 * to (alphabetical in one, registration order in the other).
 */
export function sortVaults(vaults: VaultRef[]): VaultRef[] {
  return [...vaults].sort((a, b) => a.name.localeCompare(b.name))
}

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
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos, findReusableGitHubSession,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL, APP_URL,
} from '@/storage'
export type { OAuthTokens, InstalledRepo, ReusableGitHubSession } from '@/storage'
