// ── Vault references ─────────────────────────────────────────────────────────
// A root leaf (not storage/) because @/vaultActions re-exports VaultRef for
// components/, and the import-boundary rule forbids components/ from
// importing @/storage at all — a root leaf keeps that chain intact without
// storeBridge.ts/store.ts acquiring an upward dependency on @/storage.

export type VaultKind = 'local' | 'example' | 'github' | 'ical'

/**
 * The six theme colors a vault may be tagged with, or `undefined` for no
 * color — which leaves the vault chip plain, and (while `colorBy` is
 * `'vault'`) paints the vault's occurrences with the neutral hue. Each value
 * aliases one of the app's existing domain color tokens — see `VAULT_HUE` in
 * `occView.ts`, the one table that says which — rather than introducing a new
 * palette.
 */
export type VaultColor = 'indigo' | 'red' | 'orange' | 'yellow' | 'green' | 'blue'

/** The color picker's options, in display order. */
export const VAULT_COLORS: { value: VaultColor; label: string }[] = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'red',    label: 'Red'    },
  { value: 'orange', label: 'Orange' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green',  label: 'Green'  },
  { value: 'blue',   label: 'Blue'   },
]

interface VaultRefBase {
  id:    string
  name:  string
  color?: VaultColor
}

interface LocalVaultRef extends VaultRefBase {
  kind: 'local'
}

interface ExampleVaultRef extends VaultRefBase {
  kind: 'example'
}

export interface GitHubVaultRef extends VaultRefBase {
  kind:   'github'
  github: { owner: string; repo: string; branch: string }
}

export interface IcalVaultRef extends VaultRefBase {
  kind: 'ical'
  ical: {
    /**
     * The feed's "secret address". Held on the ref rather than in the
     * credentials store because for a subscription the URL is simultaneously
     * the configuration (Settings shows it) and the credential (anyone holding
     * it can read the calendar) — splitting it would give one value two homes.
     * Both live in the same Dexie database with the same protection either way.
     */
    url: string
  }
}

export type VaultRef = LocalVaultRef | ExampleVaultRef | GitHubVaultRef | IcalVaultRef

/**
 * Kinds that accept writes — where a new entry may be created, and the only
 * vaults a move may go between (in either direction).
 *
 * A root leaf rather than a `storage/` helper because `components/` needs the
 * same answer for the editor's vault chip and may not import `@/storage` at
 * all. Keyed off the kind, like `useEntryAccess`, and for the same reason: the
 * question "may this vault receive a file" is answerable from the ref alone,
 * without a mounted backend or a sync-status row.
 */
export function isWritableVault(ref: VaultRef | undefined): boolean {
  return ref?.kind === 'local' || ref?.kind === 'github'
}
