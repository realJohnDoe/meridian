# Meridian

**Tasks and a calendar that are actually good on your phone — stored as plain Markdown files you own.**

<img src="public/screenshots/agenda-narrow.png" width="340" alt="Meridian's agenda view on a phone, showing scheduled tasks and events grouped by day." />

**Who it's for:** you keep your life in Markdown — Obsidian, TaskNotes, or just a folder of `.md` files — and you're tired of tasks and dates being something a plugin bolts onto a desktop-first app. In Meridian they're first-class, and they're fast on a phone.

**And whoever you share with doesn't have to be you.** Point Meridian at a repo and everyone you share it with reads and writes the same repo — no vault to configure, no plugins, and no event owned by whoever happened to create it. Write access is a GitHub collaborator invite, so the people you share *with* need a (free) GitHub account. The people you *name* on entries need nothing at all: participants are just names in a file, so a child or a partner can be on the calendar without being a user of anything.

**[Open the app →](https://realjohndoe.github.io/meridian/)** — try the Tutorial vault first, nothing to sign up for.

*Meridian does tasks and calendar. It doesn't try to out-note Obsidian, and doesn't want to.*

---

## Why not just Obsidian + TaskNotes?

That's what I used, and TaskNotes is good. The limit isn't the plugin — it's that a plugin has to work through Obsidian's own interface, which was built for the desktop. Capturing something on a phone takes a couple of taps more than it would in Google Calendar or Todoist, and those taps add up.

|  | Meridian | Obsidian + TaskNotes | Google Calendar / Todoist |
|---|---|---|---|
| Plain Markdown files you own | ✅ | ✅ | ❌ |
| Tasks + calendar first-class, no plugin | ✅ | Plugin-mediated | ✅ |
| Built phone-first | ✅ | Desktop-first | ✅ |
| Second person needs no vault, no plugin, no install | ✅ | ❌ | ✅ |

Only one column has all four.

The row that costs the most to earn isn't in the table, because every app claims it: **the files have to still be right tomorrow, on the other device.** That is where most of the work in this repository has actually gone — see [keeping them intact across devices](#keeping-them-intact-across-devices).

---

## ✨ What it does

**The one thing to judge us on: sync you can check, not just "offline-first."** Every entry is a plain `.md` file, and the app's real job is getting your edits to your other devices without dropping or mangling one. The sync layer is held to [six written invariants](plans/reports/sync-invariants.md) — *no acknowledged write is lost*, *settled devices agree* — that a generated test suite re-checks after **every single operation** of randomised two-device interleavings. It works offline and syncs when you're back online; what's unusual is that the promise it makes while doing so is written down and machine-checked. [How that works, and what it doesn't promise →](#keeping-them-intact-across-devices)

Everything else:

- **Built for the phone** — one-handed capture and navigation, not a desktop layout squeezed narrow. Add it to your home screen or desktop like any native app (it's a PWA).
- **Recurrence that bends to real life** — daily, weekly, monthly, yearly, custom intervals, weekday-specific patterns, and "repeat N days after completion" — plus per-occurrence overrides and several patterns in one entry, without fiddling with a wizard. [The full model →](#4-a-recurrence-model-that-bends-to-real-life)
- **Agenda, day, and month views** — see your tasks and events in whatever layout suits the moment.
- **Tasks, events, and notes in one place** — all the same kind of thing, all on one timeline.
- **Wikilinks** — connect entries with `[[Note Title]]` links that render as inline chips with a preview popover.
- **Participants** — tag people on entries and filter the whole calendar to show only their items.
- **Calendar subscriptions** — subscribe to an iCal feed (Google, Outlook, Apple, or anywhere else) and see its events alongside your own, read-only; export a vault back out as a single `.ics` file to plug into another calendar.
- Plus what you'd expect of any of these apps: **search** across every entry's title and content, and **priority and duration** as first-class fields on any task or event.

---

## 🗄️ Your data, your way

Meridian doesn't run a server that holds your notes. You choose where your files live:

| Backend | How it works |
|---|---|
| **GitHub repository** ⭐ | Reads and writes directly to a repo of your choice via the GitHub API. Instant cloud sync, full git history, and works on any device including iOS. This is the recommended backend for most users. |
| **Local folder** | Opens a folder on your device via the browser's File System API. Files stay on your device. Supported in Chrome or Edge, desktop or Android — not available in Safari or Firefox. |
| **Calendar subscription** | Paste an iCal feed URL — Google, Outlook, Apple, or anywhere else — and its events show up read-only alongside your own. A feed the browser can't fetch directly is relayed through Meridian's own Worker, which doesn't hold your notes any more than the app does. |
| **Tutorial vault** | A built-in demo you can explore before connecting anything — no account needed. |

Files are plain `.md` files. Open them in any text editor, check them into git, sync them with any tool you already use.

### Keeping them intact across devices

Owning the files is the easy half. The hard half is the four layers between a keystroke and a file on GitHub — the UI, the in-memory store, an on-device cache, and the backend — each a fresh chance for two of them to quietly disagree. That is the largest single investment in this repository: roughly **2,000 lines of sync, conflict and merge logic behind 10,000 lines of tests**.

What those tests enforce is [written down as six invariants](plans/reports/sync-invariants.md). Two of them read the same to a user as they do to the test suite:

> **No acknowledged write is lost.** Content the app said was saved stays reachable until a client that had *seen* it acts to replace or delete it.

> **Settled clients agree.** Two devices with nothing left to push hold the same content for every path.

They aren't checked by hand-written scenarios alone. A generator builds random two-device interleavings — writes, deletes, syncs, page reloads, a tab closing inside the autosave debounce, a write whose acknowledgement never arrives — and asserts the four safety invariants after *every operation* in the sequence, and the two liveness ones once the world goes quiet.

**None of which is a guarantee.** "No acknowledged write is lost" is precisely the sentence this project has broken most often — sixteen separate defects between 11 June and 6 September 2026, some of them found by the generated suite rather than by anyone using the app. So the claim is narrower than "your data is safe", and more useful: the promise is written in English, it was re-derived from every sync bug that got through, it is machine-checked on every CI run, and each escape becomes a permanent case in the corpus so that failure can't come back. And when one does get through, one file per entry means two devices only ever collide on *the same entry* — never on the whole calendar.

---

## 🚀 Getting started

1. **Open the app** at [realjohndoe.github.io/meridian](https://realjohndoe.github.io/meridian/).
2. Try the **Tutorial vault** to get a feel for the interface — click through the onboarding tour.
3. When you're ready, connect your own storage:
   - **GitHub** (recommended) — click "Connect GitHub repo", **Sign in with GitHub**, and pick the repository to use — no token to create by hand. Meridian reads and writes files directly, so you can reach your vault from any device.
   - **Local folder** — click "Connect local folder" and pick a directory. Chrome or Edge, desktop or Android; not available in Safari or Firefox.
4. Create your first entry with the **+** button and start building your calendar.

---

<details>
<summary><h2 style="display: inline">📄 Entry format</h2></summary>

Every entry is a Markdown file. Here's a simple weekly task:

```markdown
---
title: Write weekly review
date: 2026-06-27
done: false
priority: high
duration: 30m
repeat:
  type: schedule
  freq: weekly
items:
  - "[[review-q3-goals]]"
  - "[[plan-next-sprint]]"
participants: [alice, bob]
---

Notes about this task go here, in plain Markdown.
```

The `items` list is the task's subtasks — wikilink references to other
entries, just like philosophy #2 describes. Meridian fills it in for you
as you link entries in the editor.

Because an entry is a list, recurrence lives in its **occurrences**. You can override or skip any one of them, and even mix several patterns in the same entry — here, exercise repeats every Monday/Wednesday/Friday, with one occurrence already marked done:

```markdown
---
defaults:
  title: Exercise
  done: false
date: 2026-04-06
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
instances:
  - date: 2026-04-06
    done: true
---

30 min run or gym. Part of [[health-habits]] tracking.
```

You can write and edit these files by hand if you prefer — Meridian will pick up any changes on the next sync.

Frontmatter keys Meridian doesn't use (`aliases`, `cssclasses`, or anything of your own) are kept as they are, so a file stays yours. Saving does rewrite the frontmatter into Meridian's canonical form: comments are dropped, and keys may be reordered, requoted, or moved between the root and a `defaults:` block. The markdown body below the frontmatter is kept as written, apart from trimming blank lines at either end.

</details>

---

## 🙏 Inspiration and comparisons

Meridian was heavily inspired by tools we already loved, and tries to fill the gap where they didn't quite fit together.

| Feature | Meridian | [Obsidian](https://obsidian.md) + [TaskNotes](https://tasknotes.dev/) | [Google Calendar](https://calendar.google.com) | [GitHub Issues / Projects](https://github.com/features/issues) | [Todoist](https://todoist.com) | [Google Keep](https://keep.google.com) |
|---|---|---|---|---|---|---|
| Phone-first UI | ✅ | Desktop-first | ✅ | Partial | ✅ | ✅ |
| Plain Markdown storage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Calendar views (day / month) | ✅ | Plugin-dependent | ✅ | Partial | Partial | ❌ |
| Task management | ✅ | ✅ (TaskNotes plugin) | Limited | ✅ | ✅ | Partial |
| Wikilinks between entries | ✅ | ✅ | ❌ | ✅ (`#123` issue links) | ❌ | ❌ |
| Advanced note-taking (plugin ecosystem, graph view, deep linking) | Partial | ✅ | ❌ | ❌ | ❌ | Partial |
| Several recurrence rules in a single entry | ✅ | ❌ (single rule per task) | ❌ (single rule per event) | ❌ | ❌ (single rule per task) | ❌ |
| Multiple participants / assignees | ✅ | Partial | ❌ | ✅ | Partial (one assignee per task) | ❌ |
| Free & open source | ✅ | Partially (plugin only) | ❌ | ❌ | ❌ | ❌ |
| Works in the browser | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |

**[Obsidian](https://obsidian.md) and the [TaskNotes plugin](https://tasknotes.dev/)** inspired the wikilink system, the plain-Markdown-as-the-source-of-truth philosophy, and much of the editor UX. If you're already an Obsidian user, Meridian's vault format will feel immediately familiar.

To be honest about the comparison: Meridian supports notes, but it doesn't try to be a better note-taking app than Obsidian — Obsidian's plugin ecosystem and note-linking depth are hard to beat, and Meridian doesn't aim to beat them. Meridian's focus is tasks and calendar events, which Obsidian only supports through plugins like TaskNotes; in Meridian they're first-class citizens from day one.

**[Google Calendar](https://calendar.google.com)** set the bar for what recurring events and multi-view calendar navigation should feel like.

**[GitHub Issues and Projects](https://github.com/features/issues)** showed how linking, labelling, and filtering structured entries can work without getting in the way of actual writing.

---

## 💡 The ideas behind Meridian

Four principles shape everything in Meridian. They sit below the pitch rather than in it: they explain *why* the app behaves the way it does, which matters more once you're using it than while you're deciding to. The exception is #4 — the recurrence model is a reason to switch, not just a principle.

### 1. Different concepts, different lifespans

Tasks, projects, calendar events, notes, and tags stay relevant for different amounts of time: tasks and projects until they're marked done, calendar events until their fixed time passes, and notes and tags indefinitely. Meridian doesn't force these different lifespans into separate apps — it models all of them the same way underneath.

### 2. Lists model hierarchies

Lists are a flexible way to model hierarchies: the more abstract concept sits higher in the hierarchy, as a **list**, and lists the more concrete concepts below it, as **items**. Unlike a classical hierarchy, an item can sit on more than one list at once — a task can be a subtask of one project and still be tagged, or show up as a follow-up on an event — because these are references, not exclusive parent-child slots.

| Entry | Is a list with… | Its items are usually… |
|---|---|---|
| **Task** | a `done` property | subtasks |
| **Project** | a `done` property | tasks |
| **Event** | a `date`, plus optional `time` and `duration` | agenda points or follow-up tasks |
| **Tag** | — | everything tagged with it |
| **Note** | no special properties | related entries |

One idea instead of separate "task" and "event" and "note" silos — and the reason you never have to decide which of those a thing is. The longer version is in [the post about building it](blog/1-meridian-why-i-built-a-markdown-first-calendar/meridian-why-i-built-a-markdown-first-calendar.md).

### 3. Everything is a plain Markdown file

Every entry is a `.md` file with YAML frontmatter — free text for your notes, structured fields for the metadata. That gives you the best of both worlds, and three concrete benefits:

- **It's yours.** Open, edit, grep, or back up your files with any tool. No lock-in, no proprietary database.
- **It's easy to debug.** When something looks off, you can read the file and see exactly why.
- **It syncs cleanly.** Each item is its own file, so two devices only conflict when they edit *the very same item* — not the whole calendar.
- **It's LLM-friendly.** Markdown with YAML frontmatter is the format nearly every LLM tool and workflow already reads and writes natively — no bespoke parser needed. Google Cloud's newly proposed [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/) follows the same pattern: a bundle of markdown files with YAML frontmatter as a vendor-neutral way to give AI agents curated context.

### 4. A recurrence model that bends to real life

Real schedules aren't tidy, so Meridian's recurrence model goes well beyond "repeats weekly":

- **Per-occurrence overrides come standard** — cancel or shift a single occurrence without touching the rest of the series.
- **Irregular schedules** — pin one-off occurrences alongside a repeating pattern in the same entry.
- **Multiple series in one entry** — e.g. something on the *first and second Friday* of every month, or a daily check-in that later switches to "2 days after I finish it."
- **Weekday-specific, set-position, interval, and after-completion** rules, in any combination.

---

## Browser support

Meridian uses modern browser APIs (File System Access, IndexedDB, Service Workers). It works best in **Chrome 102+** or **Edge 102+**. Firefox and Safari are supported for most features; local folder access requires a Chromium-based browser.

---

## License

MIT — see [LICENSE](LICENSE).
