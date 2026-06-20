import type { Occurrence, Scheduled, EditScope } from '../types'
import type { EditorFields } from '../model/storeOps'

export type { Scheduled }

export type ItemType = 'task' | 'event' | 'note'

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
