import { describe, it, expect } from 'vitest'
import { applyEdits } from './edits'
import { ENTRY_DEFAULT } from './state'

describe('applyEdits', () => {
  it('re-derives itemType from the edited tracked/scheduled', () => {
    const view = { ...ENTRY_DEFAULT, tracked: false, itemType: 'event' as const, scheduled: { date: '2026-01-01', time: '' } }
    const out = applyEdits(view, { tracked: { value: true, storeWas: false } })
    expect(out.itemType).toBe('task')
  })
})
