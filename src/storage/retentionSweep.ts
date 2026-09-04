/**
 * The retention sweep — plans/archived-entries.md 4d. Auto-archives entries
 * that are both finished (`model/retention.ts`'s `isEntryFinished`) and old
 * (their file's `lastModified`, per 4b, older than the vault's
 * `retentionDays`). Runs per vault after a successful pulling sync settles
 * (see its call site in `sync.ts`'s `runSync`) — not on a timer, not on
 * render, and unconditional otherwise: no `showArchived`-style preference to
 * consult, since archived-ness is occurrence data, not filter state (see
 * `useCalendarFilter`'s own doc comment on that same point).
 */
import { toast } from 'sonner'
import { setArchived, isEntryFinished } from '@/model'
import { isArchived } from '@/occView'
import { isWritableVault } from '@/vaultRef'
import { keyToPath } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { getVaultLayer, getVaults, getSnapshot } from '@/storeBridge'
import { commitNext } from '@/storeCommit'
import { cacheLoadAll } from './cache/files'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Run the sweep for one vault. A no-op when the vault isn't registered, isn't
 * writable (`example`/`ical` have no writable side, and a subscription's feed
 * is upstream anyway — plans/archived-entries.md 4c), or has no
 * `retentionDays` set.
 */
export async function sweepRetention(vaultId: string): Promise<void> {
  const ref = getVaults().find(v => v.id === vaultId)
  if (!ref || !isWritableVault(ref) || !ref.retentionDays || ref.retentionDays <= 0) return

  const records = await cacheLoadAll(vaultId)
  const lastModifiedByPath = new Map(records.map(r => [r.path, r.lastModified]))
  const cutoff = Date.now() - ref.retentionDays * DAY_MS
  const today = new Date()

  const keys: EntryKey[] = []
  for (const [key, entry] of getVaultLayer(vaultId)) {
    if (isArchived(entry.root)) continue
    // Absent lastModified — a cache row from before 4b, or a file the
    // backend never reported a modification date for — never archives.
    // Fails safe: see RawFile.lastModified's doc comment.
    const lastModified = lastModifiedByPath.get(keyToPath(key))
    if (lastModified === undefined || lastModified > cutoff) continue
    if (!isEntryFinished(entry.items, today)) continue
    keys.push(key)
  }
  if (keys.length === 0) return

  let next = getSnapshot()
  for (const key of keys) next = setArchived(next, key, true)
  commitNext(next, keys)

  const label = keys.length === 1 ? 'entry' : 'entries'
  toast(`Archived ${keys.length} ${label} in "${ref.name}"`, {
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        let reverted = getSnapshot()
        for (const key of keys) reverted = setArchived(reverted, key, false)
        commitNext(reverted, keys)
      },
    },
  })
}
