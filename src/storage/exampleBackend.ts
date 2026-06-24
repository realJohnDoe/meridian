import type { StorageBackend, RawFile, VaultKind } from './backend'
import { fmtISO } from '@/model/dateUtils'
import { addDays } from '@/format'

// ── Date helpers ────────────────────────────────────────────────
// All example dates are computed relative to today so items always
// land in the Agenda's -7d … +90d window regardless of when the app
// is opened.

function todayMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** ISO string N days offset from today. */
function d(offset: number): string {
  return fmtISO(addDays(todayMidnight(), offset))
}

/** Most-recent occurrence of a given weekday (0=Sun … 6=Sat) at or before today. */
function lastWeekday(dow: number): string {
  const t = todayMidnight()
  const diff = (t.getDay() - dow + 7) % 7
  return fmtISO(addDays(t, -diff))
}

/** N weeks before lastWeekday(dow). */
function prevWeekday(dow: number, weeksBack: number): string {
  const t = todayMidnight()
  const diff = (t.getDay() - dow + 7) % 7
  return fmtISO(addDays(t, -(diff + 7 * weeksBack)))
}

// ── Seed content ───────────────────────────────────────────────
// Each entry maps to one virtual .md file.  Content uses the same
// YAML-frontmatter format that local vault files use, so it flows
// through the exact same parseToStoreItems path.

// Weekday indices
const MON = 1, WED = 3

