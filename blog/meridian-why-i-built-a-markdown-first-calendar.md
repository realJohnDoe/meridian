---
title: "Meridian: Why I built a Markdown-first calendar"
tags: [product, philosophy, architecture, features]
date: 2026-07-23
---

# Meridian: Why I built a Markdown-first calendar

Until a few months ago, one ordinary week of my life was spread across five apps.
Notes lived in [Obsidian](https://obsidian.md). My own tasks lived in the
[TaskNotes](https://tasknotes.dev/) plugin inside Obsidian. Tasks I share with my wife
lived in [Todoist](https://todoist.com). Appointments lived in
[Proton Calendar](https://calendar.proton.me/). Shopping lists lived in
[Google Keep](https://keep.google.com).

None of these apps are bad. What bothered me was the seams between them — and two things
I couldn't fix by switching to a different combination.

The first: I want to keep track of our child's calendar, but she doesn't need a Google
account. Every system I tried wanted her to _be a user_ before she could _have a
calendar_. I wanted something closer to the paper calendar on the kitchen wall: everyone
writes on it, everyone reads it, nobody owns it. The corporate version of the same
problem shows up at work regularly — a colleague creates a recurring meeting, goes on
vacation, and now nobody can move it.

The second: I wanted tags to be real things. In Obsidian a tag is a label. I wanted a tag
that can have its own description, its own notes, and its own tags.

So I built [Meridian](https://realjohndoe.github.io/meridian/): a calendar, task manager,
and notes app where every entry is a plain Markdown file.

What follows is roughly how that went — because the ideas I'm proudest of are not the
ones I started with.

## What I knew before I wrote any code

Not much, and all of it small — but I wrote it down. The first message of the chat that
became Meridian asked for "a markdown / yaml based web app for notes, tasks and calendar
events," where each entry is a Markdown file with frontmatter (or just YAML, when it has
no body). The important part was a negative: I did _not_ want to model the entity types
explicitly. A thing would be a task because it had a `done` field, an event because it
had a `date`, a note because it had neither. Type was something you read off the
metadata, never something you declared.

On top of that: `[[wikilinks]]` between entries, because wikis rise and fall on how well
they're interlinked; nested tasks shown inline; and one message later, tags that are
themselves entries, so a tag can carry its own description and body.

That's the whole premise. Everything else in this article is a consequence of it that I
didn't see coming — including the idea I now put first.

## A prototype, and a year of not building it

In spring 2025 I built a first prototype called
[idea-craft](https://realjohndoe.github.io/idea-craft/). Then I discovered TaskNotes,
which already did much of what I was sketching, and did the sensible thing: I stopped
building and used it for a year instead.

That year is the most useful thing that happened to Meridian, because it taught me three
things I could not have reasoned my way to.

**Recurrence rules don't belong in frontmatter — at least not iCal's.** The industry
standard is [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545), and its `RRULE`
strings are fine for machines and miserable for humans. `FREQ=MONTHLY;BYDAY=1FR,2FR` is
not something I want to hand-edit in a text file, and "plain files you can read" is the
entire point.

**One rule per entry isn't enough.** Real schedules are messy. I wanted a list of fixed
dates _and_ a repeating pattern in the same entry. I wanted two patterns at once —
something on the first _and_ second Friday of the month. I wanted to cancel one
occurrence, move another by an hour, and leave the rest alone. Most tools treat these as
edge cases. In our household they're most of the calendar.

**Mobile is where this is won or lost.** Obsidian is built for notes, and it's excellent
at that. But on a phone, tasks and events feel like second-class citizens next to what
[Google Calendar](https://calendar.google.com) or Todoist do. That gap never closed for
me, and no amount of plugin configuration was going to close it.

## The app I almost didn't build

For a while I didn't want to build an app at all. TaskNotes is open source, actively
maintained, and has a real spec — and its file format is almost exactly mine. My plan was
smaller and more polite: write up the "infer the type from the metadata" idea as an
extension to their format, ideally get TaskNotes itself to adopt it, and keep living in
Obsidian. The most defensible thing I had wasn't a UI; it was a data model, and a data
model is the kind of thing you contribute, not the kind of thing you fork a whole
ecosystem over.

What tipped me the other way was, again, the phone. Everything I actually wanted to fix —
the mobile task and calendar UX, a shared family calendar with no accounts, a browser URL
I could open on a locked-down work machine — lived _outside_ the file format, in
territory an Obsidian plugin couldn't reach without becoming its own app anyway. So the
"just propose a format" plan quietly became "build the thing and let the format prove
itself."

## A hundred versions on a phone

So this spring I started over on my phone, in a single very long chat session with
[Claude](https://claude.ai) — which turned out to be good enough at spinning up working
web prototypes that I could design by using, not just by sketching. I built one I called
**plaintext-os** and iterated on it something like a hundred times — most of those on one
question, what the frontmatter should actually look like, and the rest on making it
usable. Somewhere in the middle it got the name Meridian.

It worked. That was the problem. It worked well enough that I could see the real version
of the app — and that a single ever-growing generated file was never going to survive
contact with it. It gave me one other preview, too: the first time I pointed it at a real
GitHub repo it died with `failed to fetch`. A sandboxed prototype can't call the GitHub
API from the browser — a small foretaste of a wall I'd hit again, for real, when it came
time to choose where the files actually live.

On **2026-05-22** I moved to a desktop, set the prototype aside, and started a proper
repository: React, TypeScript, Tailwind, shadcn/ui, Vite. The first day's commits
scaffold the app, wire up GitHub Pages, and
[turn it into a PWA](https://github.com/realJohnDoe/meridian/commit/a23d5ab) — a
progressive web app rather than native ones, because I need iOS and Android and I am one
person.

_(How that rewrite actually went — and what two months of building this way taught me —
is its own story, and its own article.)_

## Then the "simple" idea started growing

Here's the part I want to be honest about, because it's the real shape of the project.

Four days in, I stopped building features and built a
[debugger](https://github.com/realJohnDoe/meridian/blob/main/debug.html) instead: a page
that shows how a YAML file becomes repeat patterns, how those patterns expand into
occurrences, and what happens to the file when you cancel or move one. That felt like a
detour. It was the single highest-leverage thing I built.

On **2026-06-03** I tore out the core data model —
[removing the Node/Instance split](https://github.com/realJohnDoe/meridian/commit/8a83d7c)
in favour of a flat list of items — added tests, and in the process found two bugs that
had been quietly losing data.

On **2026-06-11** entries stopped living only on my laptop:
[GitHub became a storage backend](https://github.com/realJohnDoe/meridian/commit/0057d2a),
followed within days by auto-sync, conflict detection, and a vault switcher.

On **2026-06-16** the description field
[became a real editor](https://github.com/realJohnDoe/meridian/commit/4e7b9f1) —
CodeMirror 6, with wikilinks rendering as inline chips and checkboxes you can actually
click.

None of these were on any plan. Each one was forced by the one before it. "Tasks and
events as Markdown files" turns out to imply a recurrence engine, which implies a
debugger; storing files somewhere implies sync, which implies conflict handling; editing
Markdown by hand on a phone implies an editor. The premise was small. The implications
were not.

## Everything is a list

By late June the app worked, and the vocabulary had become a mess.

I had wikilinks. I had tags implemented _as_ wikilinks, which is how I got my first-class
tags. And I had a backlinks panel on every entry. Then the questions started. A
wikilink-as-tag matters more than a wikilink buried in a paragraph — should both appear in
backlinks? Should they look different? Do they need separate sections?

And underneath those, a worse one: most people have never heard of a backlink. I was
about to ship an app whose central concept needed a glossary.

On **2026-06-20** I threw the vocabulary out. The frontmatter field `topics` was
[renamed to `items`](https://github.com/realJohnDoe/meridian/commit/d6d9f39), the
backlinks panel became a row that says _listed on_, and the whole model collapsed into
one sentence: **every entry is a list**.

| Entry       | Is a list with…                               | Its items are usually…      |
| ----------- | --------------------------------------------- | --------------------------- |
| **Task**    | a `done` property                             | subtasks                    |
| **Project** | a `done` property                             | tasks                       |
| **Event**   | a `date`, plus optional `time` and `duration` | agenda points or follow-ups |
| **Tag**     | —                                             | everything tagged with it   |
| **Note**    | no special properties                         | related entries             |

A project is a task whose items are tasks. A tag is a list that doesn't care when it
happens. A backlink is just "the lists this appears on" — a phrase that needs no
explanation, because everyone has used a list.

The point isn't elegance. It's that you never have to answer "is this a task, a subtask,
or a project?" The only question left is _do I want to track whether this is done?_ —
which is a question you can actually answer.

And because an entry can sit on several lists at once, this works: we keep a list called
**This Week** for things we want to finish this week but don't want to pin to a day yet.
"Pizza" sits on _This Week_ and on _Cooking_ at the same time. A strict hierarchy can't
express that. Tags can — which is exactly why I wanted first-class tags in the first
place, a year and several rewrites earlier.

That's the arc, really: the idea I'd have put on a landing page in May was the one I
found in June, by trying to explain the app to an imaginary user and failing.

## Why plain files were worth it

Every entry is a `.md` file with YAML frontmatter. Free text for your thoughts,
structured fields for the metadata.

I'm not going to make a moral argument out of this. Data ownership and longevity are
practical concerns: sooner or later most platforms need to monetize in ways you didn't
sign up for, and by then lock-in is a real cost. Plain files are the cheapest insurance I
know.

The property I underestimated is debuggability. Recurrence is the most intricate part of
the app and it produced a long tail of bugs — occurrences that wouldn't move,
cancellations that didn't stick, series that expanded one day too far. Debugging a normal
calendar means reasoning about a database you can't see. Debugging this one meant opening
a file and saying "here's what it does, here's what it should do." That, plus the
debugger, made most of those bugs mechanical to fix.

One concept per file also means two devices only collide when they edit _the same entry_,
not the whole calendar. I still hit conflicts. They just stay small.

## No backend, mostly

Meridian doesn't run a server that holds your notes. I tried hard to reach zero backend
and got close: there's a single stateless Cloudflare Worker whose only job is exchanging
OAuth tokens, because you can't do safe authentication without one.

Finding somewhere to put the files was harder than expected. What I wanted was a
password-protected folder in the cloud with an API, easy enough for a non-technical person
to set up. That sounds solved. It isn't — most options either hand the app access to
_everything_ in your account, or don't send CORS headers, so a browser app can't reach
them at all. The full comparison is in
[plans/storage-backend-survey.md](https://github.com/realJohnDoe/meridian/blob/main/plans/storage-backend-survey.md);
Dropbox and OneDrive are the strongest future candidates. GitHub won for now because it
gives you a real repository, free version history, and works on every device including
iOS.

## Where it actually stands

It is not a better note-taking app than Obsidian, and it isn't trying to be. Obsidian's
plugin ecosystem and linking depth are hard to beat. Meridian borrows the idea that
Markdown is the source of truth and pushes it the other way — into the tasks-and-calendar
territory where Google Calendar and Todoist still win on mobile.

It's also young. I've used it for tasks for about a month; we haven't moved our calendar
off Proton yet. Caching is the weakest part of the code — there are several layers of
state between a keystroke and a file on GitHub, and keeping them honest has produced more
bugs than anything else. Looking at the last few weeks of commits, most of them are
variations on "never lose a file," which tells you where the risk is.

If any of this sounds like the thing you've been assembling out of four apps, the
[example vault](https://realjohndoe.github.io/meridian/) runs in your browser with no
account and nothing to install. Try it and tell me what you like — and especially what
you don't. The code is on [GitHub](https://github.com/realJohnDoe/meridian).
