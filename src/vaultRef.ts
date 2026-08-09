// ── Vault references ─────────────────────────────────────────────────────────
// A root leaf (not storage/) because @/vaultActions re-exports VaultRef for
// components/, and the import-boundary rule forbids components/ from
// importing @/storage at all — a root leaf keeps that chain intact without
// storeBridge.ts/store.ts acquiring an upward dependency on @/storage.

export type VaultKind = 'local' | 'example' | 'github'

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

export type VaultRef = LocalVaultRef | ExampleVaultRef | GitHubVaultRef