function buildEntries(): Array<{ id: string; content: string }> {
  // Recurring series anchor: most-recent Monday
  const recAnchor   = lastWeekday(MON)
  const recPrev1Mon = prevWeekday(MON, 1)
  const recPrev1Wed = prevWeekday(WED, 1)

  return [
    // ── 01: Landing pad — dated today so it tops the Agenda ────
    {
      id: '01-start-here',
      content: `---
title: Welcome to Meridian
tags: [guide]
items: [02-your-first-task, 03-plan-your-week, 04-link-your-notes, 05-make-it-yours]
date: "${d(0)}"
---

Meridian keeps your notes, events, and tasks as plain text files in a folder you own.

**Three item kinds — set by frontmatter fields:**
- **Notes** — no \`date\`, no \`done\` field; freeform writing
- **Events** — have a \`date\` (plus optional \`time\`, \`duration\`, \`participants\`)
- **Tasks** — have a \`done\` checkbox (plus optional \`priority\` and \`date\`)

This vault is a read-only sandbox. A guided tour has started — follow the steps,
or explore these linked items yourself:
- [[02-your-first-task]] — what tasks look like
- [[03-plan-your-week]] — what events look like
- [[04-link-your-notes]] — tags, topics, and wikilinks
- [[05-make-it-yours]] — how to add your own vault`,
    },

    // ── 02: Task example ───────────────────────────────────────
    {
      id: '02-your-first-task',
      content: `---
title: Read the Meridian welcome note
tags: [guide]
date: "${d(0)}"
done: false
priority: high
---

This is a **task** — it has a \`done\` field and a \`priority\`.

Tasks show a checkbox in the editor. Tick it and Meridian writes \`done: true\`
back to the file. Priority can be \`high\`, \`medium\`, or \`low\`.

Tasks can also be undated (just omit the \`date\` field) — useful for a backlog.

> This vault is read-only, so the checkbox won't persist here.
> Try it for real after adding your own vault — see [[05-make-it-yours]].`,
    },

    // ── 03: Event example ──────────────────────────────────────
    {
      id: '03-plan-your-week',
      content: `---
title: Weekly planning session
tags: [guide]
items: [team-standup]
date: "${d(1)}"
time: "10:00"
duration: 30m
---

This is an **event** — it has a \`date\`, a \`time\`, and a \`duration\`.

Events appear in all three calendar views: Agenda, Month, and Day.
The Day view shows them on a timeline — handy for spotting conflicts.

Optional extras: \`participants\` (a list of names) and \`repeat\` for recurring events.
See [[team-standup]] for a live recurring-event example.`,
    },

    // ── team-standup: recurring event ──────────────────────────
    {
      id: 'team-standup',
      content: `---
title: Team Standup
tags: [work]
date: "${recAnchor}"
time: "09:00"
duration: 30m
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
defaults:
  done: false
instances:
  - date: "${recPrev1Mon}"
    done: true
  - date: "${recPrev1Wed}"
    done: true
---

A **recurring event** that repeats Mon/Wed/Fri.

The \`repeat\` block defines the schedule. Each \`instances\` entry overrides one
occurrence — here two past occurrences are marked done while future ones stay open.

When you edit a recurring item the editor asks: *This event*, *This and future*, or
*All events* — so you can update just one without breaking the series.`,
    },

    // ── morning-run: recurring task ────────────────────────────
    {
      id: 'morning-run',
      content: `---
title: Morning Run
tags: [health]
date: "${recAnchor}"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
defaults:
  done: false
  priority: medium
instances:
  - date: "${recPrev1Mon}"
    done: true
  - date: "${recPrev1Wed}"
    done: true
---

A **recurring task** — same \`repeat\` mechanics as events, but with a \`done\` field
instead of \`time\`. The \`defaults\` block sets the priority for every occurrence.`,
    },

    // ── 04: Tags / topics / wikilinks explainer ────────────────
    {
      id: '04-link-your-notes',
      content: `---
title: Linking your notes
tags: [guide]
items: [dev-notes]
---

Meridian has two ways to connect items:

**Tags** are free-text labels (e.g. \`work\`, \`health\`). They appear as chips and
are searchable from the bottom bar.

**Topics** are wikilinks that point to other files by slug or title. They're listed
under a file's name in the editor and create a two-way connection: open [[dev-notes]]
and you'll see this file listed in its Backlinks panel.

**Wikilinks in the body** work the same way — \`[[slug]]\` or \`[[Title]]\` —
and also appear in Backlinks.

> Tip: type \`[[\` in the body editor for autocomplete suggestions.`,
    },

    // ── dev-notes: plain note, linked from above ───────────────
    {
      id: 'dev-notes',
      content: `---
title: Dev Notes
tags: [work, dev]
---

API uses REST with JWT auth.  Rate limit: 1 000 req/min per tenant.

Key endpoints:
- \`POST /api/items\` — create
- \`GET  /api/items\` — list with filters
- \`PUT  /api/items/:id\` — update

Open the **Backlinks** panel (bottom of editor) to see which files link here.`,
    },

    // ── 05: Call-to-action — add your own vault ────────────────
    {
      id: '05-make-it-yours',
      content: `---
title: Add your own vault
tags: [guide]
date: "${d(0)}"
---

This example vault is **read-only** — edits and new entries won't be saved here.

To use Meridian for real:

1. Open the **menu** (top-left ☰) and tap **Manage vaults**.
2. Choose **Add local folder** — your browser will ask you to pick a folder.
   Meridian reads and writes plain \`.md\` files there; no lock-in.
3. Or choose **Add GitHub repo** if you want your notes synced to a repository.

Once you have a writable vault selected, everything works: create entries,
tick tasks done, set up recurring events, and link files with \`[[wikilinks]]\`.

Your files stay yours — just a folder full of Markdown.`,
    },
  ]
}

const ENTRIES = buildEntries()

const VERSION = 'example-v2'

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

  async readFiles(paths: string[]): Promise<RawFile[]> {
    const set = new Set(paths)
    return ENTRIES
      .filter(e => set.has(e.id + '.md'))
      .map(e => ({ path: e.id + '.md', content: e.content, version: VERSION }))
  }

  async readAll(): Promise<RawFile[]> {
    return ENTRIES.map(e => ({ path: e.id + '.md', content: e.content, version: VERSION }))
  }

  async write(_path: string, _content: string, _expectedVersion?: string): Promise<string | undefined> { return undefined }
  async delete(_path: string, _expectedVersion?: string): Promise<void> {}

  async ensurePermission(_interactive: boolean): Promise<PermissionState> {
    return 'granted'
  }
}
