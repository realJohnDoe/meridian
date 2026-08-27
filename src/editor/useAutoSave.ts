import { useEffect, useRef, type RefObject } from 'react'
import type { EntryState } from './state'

/**
 * Debounced body autosave for the entry editor. `entryRef` must already hold
 * the latest entry (kept current by the caller) so the debounced timer and
 * the unmount flush commit against current state rather than a stale render's
 * closure. `initialBody` seeds `bodyRef` — read from render-time state
 * (`entry.body`), not from `entryRef.current`: refs can't be read during
 * render.
 */
export function useAutoSave(commitEntry: (next: EntryState) => void, entryRef: RefObject<EntryState>, initialBody: string) {
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always holds the latest body: initialized from entry.body, then kept current by
  // every scheduleAutoSave call (which fires synchronously on each CM6 doc change,
  // independent of the debounced commit). Read by saveMeta/flushAutoSave so a
  // meta-only save can capture the current body without reaching into CodeMirror.
  const bodyRef = useRef(initialBody)

  // Commits a still-pending debounced autosave immediately instead of letting it
  // fire late (or never — the cleanup below would otherwise just clearTimeout it).
  const flushAutoSave = () => {
    if (!autosaveTimerRef.current) return
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
    commitEntry({ ...entryRef.current, body: bodyRef.current })
  }

  // Drops a still-pending autosave without committing it — used right before a
  // delete so goBack's flushAutoSave (called from deleteNode's navigateBack
  // callback) can't resurrect the item that's about to be removed via a stale
  // commitEntry.
  const cancelAutoSave = () => {
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
  }

  // The unmount flush must run the *latest* flushAutoSave, not the one from
  // mount — it commits whatever edit is pending at teardown. Standard
  // latest-ref: a depless effect refreshes it after every commit, and the
  // cleanup below reads it. Replaces an exhaustive-deps suppression, which
  // would have opted this hook out of React Compiler optimization entirely.
  const flushAutoSaveRef = useRef(flushAutoSave)
  useEffect(() => { flushAutoSaveRef.current = flushAutoSave })
  useEffect(() => () => { flushAutoSaveRef.current() }, [])

  const scheduleAutoSave = (body: string) => {
    if (entryRef.current.editScope === 'add') return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    bodyRef.current = body
    autosaveTimerRef.current = setTimeout(() => {
      commitEntry({ ...entryRef.current, body })
      autosaveTimerRef.current = null
    }, 1500)
  }

  return { scheduleAutoSave, flushAutoSave, cancelAutoSave, bodyRef }
}
