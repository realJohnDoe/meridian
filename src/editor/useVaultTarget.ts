import { useState, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@/store'
import { freeEntryKey, moveLinkBreakage } from '@/model'
import { keyRoute } from '@/routes'
import { isWritableVault } from '@/vaultRef'
import { keyVaultId, keySlug } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { moveEntryToVault } from '@/occurrenceActions'
import { getSnapshot, getUnreadableFiles } from '@/storeBridge'
import type { PendingMove } from './dialogs/MoveVaultDialog'
import type { EntryState } from './state'

/** A staged move, plus the vault it is staged towards. */
type StagedMove = PendingMove & { toVaultId: string }

export interface VaultTarget {
  /**
   * The vault this entry lives in — its own for an existing entry, the one a
   * brand-new entry will land in otherwise. Wikilink resolution and the link
   * picker are both scoped to it.
   */
  vaultId: string | null
  /**
   * Where a brand-new entry will be created, or null once a file exists (an
   * existing entry's vault is fixed). `saveNode` takes this, not `vaultId`:
   * the two agree for a new entry, but a save must not silently re-target an
   * existing one at whatever vault is currently the default.
   */
  targetVaultId: string | null
  /**
   * One control, two actions. Before the first save the chip re-targets where
   * the file will be created (no file exists yet, so nothing to confirm);
   * afterwards it stages a move, which the dialog confirms. Null when neither
   * is possible — an entry sitting in a non-writable vault can't move, since a
   * move goes writable ↔ writable only.
   */
  onVaultChange: ((toVaultId: string) => void) | null
  pendingMove: StagedMove | null
  onMoveConfirm: () => void
  onMoveCancel: () => void
}

/**
 * Which vault a brand-new entry starts out targeting: the one the route named
 * (the new-entry vault chip), else the default. Null for an existing entry —
 * its vault is fixed, and rides inside its own key.
 *
 * Exported because `useEntryEditor` needs the same answer one hook call
 * earlier, to seed a new entry's participants from the vault it will actually
 * land in. Both calls happen in the same mount render and read the same
 * store snapshot, so they cannot disagree.
 */
export function initialTargetVault(isNewEntry: boolean, seedVault?: string): string | null {
  return isNewEntry ? (seedVault ?? useStore.getState().defaultVaultId) : null
}

/**
 * Where this editor's entry lives, and how that changes.
 *
 * The vault chip means two different things depending on whether the file
 * exists yet, and this hook owns both: re-targeting a brand-new entry (pure
 * state, nothing on disk to move) and staging an existing entry's move to
 * another vault, which rewrites a file and breaks the wikilinks that crossed
 * the boundary — so it is staged here and confirmed in `MoveVaultDialog`,
 * never applied on the pick itself.
 *
 * `flushEditsRef` holds the editor's autosave flush. It is a ref rather than a
 * plain callback because the flush is built from this hook's own `vaultId`
 * (via `commitEntry`), so it cannot exist until after this call returns — the
 * same latest-ref idiom `useEntryEditor` already uses for pending links. Only
 * ever read from an event handler, long after the effect that fills it.
 */
export function useVaultTarget(
  entry: EntryState,
  createdKey: EntryKey | null,
  seedVault: string | undefined,
  flushEditsRef: RefObject<() => void>,
): VaultTarget {
  // Which vault a brand-new entry will land in, changeable via the vault chip
  // until the first save creates the file. `entry.item` is the mount-time
  // occurrence here — the editor never fills it in later (see createdItemRef
  // in useEntryEditor) — so this asks exactly "was this editor opened on a
  // brand-new entry".
  const [targetVaultId, setTargetVaultId] = useState<string | null>(
    () => initialTargetVault(!entry.item, seedVault),
  )

  // An existing entry's vault is its own; a brand-new one lands in the default
  // vault unless the route overrode it. A `[[slug]]` only ever means a file in
  // the same vault, so everything scoped to this id stays inside one vault.
  const defaultVaultId = useStore(s => s.defaultVaultId)
  const vaultId = entry.item ? keyVaultId(entry.item.entryKey) : (targetVaultId ?? defaultVaultId)

  const vaults = useStore(s => s.vaults)
  const navigate = useNavigate()
  const [pendingMove, setPendingMove] = useState<StagedMove | null>(null)

  // The key of the file this editor is editing, which is not the same question
  // as "does entry.item exist": a brand-new entry adopted its file on first
  // save (createdKey) while entry.item is deliberately still null.
  const savedKey = entry.item?.entryKey ?? createdKey
  const canMove  = !!savedKey && isWritableVault(vaults.find(v => v.id === vaultId))

  const requestMove = (toVaultId: string) => {
    if (!savedKey || toVaultId === vaultId) return
    // Flush first, so the counts below are computed against what the user can
    // actually see — a link typed seconds ago is otherwise still only in
    // CodeMirror, and the dialog would under-report the breakage.
    flushEditsRef.current()
    const snapshot = { ...getSnapshot(), unreadableKeys: new Set(getUnreadableFiles().keys()) }
    const toKey = freeEntryKey(snapshot, toVaultId, keySlug(savedKey))
    const { inbound, outbound } = moveLinkBreakage(snapshot, savedKey, toVaultId)
    setPendingMove({
      toVaultId,
      title:     entry.title,
      fromVault: vaults.find(v => v.id === vaultId)?.name ?? 'this vault',
      toVault:   vaults.find(v => v.id === toVaultId)?.name ?? 'the other vault',
      toSlug:    keySlug(toKey),
      slugTaken: keySlug(toKey) !== keySlug(savedKey),
      inbound:   inbound.length,
      outbound:  outbound.length,
    })
  }

  const confirmMove = () => {
    if (!pendingMove || !savedKey) return
    // Re-allocated inside moveEntryToVault against a fresh snapshot rather than
    // reusing the key previewed above: a sync landing while the dialog was open
    // could have taken that slug in the target vault.
    const toKey = moveEntryToVault(savedKey, pendingMove.toVaultId)
    setPendingMove(null)
    // The entry's URL *is* its key, so it changes with the move. `replace` so
    // Back doesn't land on a route whose entry no longer exists there.
    if (toKey) void navigate({ ...keyRoute(toKey), replace: true })
  }

  return {
    vaultId,
    targetVaultId,
    // Keyed off `createdKey` (state) rather than `createdItemRef` (a ref):
    // both mark "the first save landed", but only one is readable in render.
    onVaultChange: !savedKey ? setTargetVaultId : (canMove ? requestMove : null),
    pendingMove,
    onMoveConfirm: confirmMove,
    onMoveCancel:  () => setPendingMove(null),
  }
}
