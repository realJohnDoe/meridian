export {
  addLocalVault, addGitHubVaultOAuth, reauthGitHubVault, addIcalVault, addExampleVault, removeVault, renameVault,
  setVaultColor, setVaultRetentionDays, setDefaultVault, reconnectVault, isFolderPickerSupported,
} from '@/storage'
export { previewIcalFeed } from '@/storage'
export type { VaultRef } from '@/storage'
export { syncToBackend, cacheDirtyCount } from '@/storage'

import type { VaultRef } from '@/storage'
import { entriesToIcs, planIcsImport, planEntryImport, vaultImportCandidates } from '@/storage'
import { commitNext } from '@/storeCommit'
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

/** What importing a `.ics` file into a vault would do — see `previewVaultIcsImport`. */
export interface IcsImportSummary {
  added:   number
  updated: number
}

/**
 * What `importVaultIcs` would do to `vaultId`, without doing any of it. `null`
 * when the text isn't a calendar.
 *
 * The counts are the whole point: an `.ics` file says nothing about its size or
 * its contents from the outside, and `updated` is an overwrite of entries the
 * user may since have edited. Both are things to agree to before the write, not
 * to discover after it.
 */
export function previewVaultIcsImport(vaultId: string, text: string): IcsImportSummary | null {
  const plan = planIcsImport(vaultId, text)
  return plan && { added: plan.added, updated: plan.updated }
}

/**
 * Import a `.ics` file's events into `vaultId` as ordinary, editable entries.
 * `null` when the text isn't a calendar.
 *
 * Re-plans rather than taking a plan from `previewVaultIcsImport`, so the
 * commit is built against the store as it is now — see `planIcsImport`.
 */
export function importVaultIcs(vaultId: string, text: string): IcsImportSummary | null {
  const plan = planIcsImport(vaultId, text)
  if (!plan) return null
  commitNext(plan.next, plan.keys)
  return { added: plan.added, updated: plan.updated }
}

/**
 * What moving `fromVaultId`'s events into `toVaultId` would do, without doing
 * any of it — the subscription half of the same import.
 *
 * Separate from `previewVaultIcsImport` only in where the events come from: a
 * mounted subscription rather than a file the user picked. Both end at
 * `planEntryImport`.
 */
export function previewVaultCopy(fromVaultId: string, toVaultId: string): IcsImportSummary {
  const { added, updated } = planEntryImport(toVaultId, vaultImportCandidates(fromVaultId))
  return { added, updated }
}

/**
 * Move a subscription's events into a writable vault, where they become
 * ordinary editable entries.
 *
 * Re-reads and re-plans rather than taking a plan from `previewVaultCopy`, for
 * the same reason `importVaultIcs` does: the commit is built against the store
 * as it is now. That matters more here than for a file — a subscription
 * refreshes on a timer, so its layer really can change while the dialog is up.
 *
 * Removing the subscription afterwards is the caller's call, not this one's: it
 * is a separate durable act, and `removeVault` already owns what it means.
 */
export function copyVaultInto(fromVaultId: string, toVaultId: string): IcsImportSummary {
  const plan = planEntryImport(toVaultId, vaultImportCandidates(fromVaultId))
  commitNext(plan.next, plan.keys)
  return { added: plan.added, updated: plan.updated }
}

export {
  startGitHubSignIn, completeGitHubSignIn, fetchInstalledRepos, findReusableGitHubSession,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL, APP_URL,
} from '@/storage'
export type { OAuthTokens, InstalledRepo, ReusableGitHubSession } from '@/storage'
