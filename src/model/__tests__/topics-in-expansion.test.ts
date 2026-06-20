/**
 * Targeted regression test: items must flow from root node through
 * expandRange so they appear in the agenda view and EntryEditor.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '../storeItems'
import { expandRange } from '../expansion'
import { applyEdit } from '../storeOps'
import type { EditFields } from '../storeOps'
import type { Roots } from '../../types'

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
    const { items, root } = parseToStoreItems('standup.md', STANDUP_YAML)
    const roots: Roots = new Map([['standup', root]])

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
    const next = applyEdit({ items, roots }, occ, 'single', fields)

    // Root must carry the items
    const updatedRoot = next.roots.get('standup')
    expect(updatedRoot?.items).toEqual(['[[project-alpha]]'])

    // Items must appear on every occurrence after expansion
    const occs1 = expandRange(next.items, next.roots, FROM, TO)
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
    const { items, root } = parseToStoreItems('standup.md', yaml)
    const roots: Roots = new Map([['standup', root]])

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
    const { root } = parseToStoreItems('standup.md', yaml)
    // Legacy topics: field is read as items via migration
    expect(root.items).toEqual(['[[project-alpha]]'])
  })
})
