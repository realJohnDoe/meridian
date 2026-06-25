# Meridian

**A calm, note-centric calendar for people who like owning their data.**

Meridian is a free, open-source PWA that blends task management, event scheduling, and note-taking into a single timeline — and stores everything as plain Markdown files you can read, edit, and back up anywhere.

**[Open the app →](https://realjohndoe.github.io/meridian/)**

---

## ✨ What it does

- **Agenda, day, and month views** — see your tasks and events in whatever layout suits the moment.
- **Tasks, events, and notes in one place** — every entry lives in a Markdown file with YAML frontmatter for metadata, so it's readable outside Meridian too.
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

Every entry is a Markdown file. Here's what a task looks like:

```markdown
---
title: Write weekly review
date: 2026-06-27
type: task
priority: high
duration: 30m
repeat: weekly
tags: [review, planning]
participants: [alice, bob]
---

Notes about this task go here, in plain Markdown.
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
