import { describe, it, expect } from 'vitest'
import { applyEdits } from './edits'
import { ENTRY_DEFAULT, itemTypeOf } from './state'

describe('applyEdits', () => {
  it('moves the item type with an edited tracked flag', () => {
    const view = { ...ENTRY_DEFAULT, tracked: false, scheduled: { date: '2026-01-01', time: '' } }
    expect(itemTypeOf(view)).toBe('event')
    expect(itemTypeOf(applyEdits(view, { tracked: { value: true, storeWas: false } }))).toBe('task')
  })
})
