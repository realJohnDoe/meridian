import type { Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import { isArchived } from '@/occView'

export interface ArchivedEntry {
  key:   EntryKey
  title: string
}

/**
 * Every archived entry in `vaultId`, sorted by title.
 *
 * The vault's own "Archived" settings row (plans/archived-entries.md PR 3) is
 * the one escape hatch for an archived entry nothing links to — hidden from
 * the calendar and search alike, per `useCalendarFilter`/`fileEntries` — so
 * this has to be complete over `roots`, not derived from anything already
 * filtered.
 */
export function archivedEntriesFor(roots: Roots, vaultId: string): ArchivedEntry[] {
  const entries: ArchivedEntry[] = []
  for (const [key, meta] of roots) {
    if (meta.vaultId !== vaultId || !isArchived(meta)) continue
    entries.push({ key, title: meta.title || meta.fileSlug })
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title))
}
