import type { Occurrence, EditScope } from '@/types'
import type { EditorFields } from '@/model'

export type ItemType = 'task' | 'event' | 'note'

/**
 * Everything the entry form shows, in one shape.
 *
 * Not what the editor *stores*: `useEntryEditor` derives this on every render
 * from the store's view of the occurrence plus the user's recorded edits (see
 * `edits.ts`). It survived that change as the render-facing type because a
 * component asking for "the form" wants all of it at once, and because a
 * handler that wants to change a field should still be able to just say so —
 * `setEntry` takes one of these and works out what moved.
 */
export interface EntryState extends EditorFields {
  item:      Occurrence | null
  body:      string
  itemType:  ItemType
  editScope: EditScope
}

export const ENTRY_DEFAULT: EntryState = {
  item: null,
  title: '',
  body: '',
  scheduled: null,
  duration: '',
  tracked: true,
  itemType: 'task',
  repeat: null,
  done: false,
  tags: [],
  items: [],
  participants: [],
  priority: null,
  editScope: 'all',
}
