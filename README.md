# Meridian

**A calm calendar, task manager, and notes app built on plain Markdown files.**

Meridian blends task management, event scheduling, and note-taking into a single timeline — and stores everything as plain Markdown files you can read, edit, and back up anywhere. It's a free, open-source PWA.

**[Open the app →](https://realjohndoe.github.io/meridian/)**

---

## 💡 The ideas behind Meridian

Three principles shape everything in Meridian.

### 1. Everything is a list of items

Tasks, projects, events, tags, and notes look like different things, but underneath they're the same: a **list** with **items**. The more abstract concept is the list; the more concrete concepts are its items.

| Entry | Is a list with… | Its items are usually… |
|---|---|---|
| **Task** | a `done` property | subtasks |
| **Project** | a `done` property | tasks |
| **Event** | a `date`, plus optional `time` and `duration` | agenda points or follow-up tasks |
| **Tag** | — | everything tagged with it |
| **Note** | no special properties | related entries |

There are more ways to read this, and that's the point: one simple idea bends to fit how *you* think, instead of locking you into separate "task" and "event" and "note" silos.

### 2. Everything is a plain Markdown file

Every entry is a `.md` file with YAML frontmatter — free text for your notes, structured fields for the metadata. That gives you the best of both worlds, and three concrete benefits:

- **It's yours.** Open, edit, grep, or back up your files with any tool. No lock-in, no proprietary database.
- **It's easy to debug.** When something looks off, you can read the file and see exactly why.
- **It syncs cleanly.** Each item is its own file, so two devices only conflict when they edit *the very same item* — not the whole calendar.

### 3. A recurrence model that bends to real life

Real schedules aren't tidy, so Meridian's recurrence model goes well beyond "repeats weekly":

- **Cancel or shift a single occurrence** without touching the rest of the series.
- **Irregular schedules** — pin one-off occurrences alongside a repeating pattern in the same entry.
- **Multiple series in one entry** — e.g. something on the *first and second Friday* of every month, or a daily check-in that later switches to "2 days after I finish it."
- **Weekday-specific, set-position, interval, and after-completion** rules, in any combination.

---

## ✨ What it does

- **Agenda, day, and month views** — see your tasks and events in whatever layout suits the moment.
- **Tasks, events, and notes in one place** — all the same kind of thing, all on one timeline.
- **Rich recurrence** — daily, weekly, monthly, yearly, custom intervals, weekday-specific patterns, and "repeat N days after completion" — without fiddling with a wizard.
- **Wikilinks** — connect entries with `[[Note Title]]` links that render as inline chips with a preview popover.
- **Participants** — tag people on entries and filter the whole calendar to show only their items.
- **Priority and duration** — first-class metadata on every task or event.
- **Search** — find any entry by title or content across your entire vault.
- **Offline-first** — the app works without a network connection and syncs automatically when you're back online.
- **Installable** — add Meridian to your home screen or desktop like any native app (it's a PWA).

---

## 🗄️ Your data, your way

Meridian doesn't run a server that holds your notes. You choose where your files live:

| Backend | How it works |
|---|---|
| **GitHub repository** ⭐ | Reads and writes directly to a repo of your choice via the GitHub API. Instant cloud sync, full git history, and works on any device including iOS. This is the recommended backend for most users. |
| **Local folder** | Opens a folder on your computer via the browser's File System API. Files stay on your machine. Supported in Chrome and Edge only — not available on iOS or Firefox. |
| **Example vault** | A built-in demo you can explore before connecting anything — no account needed. |

Files are plain `.md` files. Open them in any text editor, check them into git, sync them with any tool you already use.

---

## 🚀 Getting started

1. **Open the app** at [realjohndoe.github.io/meridian](https://realjohndoe.github.io/meridian/).
2. Try the **Example vault** to get a feel for the interface — click through the onboarding tour.
3. When you're ready, connect your own storage:
   - **GitHub** (recommended) — click "Connect GitHub repo", paste a repo URL, and enter a personal access token with `repo` scope. Meridian will read and write files directly — and you can access your vault from any device.
   - **Local folder** — click "Connect local folder" and pick a directory. Chrome and Edge only; not supported on iOS or Firefox.
4. Create your first entry with the **+** button and start building your calendar.

---

## 📄 Entry format

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
entries, just like philosophy #1 describes. Meridian fills it in for you
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

---

## 🙏 Inspiration and comparisons

Meridian was heavily inspired by tools we already loved, and tries to fill the gap where they didn't quite fit together.

| Feature | Meridian | [Obsidian](https://obsidian.md) + [TaskNotes](https://tasknotes.dev/) | [Google Calendar](https://calendar.google.com) | [GitHub Issues / Projects](https://github.com/features/issues) | [Todoist](https://todoist.com) | [Google Keep](https://keep.google.com) |
|---|---|---|---|---|---|---|
| Great mobile UX | ✅ | Partial | ✅ | Partial | ✅ | ✅ |
| Plain Markdown storage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Calendar views (day / month) | ✅ | Plugin-dependent | ✅ | Partial | Partial | ❌ |
| Task management | ✅ | ✅ (TaskNotes plugin) | Limited | ✅ | ✅ | Partial |
| Wikilinks between entries | ✅ | ✅ | ❌ | ✅ (`#123` issue links) | ❌ | ❌ |
| Rich recurrence rules | ✅ | Limited | ✅ | ❌ | ✅ | ❌ |
| Multiple participants / assignees | ✅ | Partial | ❌ | ✅ | ✅ (paid) | ❌ |
| Free & open source | ✅ | Partially (core only) | ❌ | ❌ | ❌ | ❌ |
| Works in the browser | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |

**[Obsidian](https://obsidian.md) and the [TaskNotes plugin](https://tasknotes.dev/)** inspired the wikilink system, the plain-Markdown-as-the-source-of-truth philosophy, and much of the editor UX. If you're already an Obsidian user, Meridian's vault format will feel immediately familiar.

**[Google Calendar](https://calendar.google.com)** set the bar for what recurring events and multi-view calendar navigation should feel like.

**[GitHub Issues and Projects](https://github.com/features/issues)** showed how linking, labelling, and filtering structured entries can work without getting in the way of actual writing.

---

## Browser support

Meridian uses modern browser APIs (File System Access, IndexedDB, Service Workers). It works best in **Chrome 102+** or **Edge 102+**. Firefox and Safari are supported for most features; local folder access requires a Chromium-based browser.

---

## License

MIT — see [LICENSE](LICENSE).
