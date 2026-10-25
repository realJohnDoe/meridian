import type { Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import { readVaultStringArray } from '@/lib/vaultStorage'

/**
 * Per-vault localStorage key (see `lib/vaultStorage`) for the lists a new entry
 * starts out on — `EntryKey`s of entries in that vault. Not applied when an
 * entry is promoted from a checklist line: that line already sits on a list.
 */
export const DEFAULT_LISTS_KEY = 'meridian_default_lists'

/**
 * A vault's default lists that still exist. A list that was deleted (here or by
 * a sync) simply stops counting; the stale key is dropped from storage the next
 * time the setting is edited.
 */
export function liveDefaultLists(vaultId: string, roots: Roots): EntryKey[] {
  return readVaultStringArray(DEFAULT_LISTS_KEY, vaultId).filter((k): k is EntryKey => roots.has(k as EntryKey))
}
