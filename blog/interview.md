A. Origin & motivation (the "why")

1. What was the specific moment or frustration that made you start building Meridian? A concrete anecdote is gold for an opener.

   I already had thought about having tasks, notes and calendar events as markdown files for a few years, basically since I used Obsidian. I already started a first prototype (https://realjohndoe.github.io/idea-craft/) in spring 2025 but then realized there is the TaskNotes plugin for Obisidian, which I used for a year now. However, I felt like the mobile UX of it never came close to the one of e.g. Google Calendar or Todoist, mostly because Obsidian is built for notes and tasks and events are kind-of second class citizen. This spring, I realized the Claude mobile app can create html/js websites quite well and I started experimenting with a second prototype, using markdown files in a directory on my phone. I iterated for nearly 100 versions on the markdown / yml schema and the web app in just that single Claude conversation. I think this is when I realized such an app might be feasible, switched it over to a proper React PWA and Claude Code for better maintainability.

2. Before Meridian, what was your actual setup? (e.g. Google Calendar + Todoist + Obsidian + …?) What broke about juggling them?

   Personally, I used Obsidian for notes, the TaskNotes plugin for my own tasks, Todoist for tasks shared with my wife, and Proton Calendar for events. We also use Google Keep for shopping lists. However, I don't like Todoist and Google being able to do whatever they want with my private data and Proton Calendar had some features missing that we need regularly, e.g. moving or cancelling single series occurrences. I really liked the wikilink in Obsidian and I am a big fan of tags, but I always wanted a system where tags are first class citizens, i.e. also notes that can have their own description and also tags. In Meridian, this turned into the 'everything is a list' mindset in the end.

3. Was there a particular thing that no existing tool did — the one feature that justified building from scratch rather than adopting an existing app?

   First, As mentioned above in 2: Tags as first class citizens.
   Second, I found it surprisingly hacky to have a calendar for our child without requiring a separate account for her. I am not aware of any system that allows this. I wanted something closer to a paper calendar where everyone can edit all events, and see what other family members plan. This is very similar to an issue I also encounter at work with Outlook regularly: A series event is created by one team member, which goes on vacation and then the event cannot be edited by someone else. I wanted to try how a system feels where calendar events are just shared documents, not owned by a single person.
   And third, I have some events that appear multiple times but not following a strict schedule. Meridian just has an 'Add occurrence' button wher users can add a new occurrence to an existing items, not needing to follow any schedule.

4. Who is Meridian for — just you, or a specific kind of person? Who did you have in mind?

   People who like Obsidian but are not satisfied with it's mobile task / calendar capabilities.
   Teams / Families who trust each other enough to read and write their calendar / tasks.

5. How long have you been using it yourself, and what do you use it for day-to-day now?

   I started using it experimentally 2 months ago and am using it for tasks productively since 1 month, still fixing bugs and ironing out edges and corners regularly. For the calendar, we have not migrated away from Proton yet.

B. Product

6. If you had to explain Meridian to a friend in one sentence (not the README tagline), what would you say?

   That one is really hard because Meridian is really about the unique combination of mostly existing features. Maybe "It allows you to structure your tasks very flexibly by attaching them to multiple other items, like calendar events, notes, or other tasks". Or "it allows you to manage tasks and calendar events from a single place without giving up privacy" (like you have to when using Google Calendar)
   Thinking about 3, maybe 'The Todo / calendar app that adapts to how you think'?

7. The README calls it "a calm calendar." What does calm mean to you here — what did you deliberately leave out to keep it calm?

   I did not think about this concretely yet. But I think avoiding switching between different apps contributes to it. I also like to have it as a guideline for the UI style. Part of it is also that I like to run it as an open source project and not as a paid product which might require some more aggressive branding.

8. What's the single most-used feature for you personally?
   1. Quickly adding a task.
   2. Adding a task to a list / an event.

9. What's a workflow in Meridian that would feel impossible or clumsy in Google Calendar / Todoist?

   We have a list called 'This Week' where we put tasks that we don't want to schedule on a specific day yet but aim to close them this week. Sometimes, those tasks also belong to another list. For example, we would like to cook Pizza this week, so 'Pizza' will be a task that is linked on both 'Cooking' and 'This Week'. The only other system which can model this are tags, but then we are back to my point above regarding tags as first-class citicens.
   See also 3 for some more examples.

10. Is Meridian "done," or what's the current rough edge you're most aware of?

    It is 'mostly feature-complete'. There are a few things like file retention periods, other storage options, or using color for participants instead of types / priorities but mostly it is about bugfixing now.
    I am also thinking about multi-vault support or iCal import / sync.

C. Philosophy

11. The README's first principle is "different concepts, different lifespans." Where did that idea come from — did you discover it while building, or start with it?

    I noticed the parallels between task scheduling and calendar events, and was wondering why no existing app except Google Calendar exploits this.
    Of course, Obsidian and it's TaskNotes plugin also contributed to this way of thinking and showed me how much can be done with just markdown + frontmatter yaml.
    Ny strong Python background with it's duck typing probably also contributed unconsciously.

12. "Lists model hierarchies" and "a task is a list with a done property" is a genuinely unusual mental model. How would you defend it to a skeptic who thinks it's over-abstraction?

    When I started Meridian, I supported tags and had wikilink tags, which implemented the 'tags as first-class citizens' mentioned above.
    I also found backlinks are a feature that is underexplored so far, so each page had a prominent backlink section at the bottom.
    But this raised the question: Since wikilink-tags are usually more important than just wikilinks inside the description, should they both appear in the backlink section? Should they be visually separated?
    And I thought: Maybe some users don't even know about wikilinks and backlinks yet and to them, those might be quite abstract concepts. On the other hand. Everybody knows lists and has used them.
    So why not just say: Everything is a list and instead of tags, we display all the lists an item is listed on. This is what Meridian does now.

    Futhermore, Most Todo Apps have some notion of projects or subtasks. Lists are just a generalization of such hierarchies, which do not require you to answer the question "Is this a task, a subtask or a project". You only need to answer the question "Is this done at some point and do I want to track if its done?" which I find more pragmatic.

13. Why Markdown specifically, over a database or JSON or a proprietary format? What's the emotional core of "it's yours"?

    I always found markdown hits quite a sweet spot between technical systems and being user-friendly and even understandable to non-techies.
    Obsidian showed me how much can be done with just markdown.
    There is just some elegant and pragmatic charme about being able to open a file and understand it, without requiring some special program to open a database.
    And with AI and LLMs now all over the place, markdown seems to become even more important.

14. Have you ever actually needed the "read the file to debug it" property in real life? A story here would land well.

    Yepp, a lot. Meridian's recurrence schema is quite sophisticated, and because all the code was written with AI, there were a lot of bugs to hunt down.
    A handful of times, I just told Claude "Here is the file, here is what Meridian does and here is what should happen instead".
    Such a starting point makes debugging quite easy.
    I even wrote a separate debug page to visualize how the yaml is converted to repeat patterns and single occurrences, and how the repeat patterns are expanded.
    For example, in the beginning, moving occurrences to different times did not work properly, cancelling occurrences sometimes did not work, or an expansion would end on the wrong date.
    As mentioned, there were _many_ bugs.

15. How much does the "LLM-friendly format" angle matter to you personally vs. it being a nice bonus? (I'll weight it accordingly.)

    It is more of a nice bonus.

16. Do you see Markdown-first as a philosophical/ethical stance (data ownership, longevity) or a practical one (sync, tooling)? Or both?

    I think longevity and data ownership are practical stances: Once the owner of the platform starts to monetize it in ways that you don't like, lock-in becomes a real problem.
    And history tells us this happens sooner or later for most platforms.

D. Architecture

17. Meridian is a client-only PWA with no server holding data — was that a deliberate principle from day one, or a discovery?

    I wanted to give users control over their data and so a heavy backend is not needed if not contradictory to that.
    So yes, I pushed in that direction from day 1 and really tried to get away completely without a backend but learned that you cannot do really safe authentication without a slim one.

18. The "each item is its own file, so conflicts only happen on the same item" point — how important is that in practice? Have you hit real conflicts?

    Yes, even with each item in it's own file, I hit conflicts several times.
    The persistence / caching code is still one of the weakest parts of the code base.
    So I think it actually makes the app more robust.
    And, I think it also is really nice philosophically: One concept per file, the same way that Obsidian works and curiously also similar to Googles new open knowledge format.

19. Why GitHub-as-a-backend? That's an unusual choice — what made it click?

    I wanted some way to get a 'password protected directory' that is somewhat userfriendly to set up even for non-techies, so I stayed away from some S3 bucket or so.
    It was surprisingly hard to find a solution because all solutions either have coarse-grained access permissions where Meridian would get access to almost all of the users permissions on that system, e.g. with Google Drive,
    or there were password protected folders but those were not available via API.
    In the end, the best contenders were GitHub, Dropbox and Microsoft OneDrive. See also ./storage-backend-survey.md for more details.

20. What was the single hardest architectural problem to get right? (recurrence? sync? the occurrence model?)

    I think caching is still the weakest point.
    We have Zustand for some UI caches (please correct me if I got this wrong), and a DexieDB to cache file content while we are not synced with the storage backend.
    Together with the storage backend and React states, that makes for 4-5 layers of state that need to sync correctly.
    This produced many bugs and I am still not fully confident that I wont find some more.

21. The recurrence model sounds deep. Why did you invest so much there — was existing recurrence really that bad?

    The industry standard is iCal (RFC 5545).
    I just found that the rdate and rrule strings are really hard to parse inside a yml frontmatter for a non-techie.
    But if compatibility with iCal turn out to be showstoppers, I am all fine with adding support for it or even completely migrating to it.

22. Anything about the architecture you're quietly proud of that a normal user would never notice?

    I took particular care of making dependencies local, i.e. trying to put closely connected code in the same directory, nest low-connected code deeper in directories and put code that couples to a lot of places higher in the directory hierarchy.
    This results in a quite intuitive code structure from my experience.
    I also ran some AI health surveys regularly, see e.g. ./health-survey.md.
    These uncovered a lot of problems and improved the architecture a lot over time.

23. Are there architectural trade-offs you consciously accepted (e.g. no server means no X)?

    I think the biggest one is the design decision to only link against files, not against single occurrences, because inventing a link format for single occurrences felt too hacky.
    The difference between a file and an occurrence is something that reappears multiple times through the app, e.g. the editing scopes, the file to occurrence map used to decide which occurrence to show in the UI etc.
    I accepted this friction because showing all occurrences for a file to the user seemed like an even worse idea.
    Maybe, I will find a way to resolve this in the future, but for now, the compromise holds up quite well I would say.

E. Features

24. Of the feature list, which three would you put on the article's "highlight reel," and which are just table-stakes?
    1. Seamless work across Tasks, Calendar Events, and Notes
    2. Everything stored as Markdown w/ frontmatter, under your control
    3. Everything is a list allows for flexible hierarchies where needed

25. Wikilinks-between-entries: is this central to how you think, or a power-user nicety?

    From my experience, wikis and knowledge bases rise and fall with how good they are interlinked.
    So having a very quick way to link other pages, such as wikilinks, is quite valuable.
    I also think that links / dependencies are the starting point of structure and often help to derive a good hierarchy.
    I think many people start with a hierarchy too early because they think they need to use one where just linking is often enough and building hierarchies before knowing what is tightly connected often results in bad structures.
    I am just not a super big fan of the double square bracked syntax on mobile.
    Maybe I will add an '@' alternative so wikilinks are easier to create in the description fields.

26. Participants/filtering — is Meridian meant to be used collaboratively, or is that for personal "who's involved" tracking?

    Kind-of, but without requiring an account for everybody. I imagine it like a shared calendar wall or family calendar where everyone can edit everything, still it is useful to know who will take part where.
    Similar to how we also collaborate on other artifacts like presentations or text documents.

27. Offline-first + installable: how much does "feels like a native app" matter to the pitch?

    The Mobile UX is definately one of the key USPs and why I switched away from Obsidian+Tasknotes.
    The PWA approach is mostly due to maintaineability: I need iOS and Android support and the DevOps effort with native apps would be much higher.
    I definately want the app to feel as native as possible, meaning fast and with good UX.

28. Is there a feature you're tempted to show off that most people won't initially understand the value of?

    I think mostly the using lists for hierarchies: You can create a task for a project whose items are tasks in that project, and those can have subtasks (items) on their own.
    Another use is to have lists that are by time.
    For example, we have a 'This week' list where we put stuff that we want to do this week but don't want to commit to a specific day yet.
    Items on that list can still be on a topic list, e.g. 'Cooking'.
    A strict hierarchy would not allow for such things.

F. Comparisons & positioning

29. The README compares to Obsidian+TaskNotes, Google Calendar, Todoist, etc. In the article, do you want to lean into comparisons or mostly stand on your own?

    I think it makes sense to mention that I took inspiration from them, especially Obsidian for the whole markdown / frontmatter idea and Google calendar for Task/Calendar UX.
    But I don't want to dig into those comparisons deeply.

30. You concede Obsidian wins at note-taking. How honest/humble do you want the article's tone to be about what Meridian doesn't do?

    I want it to be honest. I don't want to oversell Meridian, but still position it as a strong contender.
    My goal was not to write a better note-taking app, but to extend Obsidians strenghts beyond note into the Todo/Calendar mobile app territory.

31. What's the one misconception you expect readers to have that you'd like to preempt?

    Oh, just another geeky productivity app written from a Software Engineer.

G. Tone, framing & logistics

32. Who's the audience for the article — developers, productivity nerds, potential users, Show HN / Hacker News crowd? This shapes vocabulary and depth.

    I think the main target audience will be existing Obsidian Users and Software Developers.

33. First person "I" or "we"? (README uses "we" in places.) Which do you want?

    I makes more sense, since I worked alone so far, only with Claude. But Claude is a tool, so I don't want to anthropomorphize it.

34. What do you want a reader to do or feel by the end — try it, star the repo, rethink their tools, or just "huh, neat"?

    I would like users to try it out and let me know what they like and dislike about it.
    Probably, the Tutorial also needs some rework either before or after the first feedback comes in.

35. Any tone to emulate or avoid? (e.g. earnest indie-hacker, dry/technical, playful, manifesto-ish.) Any writers/posts whose style you like?

    I don't want to sound too smart, like "Here is the better productivity app because of my philosophical reasons"

36. Is there anything true about Meridian that the README doesn't say that you want in the article?

    I think the philosophy points capture the important part pretty well.
    I mostly want the article to tell a story, not just document Meridian.
