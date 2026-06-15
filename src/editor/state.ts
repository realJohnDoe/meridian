import type { Occurrence, Scheduled, EditScope } from '../types'
import type { EditorFields } from '../model/storeOps'

export type { Scheduled }

export type ItemType = 'task' | 'event' | 'note'

export interface EntryState extends EditorFields {
  item:      Occurrence | null
  bodyHtml:  string
  itemType:  ItemType
  editScope: EditScope
}

export const ENTRY_DEFAULT: EntryState = {
  item: null,
  title: '',
  bodyHtml: '',
  scheduled: null,
  duration: '',
  tracked: true,
  itemType: 'task',
  repeat: null,
  done: false,
  tags: [],
  topics: [],
  participants: [],
  priority: null,
  editScope: 'all',
}
