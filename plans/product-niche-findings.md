# Product Niche Fit & Positioning — Findings

Findings from a survey run against [product-niche-survey.md](product-niche-survey.md).

## 1. Niche verdict

**Declared niche** — someone with scattered productivity apps who wants a calm, all-in-one calendar/tasks/notes app on plain Markdown, instead of Google Calendar + Todoist + Keep. **Revealed niche** — an Obsidian user who lives on their phone, already has a GitHub account, and wants tasks and calendar to be first-class rather than plugin-mediated; instead of Obsidian + TaskNotes. **Served niche** — that same person, *provided* they use GitHub (the local-folder path is desktop-Chromium-only and mis-advertised), and are willing to retype their existing calendar because there's no iCal import.

The **fit is genuinely good** — the product invests exactly where the revealed niche needs it (`model/` 6,534 lines of recurrence depth, `editor/` 6,981, 16 files carrying swipe handling, `vaul` drawers, a 768px single column that never pretends to be a desktop app) and it honours its stated non-goal of out-noting Obsidian. **The communication is where it comes apart.** The widest gap is **declared vs. revealed**: every surface that a visitor reads first describes a general-audience app, while every surface built from the product's own effort — the palette, the eight-theme picker, the setup path, the founder's own blog — describes an Obsidian-adjacent power user. The word `mobile` appears **once** in the entire README, in a table cell 83% of the way down, despite the author writing `Mobile is where this is decided.` and calling it `the biggest single reason I eventually built something of my own`.

**The single change that closes the most gap:** replace the README's first screen — headline plus one "who this is for" line plus the comparison table — so the Obsidian-user-on-a-phone recognises themselves and the mobile wedge leads, instead of arriving after 41 lines of philosophy and a 52-line YAML reference.

## 2. Coverage statement

**Cold-read first impressions** (recorded before any code):
- *What is this?* A web app storing calendar/tasks/notes as Markdown files.
- *Who for?* People who already know what "YAML frontmatter" means. I inferred Obsidian users, but from the format vocabulary, not from anything the page said.
- *Instead of what?* **I could not place it until line 149** — the comparison table. Before that I was guessing "self-hosted Notion" or "an Obsidian plugin replacement."
- *Keep reading?* Yes, but I skimmed principles 1–2 and the entire 52-line entry-format section. The philosophy arrives before I know whether it's for me.

**Read completely:** `README.md`, `blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md`, `blog/1-…/interview.md`, `src/onboarding/CoachTour.tsx`, `src/storage/exampleBackend.ts`, `src/types.ts`, `index.html`, the VitePWA manifest, `src/components/AddVaultWizard.tsx`, `public/icon.png`, `plans/next-steps.md`, theme tokens in `src/index.css`.

**Walked live:** the example vault at mobile (375×812) and desktop (1280×800) width on a worktree-specific server (port 5202), reading layout geometry and computed tokens from the DOM.

**Two limitations, stated up front.** (a) **Screenshots were unavailable** — the Browser pane wasn't compositing frames, so the "blind visual read" was reconstructed from computed CSS, DOM geometry, and the icon file rather than from pixels. Colour, density, layout width, and theme are all verified by measurement; *feel* is not. (b) As anticipated, the automated browser **cannot complete GitHub OAuth or grant File System Access permissions**, so the real setup path was assessed from code and copy only.

**Comparison-table claims verified:** Obsidian's open-source status (**refuted the README's claim**); TaskNotes' recurrence capability (**the "Limited" rating is contestable**); TaskNotes' license (MIT, open source); `showDirectoryPicker` browser support (Chrome for Android **does not** expose it). **Not verified:** the Todoist, Google Keep, Google Calendar, and GitHub Issues rows — out of the bounded scope and none looked obviously wrong.

