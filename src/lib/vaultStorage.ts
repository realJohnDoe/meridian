/**
 * Helpers for per-vault localStorage persistence.
 *
 * Key convention: `${keyPrefix}_${vaultId}` — callers pass the prefix
 * (e.g. `'meridian_favorites'`) and the vault id separately so the
 * storage key is assembled in one place.
 */

export function readVaultStringArray(keyPrefix: string, vaultId: string): string[] {
  try {
    const raw = localStorage.getItem(`${keyPrefix}_${vaultId}`)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function writeVaultJSON(keyPrefix: string, vaultId: string, value: unknown): void {
  localStorage.setItem(`${keyPrefix}_${vaultId}`, JSON.stringify(value))
}

export function readVaultJSON<T>(keyPrefix: string, vaultId: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(`${keyPrefix}_${vaultId}`)
    return raw === null ? defaultValue : (JSON.parse(raw) as T)
  } catch {
    return defaultValue
  }
}
