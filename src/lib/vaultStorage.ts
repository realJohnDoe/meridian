/**
 * Helpers for per-vault localStorage persistence.
 *
 * Key convention: `${keyPrefix}_${vaultId}` — callers pass the prefix
 * (e.g. `'meridian_favorites'`) and the vault id separately so the
 * storage key is assembled in one place.
 */

function vaultKey(keyPrefix: string, vaultId: string): string {
  return `${keyPrefix}_${vaultId}`
}

export function readVaultStringArray(keyPrefix: string, vaultId: string): string[] {
  try {
    const raw = localStorage.getItem(vaultKey(keyPrefix, vaultId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function writeVaultJSON(keyPrefix: string, vaultId: string, value: unknown): void {
  localStorage.setItem(vaultKey(keyPrefix, vaultId), JSON.stringify(value))
}

export function readVaultJSON<T>(keyPrefix: string, vaultId: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(vaultKey(keyPrefix, vaultId))
    return raw === null ? defaultValue : (JSON.parse(raw) as T)
  } catch {
    return defaultValue
  }
}
