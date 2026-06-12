import type { Occurrence, Scheduled, Priority, Repeat as RepeatValue, EditScope } from '../types'

export type { Scheduled }

export type ItemType = 'task' | 'event' | 'note'

export interface EntryState {
  item: Occurrence | null
  title: string
  bodyHtml: string
  scheduled: Scheduled | null
  duration: string
  tracked: boolean
  itemType: ItemType
  repeat: RepeatValue | null
  done: boolean
  tags: string[]
  topics: string[]
  participants: string[]
  priority: Priority | null
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
