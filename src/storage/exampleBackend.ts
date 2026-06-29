import type { StorageBackend, RawFile, VaultKind } from './backend'
import { fmtISO } from '@/model'
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
    // ── 01-start-here: landing pad — the home list, dated today so it tops the Agenda ──
    {
      id: '01-start-here',
      content: `---
title: Welcome to Meridian
items: [everything-is-a-list, tasks-and-events, recurring-events, links-and-backlinks, favorites, frontmatter-reference, install-as-an-app, make-it-yours]
date: "${d(0)}"
---

Welcome! Meridian keeps your notes, events, and tasks as plain Markdown files in a
folder you own — no database, no lock-in.

The one idea behind all of it: **everything is a list with items.** This very note is a
list — its **items** (shown under the title) link to everything below. Start here:

- [[everything-is-a-list]] — the core idea
- [[tasks-and-events]] — how tasks, events, and notes differ
- [[recurring-events]] — repeating items, and editing one without breaking the series
- [[links-and-backlinks]] — connect entries with \`[[wikilinks]]\`
- [[favorites]] — pin the entries you reach for most
- [[frontmatter-reference]] — every field, in one place
- [[install-as-an-app]] — add Meridian to your home screen or desktop
- [[make-it-yours]] — start your own vault

This is a read-only sandbox — poke around freely. When you're ready, [[make-it-yours]].`,
    },

    // ── everything-is-a-list: philosophy #1, the centrepiece ──
    {
      id: 'everything-is-a-list',
      content: `---
title: Everything is a list
items: [tasks-and-events, recurring-events, buy-groceries]
---

The single idea Meridian is built on: **everything is a list, and the things inside it
are items.** The more abstract concept is the list; the more concrete ones are its items.

- **Task** — a list with a \`done\` checkbox; its items are subtasks
- **Project** — a list with a \`done\` checkbox; its items are tasks
- **Event** — a list with a \`date\` (+ optional \`time\`, \`duration\`); its items are agenda points or follow-ups
- **Tag** — a list of everything tagged with it
- **Note** — a list with no special fields; its items are related entries

This note is itself a list: its **items**, shown under the title, are \`[[wikilinks]]\` to
[[tasks-and-events]], [[recurring-events]], and a real task, [[buy-groceries]].

You can also keep an informal checklist right in the body of any entry:
- [ ] Try ticking this box
- [ ] Notice it doesn't stick — this sandbox is read-only
- [x] Add your own vault → [[make-it-yours]]`,
    },

    // ── tasks-and-events: what the field set means ──
    {
      id: 'tasks-and-events',
      content: `---
title: Tasks, events & notes
items: [buy-groceries, book-dentist, plan-the-week]
---

Meridian has no "type" field. What an entry *is* comes from which fields it carries:

- **Note** — no \`date\`, no \`done\`; just freeform writing (like this one).
- **Event** — has a \`date\` (plus optional \`time\`, \`duration\`, \`participants\`). Shows up in the Agenda, Month, and Day views. Example: [[plan-the-week]].
- **Task** — has a \`done\` checkbox (plus optional \`priority\` and \`date\`). Tick it and Meridian writes \`done: true\` back to the file. Example: [[buy-groceries]].

A task doesn't need a date — leave it off and it waits in your backlog, like
[[book-dentist]]. Find undated items from the search bar at the bottom.

> This sandbox is read-only, so ticking a checkbox won't stick. [[make-it-yours]] to make it real.`,
    },

    // ── buy-groceries: dated task with an in-body checklist ──
    {
      id: 'buy-groceries',
      content: `---
title: Buy groceries
date: "${d(0)}"
done: false
priority: medium
---

A plain **task** — it has a \`done\` field, so it shows a checkbox in the Agenda.

Its subtasks are a quick checklist in the body:
- [ ] Oat milk
- [ ] Coffee
- [x] Bananas

(Read-only here — ticking won't stick. See [[tasks-and-events]].)`,
    },

    // ── book-dentist: undated backlog task ──
    {
      id: 'book-dentist',
      content: `---
title: Book a dentist appointment
done: false
priority: low
---

An **undated task** — no \`date\`, so it lives in your backlog instead of on a day.
Reach it from the search bar, and give it a date when you're ready to schedule it.

Back to [[tasks-and-events]].`,
    },

    // ── plan-the-week: one-off event tomorrow ──
    {
      id: 'plan-the-week',
      content: `---
title: Weekly planning session
date: "${d(1)}"
time: "10:00"
duration: 30m
participants: [You]
---

An **event** — it has a \`date\`, \`time\`, and \`duration\`, so it lands on the Day-view
timeline and in the Month grid.

Block 30 minutes to set up the week ahead. Related: [[morning-run]], [[team-standup]].`,
    },

    // ── lunch-with-sam: one-off event a few days out (Month/Day variety) ──
    {
      id: 'lunch-with-sam',
      content: `---
title: Lunch with Sam
date: "${d(3)}"
time: "12:30"
duration: 1h
participants: [Sam]
---

A one-off **event** a few days out. Open the **Month** view to spot it on the grid,
or the **Day** view to see it on the hourly timeline.`,
    },

    // ── recurring-events: recurrence + edit scopes (philosophy #3) ──
    {
      id: 'recurring-events',
      content: `---
title: Recurring items
items: [team-standup, morning-run]
---

Real schedules are messy, so Meridian's recurrence goes well past "repeats weekly."

A \`repeat\` block defines the schedule; \`instances\` override individual occurrences.
See [[team-standup]] — a Mon/Wed/Fri event where two past occurrences are ticked done
while future ones stay open. Tasks repeat the same way: [[morning-run]].

**Editing one occurrence.** When you change a recurring item, Meridian asks how far the
change should reach:
- **This event** — only this one occurrence
- **This and future** — split the series from here onward
- **All events** — the whole series

So you can shift a single occurrence, cancel one, or change the entire series — without
breaking the rest. You can even mix patterns in one item, like *first and second Friday*
of the month.`,
    },

    // ── team-standup: recurring event ──
    {
      id: 'team-standup',
      content: `---
title: Team Standup
participants: [Alice, Bob]
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

See [[recurring-events]] for the *This / This and future / All* edit choices.`,
    },

    // ── morning-run: recurring task ──
    {
      id: 'morning-run',
      content: `---
title: Morning Run
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

A **recurring task** — same \`repeat\` mechanics as [[team-standup]], but with a \`done\`
field instead of \`time\`. The \`defaults\` block sets the priority for every occurrence.`,
    },

    // ── links-and-backlinks: wikilinks, items, backlinks ──
    {
      id: 'links-and-backlinks',
      content: `---
title: Links & backlinks
items: [dev-notes]
---

Connect entries two ways:

- **Items** — \`[[wikilinks]]\` listed under an entry's title. They're the entry's list members (see [[everything-is-a-list]]).
- **Body wikilinks** — type \`[[\` anywhere in the body for autocomplete. Link by slug or title.

Either way the link is two-directional: open [[dev-notes]] and you'll find this note in
its **Backlinks** panel at the bottom of the editor.

> Tip: typing \`[[\` in the body opens link suggestions as you go.`,
    },

    // ── dev-notes: plain note, link target ──
    {
      id: 'dev-notes',
      content: `---
title: Dev Notes
---

A plain **note** — no \`date\`, no \`done\`, just text. Handy for references you link to
from tasks and events.

API uses REST with JWT auth. Rate limit: 1 000 req/min per tenant.

Key endpoints:
- \`POST /api/items\` — create
- \`GET  /api/items\` — list with filters
- \`PUT  /api/items/:id\` — update

Open the **Backlinks** panel (bottom of the editor) to see [[links-and-backlinks]] pointing here.`,
    },

    // ── favorites ──
    {
      id: 'favorites',
      content: `---
title: Favorites
items: [team-standup, dev-notes]
---

Pin the entries you open most so they sit at the top of the menu for one-tap access.

- Open any entry and tap the **heart** in its top bar to favorite it.
- Favorites show up under **Favorites** in the menu (☰, top-left).
- Tap the pencil there to **reorder** them or **remove** one.
- They're per-vault and stay on this device.

Try favoriting [[team-standup]] or [[dev-notes]].`,
    },

    // ── frontmatter-reference: concise field reference ──
    {
      id: 'frontmatter-reference',
      content: `---
title: Frontmatter reference
items: [everything-is-a-list]
---

Every entry starts with a small YAML block. All fields are optional — what you include
decides whether it's a note, event, or task (see [[everything-is-a-list]]).

**File-level**
- \`title\` — display name
- \`items\` — list members, as \`[[wikilinks]]\`
- \`tags\` — free-text labels

**Scheduling (makes it an event)**
- \`date\` — \`YYYY-MM-DD\`
- \`time\` — \`HH:mm\`
- \`duration\` — e.g. \`30m\`, \`1h\`, \`2d\`
- \`participants\` — list of names
- \`repeat\` — recurrence block (see [[recurring-events]])

**Task**
- \`done\` — \`true\` / \`false\`
- \`priority\` — \`high\` / \`medium\` / \`low\`

Recurring items add \`defaults:\` (shared across occurrences) and \`instances:\`
(per-occurrence overrides).`,
    },

    // ── install-as-an-app: PWA install, per-OS ──
    {
      id: 'install-as-an-app',
      content: `---
title: Install as an app
items: [make-it-yours]
---

Meridian is a PWA — install it for a full-screen, app-like experience that works offline.

**Heads-up on storage:** the **local folder** backend works only in Chromium browsers
(Chrome, Edge) on desktop. On iOS, Safari, and Firefox, use a **GitHub repo** instead —
see [[make-it-yours]].

### Chrome / Edge — Windows, Mac, Linux, Android
Use the install icon in the address bar, or the menu → **Install app** /
**Add to Home screen**.

### Safari — iOS / iPadOS
Tap **Share**, then **Add to Home Screen**. (Use a GitHub vault — local folders aren't
available on iOS.)

### Safari — Mac
File → **Add to Dock**.

### Firefox
Desktop Firefox doesn't install PWAs — just use it in a tab. On Android, use the
menu → **Install**.`,
    },

    // ── make-it-yours: call to action ──
    {
      id: 'make-it-yours',
      content: `---
title: Make it yours
items: [install-as-an-app]
---

This example vault is **read-only** — edits and new entries won't be saved here.

To use Meridian for real:

1. Open the **menu** (☰, top-left) and tap **Manage vaults**.
2. **Add local folder** — pick a folder; Meridian reads and writes plain \`.md\` files
   there, with no lock-in (Chrome / Edge desktop only).
3. Or **Add GitHub repo** — sync your notes to a repository; works on any device,
   including iOS.

Once you've selected a writable vault, everything works: create entries, tick tasks done,
set up recurring events, and link files with \`[[wikilinks]]\`.

Then [[install-as-an-app]] for the full experience. Your files stay yours — just a folder
full of Markdown.`,
    },
  ]
}

const ENTRIES = buildEntries()

const VERSION = 'example-v3'

export class ExampleBackend implements StorageBackend {
  readonly id       = 'example'
  readonly name     = 'Tutorial'
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
