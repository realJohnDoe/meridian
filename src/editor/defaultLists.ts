/**
 * Per-vault localStorage key (see `lib/vaultStorage`) for the lists a new entry
 * starts out on — `EntryKey`s of entries in that vault. Not applied when an
 * entry is promoted from a checklist line: that line already sits on a list.
 */
export const DEFAULT_LISTS_KEY = 'meridian_default_lists'
