A. Origin & motivation (the "why")

1. What was the specific moment or frustration that made you start building Meridian? A concrete anecdote is gold for an opener.

   I already had thought about having tasks, notes and calendar events as markdown files for a few years, basically since I used Obsidian. I already started a first prototype (https://realjohndoe.github.io/idea-craft/) in spring 2025 but then realized there is the TaskNotes plugin for Obisidian, which I used for a year now. However, I felt like the mobile UX of it never came close to the one of e.g. Google Calendar or Todoist, mostly because Obsidian is built for notes and tasks and events are kind-of second class citizen. This spring, I realized the Claude mobile app can create html/js websites quite well and I started experimenting with a second prototype, using markdown files in a directory on my phone. I iterated for nearly 100 versions on the markdown / yml schema and the web app in just that single Claude conversation. I think this is when I realized such an app might be feasible, switched it over to a proper React PWA and Claude Code for better maintainability.

2. Before Meridian, what was your actual setup? (e.g. Google Calendar + Todoist + Obsidian + …?) What broke about juggling them?

   Personally, I used Obsidian for notes, the TaskNotes plugin for my own tasks, Todoist for tasks shared with my wife, and Proton Calendar for events. However, I don't like Todoist being able to do whatever they want with my private data and Proton Calendar had some features missing that we need regularly, e.g. moving or cancelling single series occurrences. I really liked the wikilink in Obsidian and I am a big fan of tags, but I always wanted a system where tags are first class citizens, i.e. also notes that can have their own description and also tags. In Meridian, this turned into the 'everything is a list' mindset in the end.

3. Was there a particular thing that no existing tool did — the one feature that justified building from scratch rather than adopting an existing app?
4. Who is Meridian for — just you, or a specific kind of person? Who did you have in mind?
5. How long have you been using it yourself, and what do you use it for day-to-day now?

B. Product

6. If you had to explain Meridian to a friend in one sentence (not the README tagline), what would you say?
7. The README calls it "a calm calendar." What does calm mean to you here — what did you deliberately leave out to keep it calm?
8. What's the single most-used feature for you personally?
9. What's a workflow in Meridian that would feel impossible or clumsy in Google Calendar / Todoist?
10. Is Meridian "done," or what's the current rough edge you're most aware of?

C. Philosophy

11. The README's first principle is "different concepts, different lifespans." Where did that idea come from — did you discover it while building, or start with it?
12. "Lists model hierarchies" and "a task is a list with a done property" is a genuinely unusual mental model. How would you defend it to a skeptic who thinks it's over-abstraction?
13. Why Markdown specifically, over a database or JSON or a proprietary format? What's the emotional core of "it's yours"?
14. Have you ever actually needed the "read the file to debug it" property in real life? A story here would land well.
15. How much does the "LLM-friendly format" angle matter to you personally vs. it being a nice bonus? (I'll weight it accordingly.)
16. Do you see Markdown-first as a philosophical/ethical stance (data ownership, longevity) or a practical one (sync, tooling)? Or both?

D. Architecture

17. Meridian is a client-only PWA with no server holding data — was that a deliberate principle from day one, or a discovery?
18. The "each item is its own file, so conflicts only happen on the same item" point — how important is that in practice? Have you hit real conflicts?
19. Why GitHub-as-a-backend? That's an unusual choice — what made it click?
20. What was the single hardest architectural problem to get right? (recurrence? sync? the occurrence model?)
21. The recurrence model sounds deep. Why did you invest so much there — was existing recurrence really that bad?
22. Anything about the architecture you're quietly proud of that a normal user would never notice?
23. Are there architectural trade-offs you consciously accepted (e.g. no server means no X)?

E. Features

24. Of the feature list, which three would you put on the article's "highlight reel," and which are just table-stakes?
25. Wikilinks-between-entries: is this central to how you think, or a power-user nicety?
26. Participants/filtering — is Meridian meant to be used collaboratively, or is that for personal "who's involved" tracking?
27. Offline-first + installable: how much does "feels like a native app" matter to the pitch?
28. Is there a feature you're tempted to show off that most people won't initially understand the value of?

F. Comparisons & positioning

29. The README compares to Obsidian+TaskNotes, Google Calendar, Todoist, etc. In the article, do you want to lean into comparisons or mostly stand on your own?
30. You concede Obsidian wins at note-taking. How honest/humble do you want the article's tone to be about what Meridian doesn't do?
31. What's the one misconception you expect readers to have that you'd like to preempt?

G. Tone, framing & logistics

32. Who's the audience for the article — developers, productivity nerds, potential users, Show HN / Hacker News crowd? This shapes vocabulary and depth.
33. First person "I" or "we"? (README uses "we" in places.) Which do you want?
34. What do you want a reader to do or feel by the end — try it, star the repo, rethink their tools, or just "huh, neat"?
35. Any tone to emulate or avoid? (e.g. earnest indie-hacker, dry/technical, playful, manifesto-ish.) Any writers/posts whose style you like?
36. Is there anything true about Meridian that the README doesn't say that you want in the article?
