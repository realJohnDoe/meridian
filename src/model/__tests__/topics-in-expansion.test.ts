/**
 * Targeted regression test: items must flow from root node through
 * expandRange so they appear in the agenda view and EntryEditor.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { expandRange } from '@/model/expansion'
import { applyEdit } from '@/model/storeOps'
import type { EditFields } from '@/model/storeOps'
import type { Roots } from '@/types'
import { TEST_VAULT, rootsOf, NEW_TARGET, keyOf, itemsOf, rootsIn, dataOf } from './helpers'

const STANDUP_YAML = `---
title: Weekly Standup
tags: [work]
date: "2026-04-06"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
instances:
  - date: "2026-04-13"
    done: true
---
`

const FROM = new Date('2026-04-01')
const TO   = new Date('2026-04-30')

describe('items flow through expansion', () => {
  it('items saved via applyEdit appear on expanded occurrences', () => {
    const { items, root } = parseToStoreItems('standup.md', STANDUP_YAML, TEST_VAULT)
    const roots: Roots = rootsOf(root)

    const occs0 = expandRange(items, roots, FROM, TO)
    const occ = occs0.find(o => o.date === '2026-04-20')!
    expect(occ).toBeDefined()

    // Simulate user saving with an item link added (single scope)
    const fields: EditFields = {
      title:        'Weekly Standup',
      tags:         ['work'],
      items:        ['[[project-alpha]]'],
      participants: [],
      body:         '',
      tracked:      true,
      done:         false,
      priority:     null,
      scheduled:    { date: '2026-04-20', time: '09:00' },
      duration:     '',
      repeat:       null,
    }
    const next = applyEdit(dataOf(items, roots), occ, 'single', fields, NEW_TARGET)

    // Root must carry the items
    const updatedRoot = rootsIn(next).get(keyOf('standup'))
    expect(updatedRoot?.items).toEqual(['[[project-alpha]]'])

    // Items must appear on every occurrence after expansion
    const occs1 = expandRange(itemsOf(next), rootsIn(next), FROM, TO)
    expect(occs1.length).toBeGreaterThan(0)
    for (const o of occs1) {
      expect(o.metadata.items).toEqual(['[[project-alpha]]'])
    }
  })

  it('items in YAML top-level are joined onto expanded occurrences', () => {
    const yaml = `---
title: Weekly Standup
tags: [work]
items:
  - "[[project-alpha]]"
date: "2026-04-06"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
---
`
    const { items, root } = parseToStoreItems('standup.md', yaml, TEST_VAULT)
    const roots: Roots = rootsOf(root)

    expect(root.items).toEqual(['[[project-alpha]]'])

    const occs = expandRange(items, roots, FROM, TO)
    expect(occs.length).toBeGreaterThan(0)
    for (const o of occs) {
      expect(o.metadata.items).toEqual(['[[project-alpha]]'])
    }
  })

  it('legacy topics field is migrated to items on read', () => {
    const yaml = `---
title: Weekly Standup
tags: [work]
topics:
  - "[[project-alpha]]"
date: "2026-04-06"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
---
`
    const { root } = parseToStoreItems('standup.md', yaml, TEST_VAULT)
    // Legacy topics: field is ignored — items starts empty (direction is inverted, no migration)
    expect(root.items).toEqual([])
  })
})