**Suspects returning refutations (from the survey's now-removed "Known suspects" list):** the estimate that "calm" appears `~14×` in the UI source is wrong — it appears **0 times in `src/`** and exactly once in the whole product, in the README headline. The urgency-cue suspect is **largely refuted**: overdue uses amber `--warning: oklch(0.86 0.16 74)`, not the rose `--destructive`; there are no streaks, counts, or nagging empty states. The visual character *is* restrained. The problem turned out to be structural placement, not colour (finding #3). Also refuted: `plans/next-steps.md` no longer contains `Post about Meridian in Obsidian forums` — market contact remains un-made *and* has dropped off the roadmap entirely.

**Unverified, flagged:** whether the LLM-friendliness angle attracts a real audience — nothing in the repo can settle this; only a forum post could. Whether "Limited" for TaskNotes recurrence was accurate when written — settled by checking TaskNotes' changelog against the README's git blame.

**Handed to the UI survey (consistency, not positioning):** `src/index.css:117` comments the backdrop as `/* html bg behind the 430px column */`, but the live desktop column measures **768px** (`lg:max-w-3xl`); `src/components/ui/drawer.tsx:27` repeats the stale `430 px`.

**Out of scope, recorded not pursued:** any market sizing, competitor research beyond the six named products, and the four unverified table rows.

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Niche fit | **clean** — walked; investment matches the revealed niche, non-goals honoured. Contributes evidence to #2, #4 |
| 2 | Niche recognition | **findings: #2, #3, #4** |
| 3 | Visual identity & aesthetic fit | **findings: #2** (evidence); character-vs-promise assessed and largely **confirmed as working** |
| 4 | Differentiation & alternatives | **findings: #4, #5** |
| 5 | Audience selection | **findings: #2** |
| 6 | Adoption gates | **findings: #1, #3** |
| 7 | Niche drift & emerging signals | **findings: #1** (prototype-era error copy); LLM angle assessed — see decisions |

## 4. Findings — top 5

| # | Finding | Gap | Question | Model |
|---|---|---|---|---|
| 1 | Local-folder support is claimed four different ways and dead-ends on Android | declared-vs-served | both | Sonnet 5 |
| 2 | The real beachhead is visible in every pixel and named in no copy | declared-vs-revealed | communication | Opus 5, plan mode |
| 3 | The app deliberately opens on your overdue backlog | declared-vs-revealed | both | Opus 5 |
| 4 | "Great mobile UX" is the lead differentiator and appears once | declared-vs-revealed | communication | Opus 5, plan mode |
| 5 | The comparison table's open-source row is backwards | declared-vs-served | communication | Haiku 4.5 |

**Sequencing note.** #2 and #4 are the same decision seen twice — who the beachhead is, and which differentiator leads — and both rewrite the README's opening. **Decide those together, before touching any copy.** #5 edits one table cell and is safe to do immediately. #1 and #3 touch code and fixtures, independent of the positioning decisions.

---

### #1 — Local-folder support is claimed four different ways, and dead-ends on Android

- **Gap** declared-vs-served · **Question** fit + communication · **Category** `adoption-gate` `proof` `identity`
- **Who it costs us** Anyone who picks "Local folder" on a phone — and it is preselected by default (`useState<Source>('local')`). Every mobile arrival who prefers not to use GitHub hits this, which on a mobile-first product is a large share.
- **Impact** 7 · **Breadth** 4 surfaces, 8 sites (searched: `README.md`, `AddVaultWizard.tsx`, `exampleBackend.ts`, `fs.ts`)

**Evidence — four mutually inconsistent claims:**

> `Supported in Chrome and Edge only — not available on iOS or Firefox.` — [README.md:74](README.md:74)

> `local folder access requires a Chromium-based browser` — [README.md:174](README.md:174)

> `'Use a folder on this device. Works in Chrome and on Android; not supported on iOS or Safari.',` — [src/components/AddVaultWizard.tsx:20](../src/components/AddVaultWizard.tsx:20)

> `**Heads-up on storage:** the **local folder** backend works only in Chromium browsers` / `(Chrome, Edge) on desktop.` — [src/storage/exampleBackend.ts:386](../src/storage/exampleBackend.ts:386)

The wizard says Android works; the example vault says desktop only. **The wizard is wrong** — Chrome for Android does not expose `showDirectoryPicker`. And the failure message is prototype-era copy that survived the rewrite from the single-HTML-file phone prototype into a React PWA served from GitHub Pages:

> `throw new Error('Your browser does not support folder access. Use Chrome or Edge, and open this file directly (not in a preview).')` — [src/storage/fs.ts:84](../src/storage/fs.ts:84)

An Android Chrome user is told the option works, taps it, and is told to use Chrome (they are) and to "open this file directly" (there is no file). That is a dead end at the exact moment of adoption.

- **Recommended model** **Sonnet 5.** Mechanical once the truth is established, but the hazard is a confident rewrite that unifies the four claims on the *wrong* one — the in-app string is the most prominent and the most incorrect. The fix must also decide whether to preselect GitHub (which the README already stars as recommended) and must rewrite `fs.ts`'s two prototype-era errors. Haiku 4.5 would suffice if the task specifies the correct support matrix and the preselection decision.
- **Problem** A mobile user is invited into a storage path their browser cannot run, then given impossible advice.
- **Fix** Establish one support statement (desktop Chromium only), propagate it to all four surfaces, feature-detect `showDirectoryPicker` to disable or hide the local option when unsupported, preselect GitHub, and replace both `fs.ts` error strings with PWA-appropriate text.

---

### #2 — The real beachhead is visible in every pixel and named in no copy

- **Gap** declared-vs-revealed · **Question** communication · **Category** `niche-definition` `recognition` `visual-language` `audience-selection`
- **Who it costs us** The Obsidian-user-on-a-phone — the single person most likely to convert — who reads a generic three-category headline and doesn't realise this was built for them. Also the inverse cost: a Google Keep user who *is* attracted by the headline and cannot use the product. Affects ~100% of README arrivals.
- **Impact** 9 · **Breadth** 6 surfaces (searched: `README.md`, `index.html`, `vite.config.ts` manifest, `CoachTour.tsx`, `SettingsDialog.tsx`, `index.css`)

**Evidence — the copy is category-generic:**

> `**A calm calendar, task manager, and notes app built on plain Markdown files.**` — [README.md:3](README.md:3)

The same sentence is the `<meta name="description">`, the OG description, and the PWA manifest description. The one line that names the beachhead sits at line 162 of 181:

> `If you're already an Obsidian user, Meridian's vault format will feel immediately familiar.` — [README.md:162](README.md:162)

**The product evidence says it far more loudly.** The theme picker is user-facing text, and seven of its eight entries are code-editor colourschemes:

> `{ id: 'catppuccin-latte', … }, { id: 'catppuccin-mocha', … }, { id: 'dracula', … }, { id: 'meridian', … }, { id: 'rose-pine-dawn', … }, { id: 'solarized-dark', … }, { id: 'solarized-light', … }, { id: 'tokyo-night', … }` — [src/components/SettingsDialog.tsx:26](../src/components/SettingsDialog.tsx:26)

The palette says it in its own comment, and the default theme (`defaultTheme="meridian"`, [src/routes/__root.tsx:79](../src/routes/__root.tsx:79)) is a measured `oklch(0.18 0.05 252)` deep blue-black:

> `--primary-foreground: var(--ink-dark);        /* near-black ink, like tokyo-night/dracula — reads better on our light pastel accents than white */` — [src/index.css:136](../src/index.css:136)

The icon is a neon violet-to-gold ring on near-black, carrying no calendar affordance at all. And the author already knows the answer — it is in an interview file that ships in the repo but reaches no visitor:

> `People who like Obsidian but are not satisfied with it's mobile task / calendar capabilities.` — [blog/1-…/interview.md](../blog/1-meridian-why-i-built-a-markdown-first-calendar/interview.md)

> `the readers I care about first are developers, and they already have a GitHub account they trust` — [blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md:214](../blog/1-meridian-why-i-built-a-markdown-first-calendar/meridian-why-i-built-a-markdown-first-calendar.md)

**This is a case where the visual identity is right and the copy should catch up.** The palette, themes, icon, and GitHub-first setup path are coherent, distinctive, and correctly aimed. The copy is the only surface aiming elsewhere. Also absent from every surface: the shared-family-calendar-without-accounts idea, which the author names as reason #2 for building the product (`everyone on the same kitchen calendar, no accounts required.` — blog line 133).

- **Recommended model** **Opus 5 in plan mode, for a plan spanning multiple PRs.** This changes who the product is for — the user's decision, not the model's. The hazard is a rewrite that broadens the headline until it selects nobody, or that commits to "for Obsidian users" and forfeits every non-Obsidian arrival. The plan should lay out the beachhead options and their consequences and stop short of picking.
- **Problem** The visitor most likely to convert cannot tell the product was built for them, and the visitor least likely to succeed is the one the headline attracts.
- **Fix** Present options for a "who this is for" line above the fold — (a) explicitly Obsidian-adjacent, (b) "Markdown vault owners" as a wider frame, (c) lead with the family/no-accounts angle — with the trade-off each makes, and route the choice to the user.

---

### #3 — The app deliberately opens on your overdue backlog

- **Gap** declared-vs-revealed · **Question** fit + communication · **Category** `aesthetic-fit` `recognition` `identity`
- **Who it costs us** Every first-time visitor to the example vault — the only try-before-committing path, so effectively 100% of people who open the app.
- **Impact** 8 · **Breadth** 3 surfaces (`agendaSections.ts`, `exampleBackend.ts`, `README.md` headline)

**Evidence — this is by design, not accident:**

> `// goToday scrolls to the overdue section when there is one, else to today.` — [src/calendar/agendaSections.ts:331](../src/calendar/agendaSections.ts:331)

Its own test asserts the landing target is the backlog, not today:

> `expect(sections[goToIndex]).toBe(findOverdue(sections))` — [src/calendar/agendaSections.test.ts:72](../src/calendar/agendaSections.test.ts:72)

The section is uncapped: `pools every undone past task with no cap` ([agendaSections.ts:31](../src/calendar/agendaSections.ts:31)).

**Measured live** at 375×812 on the example vault, first run: the `Overdue` divider renders at **y=114** and `Today` at **y=490** — roughly **46% of the first screen is a backlog**, above today, containing four items. This is against a headline promising:

> `**A calm calendar, task manager, and notes app built on plain Markdown files.**` — [README.md:3](README.md:3)

And the visitor cannot clear them, because:

> `This is a read-only sandbox — poke around freely.` — [src/storage/exampleBackend.ts:79](../src/storage/exampleBackend.ts:79)

The demo's four overdue items are a fixture artifact: the `instances` marking occurrences done are pinned to `prevWeekday(MON, 1)` / `prevWeekday(WED, 1)`, a week *before* the series anchor `lastWeekday(MON)`, so every occurrence between the anchor and today accumulates unresolved.

To be clear on what is *not* wrong: the colour choice is restrained (amber `--warning`, not the rose `--destructive`), and there are no counts, badges, or streaks. The character problem is structural placement, not visual noise.

- **Recommended model** **Opus 5.** The fixture half is trivial, but the landing-position question is a genuine product-character decision — a completion-focused tool rightly opens on what you're behind on; a *calm* one may not. The hazard is "fixing" the demo fixture while leaving real users landing on their backlog, or changing the landing behaviour for everyone without deciding whether calm or completion is the intended character. Haiku 4.5 would suffice for the fixture alone if the task states that the landing behaviour stays as-is.
- **Problem** A product sold as calm greets every new visitor with a wall of unfinished work they are not permitted to clear.
- **Fix** Mark the demo vault's recent occurrences done so the example opens on Today; separately, decide whether real vaults should land on Today with overdue reachable above, rather than landing in the backlog.

---

### #4 — "Great mobile UX" is the lead differentiator and appears exactly once

- **Gap** declared-vs-revealed · **Question** communication · **Category** `differentiation` `recognition` `emphasis`
- **Who it costs us** The Obsidian + TaskNotes user evaluating whether to switch — the exact person the product was built to win — who never reads the one argument that would move them. ~100% of README arrivals.
- **Impact** 9 · **Breadth** 4 surfaces (`README.md`, `index.html`, manifest, blog — the blog is the only one that gets it right)

**Evidence.** `mobile` appears **once** in the entire README (verified by count), as row 1 of 10 equal-weight rows:

> `| Great mobile UX | ✅ | Partial | ✅ | Partial | ✅ | ✅ |` — [README.md:151](README.md:151)

A table where every row is a row asserts no priority — and three of the six competitors score ✅ on this one, so as presented it reads as table stakes rather than as the wedge. The blog states it as the thesis:

> `**Mobile is where this is decided.**` … `That gap is the biggest single reason I eventually built something of my own.` — [blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md:65](../blog/1-meridian-why-i-built-a-markdown-first-calendar/meridian-why-i-built-a-markdown-first-calendar.md)

**The product invests accordingly** — this is a real differentiator, not a claim: `vaul` drawers, swipe handling across 16 files, `useIsMobile` branching in 9, a PWA manifest, and a 768px single column at desktop width that never becomes a multi-pane desktop calendar.

**The emphasis map shows what displaced it** (measured, 181 lines total):

| Section | Lines |
|---|---|
| 📄 Entry format (YAML reference) | **52** |
| 💡 The ideas behind Meridian | **41** |
| 🙏 Inspiration and comparisons | 26 |
| ✨ What it does | 13 |
| 🗄️ Your data, your way | 13 |
| 🚀 Getting started | 10 |

51% of the README is philosophy plus a frontmatter schema reference. The lead differentiator gets one table cell at 83% depth.

- **Recommended model** **Opus 5 in plan mode, for a plan spanning multiple PRs.** Which differentiator leads is the user's call, and the hazard is sharpening "great mobile UX" into a claim the product cannot back against Google Calendar or Todoist — both of which the table itself scores ✅. Naming the approved lead claim would drop this to Sonnet 5.
- **Problem** The single strongest reason to switch from Obsidian + TaskNotes is buried where the evaluating reader never reaches it.
- **Fix** Move the comparison table above the philosophy sections and give the mobile claim a stated lead position — or, if mobile is not the chosen lead, decide explicitly what is.

---

### #5 — The comparison table's open-source row is backwards

- **Gap** declared-vs-served · **Question** communication · **Category** `differentiation` `proof`
- **Who it costs us** Obsidian users — precisely the beachhead — who know Obsidian's licensing and will read the error as either carelessness or spin. Anyone who reaches line 159.
- **Impact** 6 · **Breadth** 1 surface, 1 cell

**Evidence:**

> `| Free & open source | ✅ | Partially (core only) | ❌ | ❌ | ❌ | ❌ |` — [README.md:159](README.md:159)

**Verified and refuted, on both halves.** Obsidian's core application is proprietary and closed-source; its plugin and theme ecosystem is the open part. TaskNotes is MIT-licensed and open source. So the truthful cell is `Partially (plugin only)` — the exact inverse of what ships.

One adjacent row is contestable rather than wrong:

> `| Rich recurrence rules | ✅ | Limited | ✅ | ❌ | ✅ | ❌ |` — [README.md:157](README.md:157)

TaskNotes supports RFC 5545 RRULE strings with `DTSTART`, per-instance completion tracking, nth-weekday, count-limited *and* completion-based recurrence. "Limited" understates it, and completion-based repeat is something Meridian's own feature list claims as a differentiator (`"repeat N days after completion"`, README:57). Meridian's real recurrence edge is narrower and more specific: multiple series in one entry, and pinning arbitrary one-off occurrences.

- **Recommended model** **Haiku 4.5** — the corrected facts are established and cited here. The hazard the tier guards against (a row "corrected" without checking the competitor) is already retired for this cell. Re-rating the recurrence row would need Sonnet 5, since it requires deciding what claim Meridian can honestly make instead.
- **Problem** The beachhead audience catches a factual error about the tool they use daily, in the section meant to build trust.
- **Fix** Change the cell to `Partially (plugin only)`; separately, re-rate the recurrence row to a claim that survives a TaskNotes user's scrutiny.

## 5. PMF bets and what would test them

**This is not a PMF assessment and cannot be one.** There is no analytics, no telemetry, and no feedback path in the app; `.github/` contains only workflows; and `plans/next-steps.md` now reads in full: `Multi-vault support / iCal import`, `Add vault retention period`, `Fix flow for adding a second vault`. Market contact has not happened, and the item that would have caused it has dropped off the roadmap. What follows are the open questions the first real contact would settle.

**The bets.**

1. **Mobile is the wedge against Obsidian + TaskNotes.** *Confirms:* people describe switching specifically because capture-on-phone is faster. *Kills:* they say TaskNotes on mobile is fine and they'd rather keep their plugin ecosystem.
2. **One timeline for tasks, events, and notes is a benefit, not a muddle.** *Confirms:* users put all three in and stop opening a second app. *Kills:* they use it as a calendar only and keep Todoist.
3. **Plain files justify their setup cost.** *Confirms:* people complete GitHub connection and stay past week one. *Kills:* they try the example vault and never connect storage — the sharpest available signal, and currently unmeasurable.
4. **Recurrence depth matters to real schedules.** *Confirms:* unprompted mention of shifting or cancelling single occurrences. *Kills:* nobody uses anything past weekly, making the deepest-invested subsystem (`model/`, 6,534 lines) over-serving.
5. **"Everything is a list" is learnable fast enough to be worth it.** *Confirms:* users create nested entries without reading the tutorial notes. *Kills:* they ask "how do I make a project?" — the question the model is designed to eliminate.
6. **A shared calendar with no accounts is worth switching for.** *Confirms:* families adopt a shared vault. *Kills:* nobody wants a calendar without per-person permissions. **Note:** this bet is currently untestable, because no public surface makes the claim (finding #2).

**The dogfooding read.** The signal is real and legible. The recurrence engine, the debug page, and the `extra`-bag preservation all trace to friction the author hit in daily use, and `src/types.ts` carries comments citing specific data-integrity findings — evidence of a user who noticed real breakage. The roadmap corroborates it: `Multi-vault support / iCal import` and `Fix flow for adding a second vault` are the complaints of someone actually running more than one vault. The author states the limit plainly: `I've used Meridian for my own tasks for about two months now, and my wife is just starting to keep hers in it; we haven't moved the family calendar off Proton yet.` So bets 1–5 have an n of roughly 1.5, and **bet 6 — the shared-family-calendar premise, reason #2 for building the product — has never been tested even by its author.** What dogfooding cannot tell you: whether "everything is a list" is learnable by someone who didn't invent it, and whether the GitHub setup path is tolerable to someone who didn't build it.

**Feedback-channel readiness.** Today the app contains **zero** feedback affordances — the only external links in the entire UI are a GitHub token settings page and the OAuth app install URL. The blog says `the best place for that is a GitHub issue`, but no in-app surface says so. The tension is genuine: a no-server, local-first product has principled reasons not to add telemetry, and **analytics is not recommended here**. Options that fit the stated values: an in-app "Report an issue" link in Settings (one line, zero data collection); enabling GitHub Discussions; adding issue templates to `.github/`; or simply watching a forum thread manually. The cheapest meaningful instrument is the in-app link — without it, a launch teaches nothing, because a bouncing user leaves no trace at all. **The choice is routed below.**

## 6. The decisions only you can make

1. **Who is the beachhead?** *Obsidian-adjacent* — sharpest recognition, matches the palette and setup path, but narrows the top of the funnel. *Markdown vault owners generally* — wider, weaker signal. *Families wanting a shared no-account calendar* — the most differentiated claim and the author's own reason #2, but the least-tested bet and the one no surface currently makes.
2. **Which differentiator leads?** *Mobile UX* — the author's stated thesis, backed by real investment, but contested by three ✅ competitors in the same row. *Recurrence depth* — more defensible and less contested, but a narrower hook. *Plain files you own* — strongest with the beachhead, meaningless outside it.
3. **Does "notes" stay in the headline?** Keeping it sets an expectation the README itself disclaims (`it doesn't try to be a better note-taking app than Obsidian`). Dropping it sharpens the pitch but discards a real capability.
4. **Is the LLM-friendly audience worth targeting?** The Open Knowledge Format argument appears exactly once, inside idea #3, and in no headline, comparison row, or in-app surface. It is either an under-sold differentiator for a growing audience or a distraction from the declared niche. Nothing in this repository can settle it — only market contact can.
5. **Which feedback channel, if any?** In-app issue link (cheapest real signal, zero data collected) / GitHub Discussions (better for conversation, needs tending) / forum thread only (no product change, no passive signal) / nothing (preserves purity, guarantees a launch teaches nothing).
6. **Does the agenda keep landing on the backlog?** A completion tool should; a *calm* one probably shouldn't. This decides finding #3's scope and, more broadly, which word the product is actually willing to stand behind.

Everything outside this list is actionable without further input — findings #1 and #5 in particular need no strategy decision at all.

**Sources:** [Obsidian license](https://obsidian.md/license) · [Why isn't Obsidian Open Source?](https://obsidian.rocks/why-isnt-obsidian-open-source/) · [TaskNotes repository (MIT)](https://github.com/callumalpass/tasknotes) · [TaskNotes recurring tasks](https://tasknotes.dev/features/recurring-tasks/) · [File System Access API — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) · [MDN: showDirectoryPicker()](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
