/**
 * Targeted regression test: topics must flow from root node through
 * expandRange so they appear in the agenda view and EntryEditor.
 */
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '../storeItems'
import { expandRange } from '../expansion'
import { applyEdit } from '../storeOps'
import type { EditFields } from '../storeOps'
import { isRootNode } from '../../types'

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

describe('topics flow through expansion', () => {
  it('topics saved via applyEdit appear on expanded occurrences', () => {
    const items = parseToStoreItems('standup.md', STANDUP_YAML)
    const occs0 = expandRange(items, FROM, TO)
    const occ = occs0.find(o => o.date === '2026-04-20')!
    expect(occ).toBeDefined()

    // Simulate user saving with a topic added (single scope)
    const fields: EditFields = {
      title:        'Weekly Standup',
      tags:         ['work'],
      topics:       ['[[project-alpha]]'],
      participants: [],
      body:         '',
      tracked:      true,
      done:         false,
      priority:     null,
      scheduled:    { date: '2026-04-20', time: '09:00' },
      duration:     '',
      repeat:       null,
    }
    const next = applyEdit(items, occ, 'single', fields)

    // Root node must carry the topics
    const root = next.find(isRootNode)
    expect(root?.metadata.topics).toEqual(['[[project-alpha]]'])

    // Topics must appear on every occurrence after expansion
    const occs1 = expandRange(next, FROM, TO)
    expect(occs1.length).toBeGreaterThan(0)
    for (const o of occs1) {
      expect(o.metadata.topics).toEqual(['[[project-alpha]]'])
    }
  })

  it('topics in YAML top-level are joined onto expanded occurrences', () => {
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
    const items = parseToStoreItems('standup.md', yaml)
    const root = items.find(isRootNode)
    expect(root?.metadata.topics).toEqual(['[[project-alpha]]'])

    const occs = expandRange(items, FROM, TO)
    expect(occs.length).toBeGreaterThan(0)
    for (const o of occs) {
      expect(o.metadata.topics).toEqual(['[[project-alpha]]'])
    }
  })
})
