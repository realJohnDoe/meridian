import type { VaultRef } from '@/vaultRef'
import type { AttentionKind } from '@/store'

/**
 * The one-line subtitle under a vault's name in the settings list.
 *
 * Says what the vault *is* — its kind and where it points — because the list
 * is now the only place all vaults are visible at once, and "which of these
 * two GitHub vaults is the work one?" has to be answerable without opening
 * each. Kept pure and separate from the row so it can be tested directly.
 */
export function vaultSummary(vault: VaultRef): string {
  if (vault.kind === 'github') return `${vault.github.owner}/${vault.github.repo} · ${vault.github.branch}`
  if (vault.kind === 'ical')   return 'Calendar subscription · read-only'
  if (vault.kind === 'local')  return 'Folder on this device'
  return 'Sample notes · safe to remove'
}

/**
 * The short status pill for a vault that needs attention.
 *
 * Deliberately terser than `VaultAttention['message']` and than SyncButton's
 * own rows: at list level this is a "something here needs you" marker, and the
 * full explanation plus its fix live one tap away on the vault's own screen.
 */
export function attentionLabel(kind: AttentionKind): string {
  if (kind === 'reauth')        return 'Signed out'
  if (kind === 'access')        return 'No access'
  if (kind === 'fs-permission') return 'Needs permission'
  return 'Unreachable'
}
