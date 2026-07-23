---
title: "Meridian: Why I built a Markdown-first calendar"
tags: [product, philosophy, architecture, features]
date: 2026-07-23
---

# Meridian: Why I built a Markdown-first calendar

Until a few months ago, one ordinary week of my life was spread across five apps.
Notes lived in [Obsidian](https://obsidian.md). My own tasks lived in the
[TaskNotes](https://tasknotes.dev/) plugin inside Obsidian. Tasks I share with my wife
lived in [Todoist](https://todoist.com). Appointments lived in [Proton Calendar](https://calendar.proton.me/). Shopping
lists lived in [Google Keep](https://keep.google.com).

None of these apps are bad. What bothered me was the seams between them — and two
things I couldn't fix by switching to a different combination.

The first: I want to keep track of our child's calendar, but she doesn't need a Google account. Every
system I tried wanted her to _be a user_ before she could _have a calendar_. I wanted
something closer to the paper calendar on the kitchen wall: everyone writes on it,
everyone reads it, nobody owns it. The corporate version of the same problem shows up at
work regularly — a colleague creates a recurring meeting, goes on vacation, and now
nobody can move it.

The second: I wanted tags to be real things. In Obsidian a tag is a label. I wanted a
tag that can have its own description, its own notes, and its own tags. That sounds like
a small thing. It turned into a corner stone of the whole app.

So I built [Meridian](https://realjohndoe.github.io/meridian/): a calendar, task manager,
and notes app where every entry is a plain Markdown file.

## Everything is a list

I'd tried this before. In spring 2025 I built a prototype called
[idea-craft](https://realjohndoe.github.io/idea-craft/), then discovered TaskNotes and
used it happily for a year instead. What sent me back was mobile. Obsidian is built for
notes, and on a phone, tasks and events feel like second-class citizens next to what
[Google Calendar](https://calendar.google.com) or Todoist do. So this spring I started a
second prototype spent about a hundred iterations grinding on the frontmatter schema and
a few more hundred iterations on the frontend.

The early version had wikilinks, and tags implemented _as_ wikilinks, and a prominent
backlinks section on every entry. Then the questions started. A wikilink-as-tag is more
important than a wikilink buried in a paragraph — should both show up in backlinks?
Should they look different? And behind those: most people have never heard of a backlink.

So I threw the vocabulary out. **Every entry is a list**, and instead of tags, an entry
shows the lists it appears on.

| Entry       | Is a list with…                               | Its items are usually…      |
| ----------- | --------------------------------------------- | --------------------------- |
| **Task**    | a `done` property                             | subtasks                    |
| **Project** | a `done` property                             | tasks                       |
| **Event**   | a `date`, plus optional `time` and `duration` | agenda points or follow-ups |
| **Tag**     | —                                             | everything tagged with it   |
| **Note**    | no special properties                         | related entries             |

A project is a task whose items are tasks. A tag is a list that doesn't care when it
happens. The abstraction isn't there to be clever — it's there so you never have to
answer "is this a task, a subtask, or a project?" The only question left is: _do I want
to track whether this is done?_ Which is a question you can actually answer.

And because an item can sit on several lists at once, this works: we keep a list called
**This Week** for things we want to finish this week but don't want to pin to a day yet.
"Pizza" sits on _This Week_ and on _Cooking_ at the same time. A strict hierarchy can't
express that. Tags can — which is exactly why I wanted tags to be first-class in the
first place.

## Why plain Markdown

Every entry is a `.md` file with YAML frontmatter. Free text for your thoughts,
structured fields for the metadata.

I'm not going to make a moral argument out of this. Data ownership and longevity are
practical concerns: sooner or later most platforms need to monetize in ways you didn't
sign up for, and by then lock-in is a real cost. Plain files are the cheapest insurance
I know. Markdown in particular sits at a nice midpoint — structured enough for a program,
readable enough that a non-technical person can open the file and understand it.

The property I underestimated is debuggability. Meridian's recurrence model is the most
intricate part of the app, and the code is AI-assisted, so there were _many_ bugs.
Occurrences that wouldn't move. Cancellations that didn't stick. Series that expanded one
day past where they should. Debugging a normal calendar app means reasoning about a
database you can't see. Debugging this one meant pasting a file into a chat and saying
"here's what happens, here's what should happen." I eventually built a
[debug page](https://github.com/realJohnDoe/meridian/blob/main/debug.html) that
visualizes how the YAML becomes repeat patterns and occurrences, which made the rest
almost mechanical.

One concept per file also means two devices only collide when they edit _the same entry_ —
not the whole calendar. I still hit conflicts, but they stay small.

## No backend, mostly

Meridian doesn't run a server that holds your notes. That was the goal from day one, and
I tried hard to reach zero backend — but you can't do safe authentication without a
little bit of server, so there's one stateless Cloudflare Worker that does nothing but
exchange OAuth tokens.

Finding a storage backend was harder than expected. What I wanted was a
password-protected folder in the cloud with an API, easy enough for a non-technical
person to set up. That sounds like it should be a solved problem. It isn't: most options
either hand the app access to _everything_ in your account, or don't send CORS headers, so
a browser app simply can't talk to them. I wrote the whole comparison up in
[plans/storage-backend-survey.md](https://github.com/realJohnDoe/meridian/blob/main/plans/storage-backend-survey.md) —
Dropbox and OneDrive are the strongest future candidates. GitHub won for now because it
gives you a real repository, free version history, and works on every device including
iOS.

The part I'm quietly happy about is invisible: the code is organized so that tightly
coupled things live close together and widely used things live high up. That, plus
periodic [architecture health surveys](https://github.com/realJohnDoe/meridian/blob/main/plans/health-survey.md),
kept a fast-moving codebase from turning into a swamp.

## Occurrences you can actually touch

The industry standard for recurrence is iCal's `RRULE`. It's fine for machines and
miserable to read inside a YAML file. So Meridian models a recurring entry as a pattern
_plus_ individual occurrences you can override: cancel one, move one, mark one done.
There's also an "Add occurrence" button, because some things genuinely repeat without a
schedule. (If iCal compatibility turns out to matter, I'll add it — I'm not attached.)

## What Meridian isn't

It is not a better note-taking app than Obsidian, and it isn't trying to be. Obsidian's
plugin ecosystem and linking depth are hard to beat. Meridian borrows the idea that
Markdown is the source of truth and pushes it in the other direction — into the tasks and
calendar territory where mobile apps like Google Calendar and Todoist still win.

It's also young. I've used it for tasks for about a month; we haven't moved our calendar
off Proton yet. Caching is the weakest part of the code, and I'd be surprised if there
weren't more bugs hiding in it.

If any of this sounds like the thing you've been assembling out of four apps, the
[example vault](https://realjohndoe.github.io/meridian/) runs in your browser with no
account. Try it and tell me what you like — and especially what you don't. The code is on
[GitHub](https://github.com/realJohnDoe/meridian).
