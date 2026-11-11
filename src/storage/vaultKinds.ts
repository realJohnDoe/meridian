import {
  handleLoad, handleClear,
  tokenLoad, refreshTokenLoad, tokenClear, refreshTokenClear, tokenExpiryClear,
} from '@/storage/cache/credentials'
import { clearVaultKey } from '@/lib/vaultStorage'
import { SEEN_SKIPPED_PREFIX } from './icalBackend'
import { LocalBackend } from './localBackend'
import { ensureFreshAccessToken, revokeGitHubToken } from './githubOAuth'
import type { StorageBackend } from './backend'
import type { VaultKind, VaultRef } from '@/vaultRef'

/**
 * Everything `vaultRegistry.ts` does differently per vault kind, in one table.
 *
 * Keyed by every `VaultKind`, so adding a kind fails to compile until its row
 * exists — where a `ref.kind === …` branch would silently fall through to "the
 * other kinds". UI that legitimately looks different per kind still branches
 * on the kind itself; this is only the storage lifecycle.
 */
interface VaultKindOps<R extends VaultRef> {
  /**
   * Persisted and mounted by the registry. Only the synthesized Tutorial vault
   * is not. Deliberately not `isWritableVault`: a calendar subscription is
   * read-only but mounts, caches and syncs exactly like any other vault.
   */
  mountable: boolean
  /** The backend for a persisted ref, from its stored credential; `null` if that credential is missing. */
  build(ref: R): Promise<StorageBackend | null>
  /**
   * Whether a non-interactive restore checks permission before mounting. A
   * network backend has no permission gate, only failures — its first sync IS
   * the probe — so it skips this and lets runSync's retry/backoff take over.
   */
  probesOnRestore: boolean
  /** Drops the vault's credential and any other per-kind state on removal. */
  cleanup(id: string, refs: VaultRef[]): Promise<void>
  /** Notices for a mount that found no credential, or was refused. */
  notices: {
    noCredentialOnRestore(name: string): string
    noCredentialOnReconnect(name: string): string
    denied(name: string): string
  }
}

const NO_CREDENTIAL_NOTICES: VaultKindOps<VaultRef>['notices'] = {
  noCredentialOnRestore:   name => `Vault "${name}" isn't signed in to GitHub — sign in again.`,
  noCredentialOnReconnect: name => `"${name}" isn't signed in to GitHub — sign in again.`,
  denied:                  name => `Could not connect to "${name}" — sign in to GitHub again.`,
}

const VAULT_KINDS: { [K in VaultKind]: VaultKindOps<Extract<VaultRef, { kind: K }>> } = {
  local: {
    mountable: true,
    build: async ref => {
      const handle = await handleLoad(ref.id)
      return handle ? new LocalBackend(ref.id, ref.name, handle) : null
    },
    probesOnRestore: true,
    cleanup: id => handleClear(id),
    notices: {
      noCredentialOnRestore:   name => `Vault "${name}" is missing its folder permission — remove and re-add it.`,
      noCredentialOnReconnect: () => 'Vault handle not found — try removing and re-adding it.',
      denied:                  name => `Permission denied for vault "${name}".`,
    },
  },
  github: {
    mountable: true,
    build: async ref => {
      // A refresh that failed transiently, or a credential GitHub has since
      // refused, still hands back the last known token — the backend is built
      // with it and the first API call becomes the real test, which is where
      // the sync path's classification and recovery already live. Only
      // "nothing stored at all" is a reason not to build one.
      const result = await ensureFreshAccessToken(ref.id)
      if (result.status === 'no-credential') return null
      const { GitHubBackend } = await import('./githubBackend')
      return new GitHubBackend(ref.id, ref.name, { ...ref.github, token: result.token })
    },
    probesOnRestore: false,
    cleanup: async (id, refs) => {
      await revokeUnlessShared(id, refs)
      await tokenClear(id)
      await refreshTokenClear(id)
      await tokenExpiryClear(id)
    },
    notices: NO_CREDENTIAL_NOTICES,
  },
  ical: {
    mountable: true,
    // The feed URL travels on the ref, so a subscription has no credential to
    // be missing — it can always build a backend.
    build: async ref => {
      const { IcalBackend } = await import('./icalBackend')
      return new IcalBackend(ref.id, ref.name, ref.ical.url)
    },
    probesOnRestore: false,
    cleanup: id => Promise.resolve(clearVaultKey(SEEN_SKIPPED_PREFIX, id)),
    notices: NO_CREDENTIAL_NOTICES,
  },
  // Synthesized in memory and never persisted: `vaultRegistry` mounts and
  // removes it on its own path, so none of the lifecycle steps below reach it.
  example: {
    mountable: false,
    build: () => Promise.resolve(null),
    probesOnRestore: false,
    cleanup: () => Promise.resolve(),
    notices: NO_CREDENTIAL_NOTICES,
  },
}

/** The lifecycle descriptor for `ref`'s kind. */
export function vaultKindOps<R extends VaultRef>(ref: R): VaultKindOps<R> {
  // The cast is the one place TypeScript can't correlate `ref.kind` with the
  // row it indexes; the mapped type above already checked each row against
  // its own ref shape.
  return VAULT_KINDS[ref.kind] as unknown as VaultKindOps<R>
}

/**
 * Revokes vault `id`'s GitHub grant, unless another GitHub vault holds the same
 * access or refresh token (`findReusableGitHubSession` copies one sign-in into
 * further vaults) — revoking it would sign those out too. Never throws.
 */
async function revokeUnlessShared(id: string, refs: VaultRef[]): Promise<void> {
  try {
    const [token, refresh] = await Promise.all([tokenLoad(id), refreshTokenLoad(id)])
    if (!token) return
    for (const other of refs) {
      if (other.kind !== 'github' || other.id === id) continue
      const [t, r] = await Promise.all([tokenLoad(other.id), refreshTokenLoad(other.id)])
      if (t === token || (refresh && r === refresh)) return
    }
    await revokeGitHubToken(token)
  } catch (e) {
    console.warn('[vault] could not revoke GitHub token:', e)
  }
}
