import { parseYamlToStoreItems } from './model/storeItems'
import type { StoreItem, Roots } from './types'

// Stored as inline YAML strings so they go through the same parseToStoreItems
// path as disk files — no separate Node[] representation needed.
const SEED_YAML: Array<{ id: string; yaml: string }> = [
  { id: 'standup', yaml: `---
title: Weekly Standup
tags: [work]
date: "2026-04-06"
time: "09:00"
duration: 30m
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
instances:
  - date: "2026-04-13"
    done: true
  - date: "2026-04-14"
    done: true
---

Quick sync. Agenda:
- [[project-alpha]] status
- Blockers
- [[weekly-log]] updates` },

  { id: 'exercise', yaml: `---
title: Exercise
tags: [health]
date: "2026-04-06"
done: false
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
instances:
  - date: "2026-04-06"
    done: true
---

30 min run or gym. Part of [[health-habits]] tracking.` },

  { id: 'vitamins', yaml: `---
title: Take Vitamins
tags: [health]
date: "2026-05-10"
done: false
repeat:
  type: after_completion
  interval: 1 day
instances:
  - date: "2026-05-10"
    done: true
  - date: "2026-05-11"
    done: true
  - date: "2026-05-12"
    done: true
  - date: "2026-05-13"
    done: true
  - date: "2026-05-14"
    done: false
---` },

  { id: 'monthly-review', yaml: `---
title: Monthly Review
tags: [work]
date: "2026-04-07"
time: "14:00"
duration: 2h
repeat:
  type: schedule
  freq: monthly
  byweekday: [mo]
  bysetpos: 1
instances:
  - date: "2026-04-07"
    done: true
---

## Agenda

- Review [[project-alpha]] milestones
- Budget check
- Team velocity
- Next month planning` },

  { id: 'pay-rent', yaml: `---
title: Pay Rent
tags: [personal]
date: "2026-04-01"
done: false
repeat:
  type: schedule
  freq: monthly
  bymonthday: [1]
instances:
  - date: "2026-04-01"
    done: true
  - date: "2026-05-01"
    done: true
---` },

  { id: 'design-sync', yaml: `---
title: Design sync
tags: [work, design]
date: "2026-04-08"
time: "10:00"
duration: 1h
---` },

  { id: 'review-prs', yaml: `---
title: Review PRs
tags: [work]
date: "2026-04-09"
done: true
---` },

  { id: 'pycon', yaml: `---
title: PyCon 2026
tags: [conference]
date: "2026-04-19"
duration: 3d
---

## PyCon 2026

Sessions:
- Keynote: The Future of Python
- [[async-patterns]] workshop
- Networking dinner` },

  { id: 'keynote-ai', yaml: `---
title: "Keynote: Future of AI"
tags: [conference]
date: "2026-04-20"
time: "10:00"
duration: 2h
---` },

  { id: 'sprint-plan', yaml: `---
title: Sprint Planning
tags: [work]
date: "2026-04-27"
time: "14:00"
duration: 2h
---

## Sprint 12

Capacity: 34 points

- [ ] [[project-alpha]] beta release
- [ ] Recurrence engine tests
- [ ] Design system updates` },

  { id: 'offsite-kick', yaml: `---
title: Team Offsite Kickoff
tags: [work]
date: "2026-05-08"
time: "16:00"
duration: 3h
---` },

  { id: 'write-spec', yaml: `---
title: Write Spec Draft
tags: [project]
date: "2026-05-11"
done: true
---

Draft of [[spec-instance-recurrence]] v0.9 — cover split date/time/timezone fields.` },

  { id: 'standup-113', yaml: `---
title: "1:1 with Alex"
tags: [work]
date: "2026-05-13"
time: "11:00"
duration: 30m
---

Topics:
- Career growth check-in
- [[project-alpha]] concerns
- Upcoming [[team-offsite]] agenda` },

  { id: 'dentist-1', yaml: `---
title: Dentist
tags: [health]
date: "2026-05-13"
time: "14:30"
duration: 1h
---

Annual checkup. Bring insurance card.

Location: Dr. Müller, Friedrichstr. 42` },

  { id: 'sprint-board', yaml: `---
title: Review Sprint Board
tags: [work]
date: "2026-05-13"
done: true
---` },

  { id: 'lecture', yaml: `---
title: Prepare Lecture Notes
tags: [learning]
date: "2026-05-13"
done: false
---

For Thursday's lecture on [[distributed-systems]].

Cover: consensus algorithms, [[raft-protocol]], practical exercises.` },

  { id: 'design-review', yaml: `---
title: Design Review
tags: [work, design]
date: "2026-05-14"
time: "10:00"
duration: 1h
---` },

  { id: 'call-mom', yaml: `---
title: Call Mom
tags: [personal]
date: "2026-05-14"
done: false
---` },

  { id: 'blog-post', yaml: `---
title: Publish Blog Post
tags: [writing]
date: "2026-05-15"
done: false
---

Post about [[spec-instance-recurrence]]. Target: dev.to + HN.

1. The problem with iCalendar
2. A simpler model
3. Examples` },

  { id: 'team-offsite', yaml: `---
title: Team Offsite
tags: [work]
date: "2026-05-16"
duration: 3d
---` },

  { id: 'product-demo', yaml: `---
title: Product Demo
tags: [work]
date: "2026-05-20"
time: "15:00"
duration: 1h
---` },

  { id: 'finish-spec', yaml: `---
title: Finish Recurrence Spec
tags: [project]
date: "2026-05-20"
done: false
---` },

  { id: 'board-pres', yaml: `---
title: Board Presentation
tags: [work]
date: "2026-06-03"
time: "10:00"
duration: 2h
---` },

  { id: 'birthday-emma', yaml: `---
title: "Emma's Birthday 🎂"
tags: [personal]
date: "2026-06-10"
---

Get a gift! Ideas: [[gift-ideas]] or book from her [[reading-list]].` },

  { id: 'dentist-2', yaml: `---
title: Dentist Follow-up
tags: [health]
date: "2026-06-18"
time: "10:30"
duration: 1h
---` },

  { id: 'craft-conf', yaml: `---
title: Craft Conf 2026
tags: [conference]
date: "2026-06-24"
duration: 3d
---` },

  { id: 'beta-launch', yaml: `---
title: Beta Launch
tags: [work, milestone]
date: "2026-07-10"
---

## Launch checklist

- [ ] Feature flags enabled
- [ ] Monitoring alerts set up
- [ ] [[release-notes]] published
- [ ] Team comms sent` },

  { id: 'q3-plan', yaml: `---
title: Q3 Planning
tags: [work]
date: "2026-07-20"
done: false
---` },
]

export function loadSeedItems(): { items: StoreItem[]; roots: Roots } {
  const items: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { id, yaml } of SEED_YAML) {
    try {
      const parsed = parseYamlToStoreItems(yaml, id)
      items.push(...parsed.items)
      roots.set(id, parsed.root)
    } catch (e) {
      console.warn('[seed] parse failed for', id, e)
    }
  }
  return { items, roots }
}
