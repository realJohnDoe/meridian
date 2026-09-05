import { useEffect, useRef, type RefObject } from 'react'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'
import type { EntryKey } from '@/fileIO'
import { untouchedStoreChanges } from './save'
import type { EntryState } from './state'

/**
 * Adopt into an open editor whatever the store moved that the user did not —
 * the live-reload half of "something else wrote to this entry while it was
 * open". (`touchedFieldsOnly` in `save.ts` is the other half: it keeps the save
 * correct, and reports the fields where both sides genuinely overlapped.)
 *
 * The writer this exists for is a **second view of the same vault** — another
 * tab, or the installed PWA — which shares this one's IndexedDB but not its
 * store, and whose writes reach here through `startCrossTabSync`
 * (`storage/sync.ts`). A sync pulling another *device*'s change lands in the
 * store by the same seam and is served identically, so nothing here is
 * tab-specific.
 *
 * **The description is deliberately not adopted**, though
 * `untouchedStoreChanges` reports it like any other field. It is a live
 * CodeMirror document with a cursor, a selection and an undo history in it, and
 * replacing that under the user is precisely the disruption the editor's
 * never-re-read rule exists to prevent — "they weren't typing just now" does
 * not make it safe. Its *save* stays correct without adoption: an untouched
 * description is never written, so the other side's version survives. The one
 * case where that is not enough — both sides typing prose — is an overlap, and
 * overlaps are reported rather than adopted.
 *
 * Driven by a store subscription rather than a render-time comparison because
 * the adoption also has to advance the editor's base: a field it adopted is not
 * a field the user touched, and must not be written back over the next save.
 * That is a ref write, which belongs in a callback and not in a render pass.
 *
 * `key` is null for a brand-new entry whose file does not exist yet — there is
 * nothing for anyone else to have written, so there is nothing to listen to.
 * Once its first save creates the file, `entry.item` deliberately stays null
 * and the occurrence lives in `createdItemRef` instead (see `useEntryEditor`),
 * which is why the item is resolved from both.
 */
export function useLiveReload(
  key:            EntryKey | null,
  entryRef:       RefObject<EntryState>,
  createdItemRef: RefObject<Occurrence | null>,
  baseRef:        RefObject<EntryState>,
  bodyRef:        RefObject<string>,
  adopt:          (fields: Partial<EntryState>) => void,
): void {
  // Latest-ref: `adopt` closes over this render's setState, and the
  // subscription outlives many renders.
  const adoptRef = useRef(adopt)
  useEffect(() => { adoptRef.current = adopt })

  useEffect(() => {
    if (!key) return
    // An entry is one object replaced whole, so reference identity is the whole
    // change check — and it is what keeps this off the hot path of every
    // unrelated store write.
    let seen = useStore.getState().entries.get(key)
    return useStore.subscribe(state => {
      const entry = state.entries.get(key)
      if (entry === seen) return
      seen = entry
      const { editScope } = entryRef.current
      const item = entryRef.current.item ?? createdItemRef.current
      // Gone means it was deleted elsewhere: an absence has no fields to adopt,
      // and what the editor should do about it is its own delete path's call.
      if (!entry || !item) return
      const drifted = untouchedStoreChanges(
        item, editScope, baseRef.current, { ...entryRef.current, body: bodyRef.current },
      )
      const { body: _description, ...metadata } = drifted
      if (Object.keys(metadata).length === 0) return
      adoptRef.current(metadata)
    })
  }, [key, entryRef, createdItemRef, baseRef, bodyRef])
}
