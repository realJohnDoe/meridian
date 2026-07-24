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

What follows is roughly how that went — the ideas I set out with, and the one that only
turned up along the way.

## What I knew before I wrote any code

A handful of things, and I'd been turning them over for a while. I wanted a Markdown/YAML
app for notes, tasks, and calendar events, where each entry is a Markdown file with
frontmatter — or just YAML, when it has no body. The important part was a negative: I did
_not_ want to model the entity types explicitly. A thing would be a task because it had a
`done` field, an event because it had a `date`, a note because it had neither. Type was
something you read off the metadata, not something you declared.

On top of that: `[[wikilinks]]` between entries, because links are what turn a collection
of notes into something you can actually navigate; nested tasks shown inline; and tags
that are themselves entries, so a tag can carry its own description and body.

These were the ideas I set out with, and I still like them. The one I now reach for first
only turned up later — much further along, and by surprise.

## A prototype, and a year of not building it

In spring 2025 I built a first prototype called
[idea-craft](https://realjohndoe.github.io/idea-craft/). Then I discovered TaskNotes,
which already did much of what I was sketching, and did the sensible thing: I stopped
building and used it for a year instead.

That year turned out to be important groundwork. It taught me three things I could not
have reasoned my way to from a blank page.

**iCal's recurrence rules are hard to read in a text file.** The industry standard is
[RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545), and its `RRULE` strings are
built for machines: `FREQ=MONTHLY;BYDAY=1FR,2FR` is not something I enjoy hand-editing.
Since "plain files you can read" was the point, I wanted recurrence I could read too. (If
iCal compatibility ever matters, I'm not against supporting it — it just wasn't the place
to start.)

**One rule per entry isn't enough.** Real schedules are messy. I wanted a list of fixed
dates _and_ a repeating pattern in the same entry. I wanted two patterns at once —
something on the first _and_ second Friday of the month. I wanted to cancel one
occurrence, move another by an hour, and leave the rest alone. Most tools treat these as
edge cases; in our household they come up regularly.

**Mobile is where this is decided.** Obsidian is built for notes, and it's excellent at
that. But on a phone, tasks and events feel like second-class citizens next to what
[Google Calendar](https://calendar.google.com) or Todoist do. That gap stayed open for
me, whatever plugins I tried.

## The app I almost didn't build

For a while I didn't want to build an app at all. TaskNotes is open source, actively
maintained, and has a real spec — and its file format is almost exactly mine. My plan was
smaller and more polite: write up the "infer the type from the metadata" idea as an
extension to their format, ideally get TaskNotes itself to adopt it, and keep living in
Obsidian. The most defensible thing I had wasn't a UI; it was a data model, and a data
model is the sort of thing you propose as a contribution, not the sort of thing you build
a whole separate app around.

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

It worked. That was the problem. It worked well enough to show me the real version of the
app — and that a single generated file, growing with every change, wasn't a foundation I
could keep building on. It gave me one other preview, too: the first time I pointed it at
a real GitHub repo it failed with `failed to fetch`. A sandboxed prototype can't call the
GitHub API from the browser — a small foretaste of a wall I'd meet again, for real, when
it came time to choose where the files actually live.

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

One thing AI changes about building software is that a throwaway dev tool is suddenly
cheap to make. So four days in, I had Claude build a
[debugger](https://github.com/realJohnDoe/meridian/tree/main/src/debug): a page that
shows how a YAML file becomes repeat patterns, how those patterns expand into
occurrences, and what happens to the file when you cancel or move one. It was genuinely
useful for about a week, while I chased the worst of the recurrence bugs; afterwards I
half-considered deleting it again.

On **2026-06-03** entries gained
[participants](https://github.com/realJohnDoe/meridian/commit/48506fb) — you tag people
on an entry, and later you can filter the whole calendar down to one person. This is the
shared-family-calendar idea from the very beginning finally showing up in the app:
everyone on the same kitchen calendar, no accounts required.

On **2026-06-11** entries stopped living only on my laptop:
[GitHub became a storage backend](https://github.com/realJohnDoe/meridian/commit/0057d2a),
followed within days by auto-sync, conflict detection, and a vault switcher.

On **2026-06-16** the description field
[became a real editor](https://github.com/realJohnDoe/meridian/commit/4e7b9f1) —
CodeMirror 6, with wikilinks rendering as inline chips and checkboxes you can actually
click.

None of this came from a master plan, but none of it fell from the sky either. Some of
it I'd been carrying since idea-craft — I already knew I wanted GitHub as a backend, and
I'd run into CodeMirror before. The pieces clicked into place one after another as the
small premise turned out to ask for them: files you can read want a recurrence engine you
can debug; files you sync want conflict handling; Markdown you edit by hand wants a real
editor.

## Everything is a list

By late June the app worked, and I had a naming decision to make.

I had wikilinks. I had tags implemented _as_ wikilinks, which is how I got my first-class
tags. And I had a backlinks panel on every entry. Then the questions started. A
wikilink-as-tag matters more than a wikilink buried in a paragraph — should both appear in
backlinks? Should they look different? Do they need separate sections?

And underneath those, a harder one: most people have never heard of a backlink. I was
about to ship an app whose central concept needed a glossary.

So on **2026-06-20** I decided to remove vocabulary rather than add it. The frontmatter
field `topics` was
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

A project is a task whose items are tasks. A tag is simply a list of everything filed
under it. A backlink is just "the lists this appears on" — a phrase that needs no
explanation, because everyone has used a list.

I do find that elegant, but elegance isn't the main point. The main point is that you
never have to answer "is this a task, a subtask, or a project?" The only question left is
_do I want to track whether this is done?_ — which is a question you can actually answer.

An entry can also sit on several lists at once, and that makes possible something I use
constantly. We keep a list called **This Week** for things we want to finish this week
but don't want to pin to a day yet. "Pizza" sits on _This Week_ and on _Cooking_ at the
same time. A strict hierarchy can't do that — Pizza would have to live in one place;
lists let it live in both.

None of this is what I'd put on a landing page. That would be the promise on the surface:
tasks and calendar in one app, stored as Markdown, with flexible hierarchies and flexible
recurrence. "Everything is a list" is the quieter idea underneath that makes those
promises hold together — and I only found it by trying to explain the app to an imaginary
user and running out of words that didn't need a glossary.

## The part I don't put on the landing page

A data model clicking into place is the fun part — and, conveniently, the part that fits
in a blog post. The rest of that summer was the other kind of work: making it reliable
enough to actually use day to day.

First the files needed to live somewhere I could reach from any device. I started with
GitHub and fine-grained access tokens — you paste a token, and Meridian reads and writes
a repository you own. GitHub because the readers I care about first are developers, and
they already have an account there and trust it. Pasting a token is a pain on a phone,
though, so later I added one small, stateless Cloudflare Worker that does nothing but
trade OAuth tokens, so most people can just click _connect_.

Finding a backend at all was harder than I expected. I wanted a password-protected folder
in the cloud with an API, simple enough for a non-technical person to set up — which
sounds like it should exist, and mostly doesn't. Most options either want access to
_everything_ in your account, or don't send the CORS headers a browser app needs (the
same `failed to fetch` the phone prototype hit), so they can't be reached from the browser
at all. I compared the candidates in
[plans/storage-backend-survey.md](https://github.com/realJohnDoe/meridian/blob/main/plans/storage-backend-survey.md);
Dropbox and OneDrive are the strongest alternatives, and I may add them.

The independence people worry about doesn't actually come from the backend. A local-only
app on your own disk would be safest there — but then nothing syncs between devices or
people. So the trade I made is a backend you can trust and also leave: GitHub keeps full
history and lets you download everything in one click. The real protection is the format.
Your data is Markdown with YAML frontmatter, readable in any editor, so if a platform
ever turns against its users, plain files are what let you walk away.

Then came the layers. Between a keystroke and a file on GitHub there are now four of them
— the UI, a React store (Zustand), an on-device cache (Dexie/IndexedDB), and the storage
backend — and each is a fresh chance for them to quietly disagree. This is where "plain
files, one concept each" stopped being a philosophy and became a practical advantage. When
something broke I could open the offending `.md`, read exactly what it claimed, and hand
Claude "here's what it does, here's what it should do." Recurrence alone — occurrences
that wouldn't move, cancellations that didn't stick, a series that expanded one day too
far — would have been miserable to chase through an opaque database. Against a file you
can read, most of those bugs turned mechanical. (One file per concept has a quieter payoff
too: two devices only collide when they edit _the same entry_, so the conflicts that
survive all that state stay small.)

I won't pretend it's finished. I've used Meridian for my own tasks for about a month; we
haven't moved the family calendar off Proton yet. The caching and sync layer is still the
weakest code in the repo — it's where the subtle bugs keep coming from, even now that most
of my day-to-day work has shifted to tests and polish. Getting those four layers to agree,
every time, is most of the distance between a prototype that works in a demo and something
you'd rely on.

## Where it fits

It is not a better note-taking app than Obsidian, and it isn't trying to be. Obsidian's
plugin ecosystem and linking depth are hard to beat. Meridian borrows the idea that
Markdown is the source of truth and pushes it the other way — into the tasks-and-calendar
territory where Google Calendar and Todoist still win on mobile.

If any of this sounds like the thing you've been assembling out of four apps, the
[example vault](https://realjohndoe.github.io/meridian/) runs in your browser with no
account and nothing to install. Try it and tell me what works and what doesn't — the best
place for that is a [GitHub issue](https://github.com/realJohnDoe/meridian/issues). The
code lives in the [same repository](https://github.com/realJohnDoe/meridian).
