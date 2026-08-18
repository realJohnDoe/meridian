import { cacheInit } from './db'

// Per-vault secrets and OS handles, keyed in the `meta` table. Everything
// here is credential-shaped: the FS directory handle that grants disk access,
// the GitHub access token, and (OAuth-managed vaults only) the refresh token
// and its expiry.

// ── Per-vault handle persistence ──────────────────────────────

export async function handleSave(vaultId: string, h: FileSystemDirectoryHandle): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `handle:${vaultId}`, value: h })
}

export async function handleLoad(vaultId: string): Promise<FileSystemDirectoryHandle | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`handle:${vaultId}`)
  const v = record?.value
  return (v instanceof FileSystemDirectoryHandle) ? v : null
}

export async function handleClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`handle:${vaultId}`)
}

// ── Per-vault token persistence ───────────────────────────────

export async function tokenSave(vaultId: string, token: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `token:${vaultId}`, value: token })
}

export async function tokenLoad(vaultId: string): Promise<string | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`token:${vaultId}`)
  const v = record?.value
  return typeof v === 'string' ? v : null
}

export async function tokenClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`token:${vaultId}`)
}

// ── Per-vault OAuth refresh-token + expiry ─────────────────────
// Every GitHub vault created via the app's "Sign in with GitHub" flow has
// one; its absence marks a token saved before that flow existed.

export async function refreshTokenSave(vaultId: string, refreshToken: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `refreshToken:${vaultId}`, value: refreshToken })
}

export async function refreshTokenLoad(vaultId: string): Promise<string | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`refreshToken:${vaultId}`)
  const v = record?.value
  return typeof v === 'string' ? v : null
}

export async function refreshTokenClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`refreshToken:${vaultId}`)
}

export async function tokenExpirySave(vaultId: string, expiresAt: number): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: `tokenExpiry:${vaultId}`, value: expiresAt })
}

export async function tokenExpiryLoad(vaultId: string): Promise<number | null> {
  const d = await cacheInit()
  const record = await d.meta.get(`tokenExpiry:${vaultId}`)
  const v = record?.value
  return typeof v === 'number' ? v : null
}

export async function tokenExpiryClear(vaultId: string): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete(`tokenExpiry:${vaultId}`)
}

// ── Atomic credential write ────────────────────────────────────
// Writes the access token, refresh token, and expiry in a single Dexie
// transaction, so a tab killed mid-write can never leave a new access token
// beside a dead refresh token (the three individual setters above do not
// give that guarantee).

export async function credentialsSave(
  vaultId: string,
  c: { accessToken: string; refreshToken: string; expiresAt: number },
): Promise<void> {
  const d = await cacheInit()
  await d.meta.bulkPut([
    { key: `token:${vaultId}`, value: c.accessToken },
    { key: `refreshToken:${vaultId}`, value: c.refreshToken },
    { key: `tokenExpiry:${vaultId}`, value: c.expiresAt },
  ])
}
