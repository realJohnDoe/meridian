import type { VaultRef } from '@/vaultRef'
import type { AttentionKind } from '@/store'

/**
 * The one-line subtitle under a vault's name in the settings list.
 *
 * Says what the vault *is* — its kind and where it points — because the list
 * is now the only place all vaults are visible at once, and "which of these
 * two GitHub vaults is the work one?" has to be answerable without opening
 * each. Kept pure and separate from the row so it can be tested directly.
 *
 * `fileCount`, when given, is appended as "N Markdown files" — a size hint
 * (how much is in this vault, at a glance, across all of them) that doubles
 * as the one place this list names the storage format. Omitted for `ical`:
 * a calendar subscription has no backing files to count. See #1083.
 */
export function vaultSummary(vault: VaultRef, fileCount?: number): string {
  const base =
    vault.kind === 'github' ? `${vault.github.owner}/${vault.github.repo} · ${vault.github.branch}` :
    vault.kind === 'ical'   ? 'Calendar subscription · read-only' :
    vault.kind === 'local'  ? 'Folder on this device' :
    'Sample notes · safe to remove'
  if (vault.kind === 'ical' || fileCount === undefined) return base
  return `${base} · ${fileCount} Markdown file${fileCount === 1 ? '' : 's'}`
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
