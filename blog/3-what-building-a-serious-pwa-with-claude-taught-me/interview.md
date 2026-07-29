# Interview: What building a serious PWA with Claude over 600 PRs taught me

Answer inline under each question. Brevity is fine — a phrase, a story, or "skip"
is all useful. Rough notes beat polished sentences; I'll do the shaping.

Scope note: article 1 already covers the origin, the phone prototype, the data
model, the storage-backend hunt, and the caching layers. This article is about
_how the building actually went_ — so I'll only revisit those where the process
is the point.

The five marked ★ decide what kind of article this is. If you answer nothing
else, answer those.

---

## A. The workflow

1. Describe a typical session start to finish — what does your first message
   usually look like? And how does something get from "annoyance while using the
   app" to a merged PR? (`plans/next-steps.md` shows up in most of the 344
   direct-to-main commits — what is that file to you?)

2. You use git worktrees. When did that start, what problem did it solve, and do
   you run Claude sessions in parallel?

3. What share of the 604 PRs contain a line you typed by hand? And how do you
   review — every diff, a skim, trust the tests, or only when something breaks?

4. When Claude's first attempt is wrong: correct it, restart the session, or take
   over yourself? Has that instinct changed over the two months?

5. Is there a kind of task you've learned to _never_ hand over?

---

## B. The PR discipline

6. 604 PRs in 68 days, median 3 files and 73 lines. Deliberate, or emergent? And
   what is the PR boundary actually _for_ when there's no reviewer on the other
   side and you merge your own work?

7. Your commit messages are unusually thorough — root cause, mechanism, why the
   fix is shaped that way. Who is that written for?

8. Did you ever try the opposite — one giant "build me feature X" session? What
   happened?

9. A PR you're proud of because you couldn't have gotten there alone (or not in
   that time) — and one you should have refused?

---

## C. The quality machinery

10. Testing barely existed for the first month (2 test-tagged PRs), then jumped to
    31. What happened around June 4th?

11. ★ Build and tooling PRs nearly quadrupled in the second half (15 → 57):
    type-aware lint, knip, coverage floors, the React Compiler,
    `noUncheckedIndexedAccess`. My read is that you built a **ratchet** — each rule
    you enable is a class of mistake Claude can't make again. Is that how you think
    about it, or am I projecting? And was it a plan or a reaction to being burned?

12. The health surveys (architecture, UI, performance, data integrity) are the most
    distinctive thing in your process. Where did the idea come from, what did the
    first one turn up, and do they find things you'd never have found yourself?

13. ★ CLAUDE.md reads like scar tissue — pnpm not npm, don't use `gh` for PRs, lint
    needs generated types first, TypeScript pinned below 7. Is each line a
    remembered failure? Which one cost you the most before you wrote it down?

14. You verify empirically rather than by reasoning — device traces over ADB for
    the swipe carousel, a logger tapped into the real Vite pipeline to prove the
    compiler was skipping a component. Habit you brought, or one this way of
    working forced on you?

---

## D. Limits and failure modes

15. Where did Claude repeatedly fail in ways you learned to anticipate? Which
    problems stayed hard no matter how you prompted?

16. 49 PRs are tagged rework, 8 are reverts, and some are real sagas: the date
    picker went Dialog → Sheet → Drawer, the combobox portaled → inline → portaled,
    the swipe carousel CSS scroll-snap → Embla. Is that churn the cost of this
    workflow, or just what building UI is like?

17. ★ Bugs roughly doubled in month two (66 → 118) while features slowed. What's
    the honest read — accumulating debt, harder problems, more usage surfacing more
    bugs, or AI code aging badly? Last time you said "because all the code was
    written with AI, there were a lot of bugs to hunt down" — do you still think
    the AI authorship _caused_ that, and compared to what baseline?

18. Was there a moment you lost trust in the code — where you didn't know whether
    something worked and couldn't easily find out? What's the worst thing that
    reached main, and did anyone ever lose data?

19. Do you understand your own codebase? Could you fix a sync bug at 2am without
    Claude? Does the code have an "AI-shaped" quality — patterns a human wouldn't
    have written, in good ways or bad?

---

## E. Productivity, honestly

20. ★ The claim people want: how much faster was this than building it by hand?
    Give a number you'd actually defend — and say what it's a number _about_.

21. How many hours a day did this really take, and over what — evenings, weekends,
    holiday? What did it cost in money, and did that shape any decision?

22. What was the actual bottleneck? If Claude were twice as fast tomorrow, would
    the project have gone twice as fast? And where did AI make you _slower_ — time
    a solo human wouldn't have spent at all?

23. Two months in: asset or liability? Would you rather maintain this codebase or
    20k lines you wrote yourself? And did the workflow change how ambitious you
    were — recurrence engine, six themes, an OAuth worker, a virtualized agenda?

---

## F. Lessons

24. If a competent engineer asked "how do I do what you did" — three things you'd
    tell them, and one thing you'd tell them not to bother with? What did you
    believe in May that you no longer believe?

25. What surprised you most, good or bad? Is there a project shape this workflow is
    _wrong_ for? Would you do it again the same way?

---

## G. Framing

26. ★ Who's the reader, what's the one sentence they should leave with, and how
    much of a counterweight do you want against the "AI 10x'd me" genre — where do
    you actually sit, booster to skeptic? Should the numbers be the article's spine
    or colour alongside the narrative? Anything none of these asked about?
