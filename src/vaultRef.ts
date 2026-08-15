// ── Vault references ─────────────────────────────────────────────────────────
// A root leaf (not storage/) because @/vaultActions re-exports VaultRef for
// components/, and the import-boundary rule forbids components/ from
// importing @/storage at all — a root leaf keeps that chain intact without
// storeBridge.ts/store.ts acquiring an upward dependency on @/storage.

export type VaultKind = 'local' | 'example' | 'github' | 'ical'

interface VaultRefBase {
  id:   string
  name: string
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
