import { useStore } from '@/store'
import type { Occurrence } from '@/types'
import type { VaultKind, VaultRef } from '@/vaultRef'

export type EntryAccess =
  | { mode: 'edit';      vault: VaultRef }
  | { mode: 'sandbox';   vault: VaultRef }   // Tutorial: full edit UI, writes silently discarded — unchanged from today
  | { mode: 'view-only'; vault: VaultRef }   // subscription: no edit affordances — nothing to save back to

/**
 * ⚠️ Keyed off `VaultKind`, NOT off `StorageBackend.readOnly` — and it must stay that way.
 * Both `example` and `ical` are `readOnly` to the sync layer (neither pushes writes), so
 * "simplifying" this to read that flag would hand the sandbox vault the no-affordances view
 * and destroy the tutorial's whole point. The two notions are genuinely independent: the
 * backend flag answers "do writes get pushed", this answers "what does the editor offer" —
 * and the name is deliberately `view-only`, not `read-only`, so it can never be confused with
 * `StorageBackend.readOnly` in prose, a variable name, or a search.
 */
function accessMode(kind: VaultKind): EntryAccess['mode'] {
  if (kind === 'example') return 'sandbox'
  if (kind === 'ical')    return 'view-only'
  return 'edit'
}

/**
 * What UI an occurrence's own vault affords: full edit, the Tutorial's
 * unchanged sandbox, or the plain `view-only` read view (an iCal subscription
 * — there is no source to write back to, so offering property chips and a
 * save button would mislead rather than onboard).
 */
export function useEntryAccess(occ: Occurrence): EntryAccess {
  const vaults = useStore(s => s.vaults)
  const vault = vaults.find(v => v.id === occ.metadata.vaultId)
  // occ.metadata.vaultId names a registered vault for as long as the route
  // that produced this occurrence keeps re-deriving it from live store state
  // (see EntrySlugPage) — but a hook can't lean on a caller's discipline, so a
  // vault that's just been unregistered (e.g. mid-teardown of the entry the
  // user is looking at) falls back to plain 'edit' rather than throwing.
  if (!vault) return { mode: 'edit', vault: { id: occ.metadata.vaultId, name: occ.metadata.vaultId, kind: 'local' } }
  return { mode: accessMode(vault.kind), vault }
}
