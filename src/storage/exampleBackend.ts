import type { StorageBackend, FileEntry, VaultKind } from './backend'

// ── Seed content ───────────────────────────────────────────────
// Each entry maps to one virtual .md file.  Content uses the same
// YAML-frontmatter format that local vault files use, so it flows
// through the exact same parseToStoreItems path.

const ENTRIES: Array<{ id: string; content: string }> = [
  {
    id: 'welcome',
    content: `---
title: Welcome to Meridian
tags: [guide]
topics: [team-standup, ship-api]
---

Meridian stores your data as plain YAML/Markdown files in a local folder.

Item kinds:
- **Notes** — no date and no done field; freeform writing
- **Events** — have a date (plus optional time, duration, participants)
- **Tasks** — have a done checkbox (plus optional priority)

Open a local folder via **Add vault** in the sidebar to get started with your own data.`,
  },

  {
    id: 'dev-notes',
    content: `---
title: Dev Notes
tags: [dev, work]
topics: [ship-api]
---

API uses REST with JWT auth.  Rate limit: 1 000 req/min per tenant.

Key endpoints:
- \`POST /api/items\` — create
- \`GET  /api/items\` — list with filters
- \`PUT  /api/items/:id\` — update`,
  },

  {
    id: 'ship-api',
    content: `---
title: Ship Backend API
tags: [work, dev]
topics: [client-demo, dev-notes]
date: "2026-06-20"
done: false
priority: high
---

Core endpoints to deliver before the demo.  See [[client-demo]] for the deadline.`,
  },

  {
    id: 'client-demo',
    content: `---
title: Client Demo
tags: [work]
topics: [ship-api]
date: "2026-06-18"
time: "15:00"
duration: 60m
priority: high
---

Final run-through with the client.  [[ship-api]] must be complete first.`,
  },

  {
    id: 'team-standup',
    content: `---
title: Team Standup
tags: [work]
date: "2026-06-09"
time: "09:00"
duration: 30m
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
defaults:
  done: false
instances:
  - date: "2026-06-09"
    done: true
  - date: "2026-06-11"
    done: true
---

Quick sync — blockers and progress.`,
  },

  {
    id: 'book-club',
    content: `---
title: Book Club
tags: [social]
date: "2026-06-14"
time: "18:30"
duration: 90m
participants: [Alice, Bob, Carol]
---

This month: *The Pragmatic Programmer*.`,
  },

  {
    id: 'morning-run',
    content: `---
title: Morning Run
tags: [health]
date: "2026-06-09"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
defaults:
  done: false
  priority: medium
instances:
  - date: "2026-06-09"
    done: true
  - date: "2026-06-11"
    done: true
`,
  },

  {
    id: 'weekly-review',
    content: `---
title: Weekly Review
tags: [work, personal]
date: "2026-06-14"
time: "16:00"
duration: 30m
repeat:
  type: schedule
  freq: weekly
  byweekday: [sa]
defaults:
  done: false
  priority: low
`,
  },
]

const VERSION = 'example-v1'

export class ExampleBackend implements StorageBackend {
  readonly id       = 'example'
  readonly name     = 'Example data'
  readonly kind: VaultKind = 'example'
  readonly readOnly = true

  async statAll(): Promise<Map<string, string>> {
    const m = new Map<string, string>()
    for (const e of ENTRIES) m.set(e.id + '.md', VERSION)
    return m
  }

  async readFiles(paths: string[]): Promise<FileEntry[]> {
    const set = new Set(paths)
    return ENTRIES
      .filter(e => set.has(e.id + '.md'))
      .map(e => ({ path: e.id + '.md', content: e.content, version: VERSION }))
  }

  async readAll(): Promise<FileEntry[]> {
    return ENTRIES.map(e => ({ path: e.id + '.md', content: e.content, version: VERSION }))
  }

  async write(_path: string, _content: string): Promise<void> {}
  async delete(_path: string): Promise<void> {}

  async ensurePermission(_interactive: boolean): Promise<PermissionState> {
    return 'granted'
  }
}
