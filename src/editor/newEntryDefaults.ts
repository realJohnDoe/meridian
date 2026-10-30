import type { Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import { readVaultStringArray, writeVaultJSON } from '@/lib/vaultStorage'

/**
 * Per-vault localStorage key (see `lib/vaultStorage`) for the lists a new entry
 * starts out on — `EntryKey`s of entries in that vault. Not applied when an
 * entry is promoted from a checklist line: that line already sits on a list.
 */
export const DEFAULT_LISTS_KEY = 'meridian_default_lists'

export const storedDefaultLists = (vaultId: string): EntryKey[] =>
  readVaultStringArray(DEFAULT_LISTS_KEY, vaultId) as EntryKey[]

/**
 * A vault's default lists that still exist. A list that was deleted (here or by
 * a sync) simply stops counting; the stale key is dropped from storage the next
 * time the setting is edited.
 */
export function liveDefaultLists(vaultId: string, roots: Roots): EntryKey[] {
  return storedDefaultLists(vaultId).filter((k): k is EntryKey => roots.has(k))
}

/** Per-vault key for the participants a new entry starts out with. Keep byte-identical: it is what existing users' saved defaults sit under. */
export const DEFAULT_PARTICIPANTS_KEY = 'meridian_default_participants'

export const defaultParticipants = (vaultId: string): string[] =>
  readVaultStringArray(DEFAULT_PARTICIPANTS_KEY, vaultId)

export const saveDefaultParticipants = (vaultId: string, list: string[]): void =>
  writeVaultJSON(DEFAULT_PARTICIPANTS_KEY, vaultId, list)

export const saveDefaultLists = (vaultId: string, keys: EntryKey[]): void =>
  writeVaultJSON(DEFAULT_LISTS_KEY, vaultId, keys)
