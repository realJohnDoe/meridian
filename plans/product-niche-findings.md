# Product Niche Fit & Positioning — Findings

Findings from a survey run against [product-niche-survey.md](product-niche-survey.md).

## 1. Niche verdict

**Declared niche** — someone with scattered productivity apps who wants a calm, all-in-one calendar/tasks/notes app on plain Markdown, instead of Google Calendar + Todoist + Keep. **Revealed niche** — an Obsidian user who lives on their phone, already has a GitHub account, and wants tasks and calendar to be first-class rather than plugin-mediated; instead of Obsidian + TaskNotes. **Served niche** — that same person, *provided* they're on Chromium (desktop or Android) if they want the local-folder path, or GitHub otherwise (the four support-matrix claims were inconsistent and one was stale — corrected in finding #1), and are willing to retype their existing calendar because there's no iCal import.

The **fit is genuinely good** — the product invests exactly where the revealed niche needs it (`model/` 6,534 lines of recurrence depth, `editor/` 6,981, 16 files carrying swipe handling, `vaul` drawers, a 768px single column that never pretends to be a desktop app) and it honours its stated non-goal of out-noting Obsidian. **The communication is where it comes apart.** The widest gap is **declared vs. revealed**: every surface that a visitor reads first describes a general-audience app, while every surface built from the product's own effort — the palette, the eight-theme picker, the setup path, the founder's own blog — describes an Obsidian-adjacent power user. The word `mobile` appears **once** in the entire README, in a table cell 83% of the way down, despite the author writing `Mobile is where this is decided.` and calling it `the biggest single reason I eventually built something of my own`.

**The single change that closes the most gap:** replace the README's first screen — headline plus one "who this is for" line plus the comparison table — so the Obsidian-user-on-a-phone recognises themselves and the mobile wedge leads, instead of arriving after 41 lines of philosophy and a 52-line YAML reference. *Implemented in [PR #658](https://github.com/realJohnDoe/meridian/pull/658) (formerly findings #2 and #4, removed from this record below).*

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
| 1 | Niche fit | **clean** — walked; investment matches the revealed niche, non-goals honoured. |
| 2 | Niche recognition | #3 — **implemented and fixed**; formerly also #2, #4 — implemented, [PR #658](https://github.com/realJohnDoe/meridian/pull/658) |
| 3 | Visual identity & aesthetic fit | character-vs-promise assessed and largely **confirmed as working** (formerly evidenced by #2 — implemented, PR #658) |
| 4 | Differentiation & alternatives | **findings: #5** (open-source cell fixed; recurrence-row rating remains open — formerly also #4 — implemented, PR #658) |
| 5 | Audience selection | formerly #2 — implemented, PR #658 |
| 6 | Adoption gates | #3 — **implemented and fixed**; formerly also #1 — implemented, corrected and fixed |
| 7 | Niche drift & emerging signals | formerly #1 (prototype-era error copy — implemented, corrected and fixed); LLM angle assessed — see decisions |

## 4. Findings — top 5

| # | Finding | Gap | Question | Model |
|---|---|---|---|---|
| 5 | The comparison table's recurrence-rules row understates TaskNotes | declared-vs-served | communication | Sonnet 5 |

**Implemented and removed from this record:** #2 (the real beachhead was visible in every pixel and named in no copy) and #4 ("Great mobile UX" was the lead differentiator and appeared once) — these were the same decision seen twice, both rewriting the README's opening, and were implemented together in [PR #658](https://github.com/realJohnDoe/meridian/pull/658). #1 (local-folder support claims) — the survey's premise that Chrome for Android lacks `showDirectoryPicker` was stale (it shipped in Chrome 132–134, Q1 2025); corrected and fixed by unifying all four surfaces on the real matrix (desktop or Android Chromium; not iOS/Firefox) and replacing `fs.ts`'s prototype-era error copy. #3 (the app deliberately opens on your overdue backlog) — the demo vault's manufactured backlog was cleared and the overdue section made collapsible-by-default; see its section below for what stayed open on the way there.

**Partially implemented:** #5's open-source cell (`README.md:181`) is fixed — see its section below. The recurrence-row cell (`README.md:179`) is the one piece of the original top-5 still open, now carried by this table under its own title.

**Sequencing note.** The remaining #5 item edits one table cell and needs a positioning decision about what claim to make instead (Sonnet 5, not Haiku — the established-fact case that justified Haiku is now shipped).

---

### #1 — Local-folder support was claimed four different ways — **fixed**

- **Gap** declared-vs-served · **Question** fit + communication · **Category** `adoption-gate` `proof` `identity`
- **Status** **Implemented.** The survey's own verdict was wrong on the pivotal fact and has been corrected below before being acted on.

**Original evidence — four mutually inconsistent claims:**

> `Supported in Chrome and Edge only — not available on iOS or Firefox.` — README.md

> `local folder access requires a Chromium-based browser` — README.md

> `'Use a folder on this device. Works in Chrome and on Android; not supported on iOS or Safari.',` — `src/components/AddVaultWizard.tsx`

> `**Heads-up on storage:** the **local folder** backend works only in Chromium browsers` / `(Chrome, Edge) on desktop.` — `src/storage/exampleBackend.ts`

The survey concluded **"the wizard is wrong"**, on the premise that Chrome for Android does not expose `showDirectoryPicker`. **That premise was stale.** Chrome shipped File System Access (including `showDirectoryPicker`) on Android in Chrome 132–134 (Q1 2025) — over a year before this finding was recorded. The user tested Local folder on Android/Chrome directly and confirmed it works, which is what prompted the recheck. **The wizard string had it right all along**; `exampleBackend.ts` and the general "desktop Chromium" framing were the stale ones.

The one part of the original finding that held up regardless of the Android verdict: `fs.ts`'s error strings were prototype-era copy left over from the single-HTML-file phone prototype, nonsensical in the current React PWA:

> `throw new Error('Your browser does not support folder access. Use Chrome or Edge, and open this file directly (not in a preview).')` — `src/storage/fs.ts`

- **Problem** Four surfaces disagreed on the local-folder support matrix, and one surface's error copy referenced a UI (a standalone HTML file) the product no longer has.
- **Fix applied** Unified all four surfaces on the correct matrix — **Chrome/Edge, desktop or Android; not iOS or Firefox** — in `README.md` (two spots) and `src/storage/exampleBackend.ts`; the in-app wizard string was already correct. Added `isFolderPickerSupported()` in `src/storage/fs.ts` (exported through the `storage`/`vaultActions` barrels) and used it in `AddVaultWizard.tsx` to hide the Local-folder card and default to GitHub on browsers that genuinely lack `showDirectoryPicker` (iOS Safari, Firefox), rather than on Android. Replaced both `fs.ts` error strings with PWA-appropriate text that points to GitHub as a fallback instead of the dead "open this file directly" advice.

---

### #3 — The app deliberately opens on your overdue backlog — **fixed**

- **Gap** declared-vs-revealed · **Question** fit + communication · **Category** `aesthetic-fit` `recognition` `identity`
- **Status** **Implemented.** One of the two evidence surfaces went stale between when this was recorded and when it was fixed — noted below before the fix.
- **Who it costs us** Every first-time visitor to the example vault — the only try-before-committing path, so effectively 100% of people who open the app.
- **Impact** 8 · **Breadth** 3 surfaces (`agendaSections.ts`, `exampleBackend.ts`, `README.md` headline)

**Evidence — this is by design, not accident:**

> `// goToday scrolls to the overdue section when there is one, else to today.` — [src/calendar/agendaSections.ts:331](../src/calendar/agendaSections.ts:331)

Its own test asserts the landing target is the backlog, not today:

> `expect(sections[goToIndex]).toBe(findOverdue(sections))` — [src/calendar/agendaSections.test.ts:72](../src/calendar/agendaSections.test.ts:72)

The section is uncapped: `pools every undone past task with no cap` ([agendaSections.ts:31](../src/calendar/agendaSections.ts:31)).

**Measured live** at 375×812 on the example vault, first run: the `Overdue` divider renders at **y=114** and `Today` at **y=490** — roughly **46% of the first screen is a backlog**, above today, containing four items. This was against a headline promising:

> `**A calm calendar, task manager, and notes app built on plain Markdown files.**` — README.md (as it read when this finding was recorded)

**That headline no longer exists.** [PR #658](https://github.com/realJohnDoe/meridian/pull/658) replaced it with `Tasks and a calendar that are actually good on your phone — stored as plain Markdown files you own.` "Calm" now survives only in `blog/1-…/interview.md:33`, a question quoting the old README (`The README calls it "a calm calendar."`). This doesn't dissolve the finding — a first-time visitor still met a wall of unfinished work they couldn't clear — but the "promises calm, opens on guilt" framing lost its live evidence before the fix landed, which is itself the answer to decision #6 below: "calm" isn't the word this product is currently claiming.

And the visitor could not clear them, because:

> `This is a read-only sandbox — poke around freely.` — [src/storage/exampleBackend.ts:79](../src/storage/exampleBackend.ts:79)

The demo's overdue items were a fixture artifact: the `instances` marking occurrences done were pinned to `prevWeekday(MON, 1)` / `prevWeekday(WED, 1)`, a week *before* the series anchor `lastWeekday(MON)`, so every occurrence between the anchor and today accumulated unresolved — 0 to 6 items depending on which weekday the demo happened to be opened.

To be clear on what was *not* wrong: the colour choice is restrained (amber `--warning`, not the rose `--destructive`), and there are no counts, badges, or streaks. The character problem was structural placement, not visual noise.

- **Recommended model** **Opus 5** (as run). The fixture half was mechanical, but the landing-position question was a genuine product-character decision — settled below.
- **Problem** A product sold as calm greeted every new visitor with a wall of unfinished work they were not permitted to clear.
- **Fix applied, in two independent parts:**
  1. **Demo fixture.** `src/storage/exampleBackend.ts` now generates a `done: true` instance for every Mon/Wed/Fri occurrence between the series anchor and today (`weekdaysBeforeToday` + `doneInstances`, replacing the stale `prevWeekday` pinning), for both `team-standup` and `morning-run`. On a Monday — where the anchor *is* today — the `instances:` key is omitted entirely rather than emitted empty. The example vault now has zero overdue items on every weekday, so the section never renders in the demo and the agenda opens on Today. Covered by a new `src/storage/__tests__/exampleBackend.test.ts`, parametrized across all seven weekdays.
  2. **Real-vault landing behaviour — decided.** Scroll-to-today still prefers the overdue section over Today when one exists (`agendaSections.ts`'s `preferOverdue`, unchanged) — a completion-focused reading of the product survives. What changed is what that preference lands you on: the overdue section is now collapsible and **starts collapsed** (`overdueCollapsed` in `calendar/viewState.ts`, defaulting to `true`), so the target is a single `Overdue N ›` bar sitting directly above Today, not an unbounded list. Tapping it expands in place. `computeAgendaSections` (`agendaSections.ts`) gained an `overdueCollapsed` parameter that decides whether the section's `rows` is just its header or the header plus every occurrence — `items` always carries the full pool, so nothing is hidden from the data, only from the initial render. `AgendaHeaderRow.tsx` renders the overdue header as a toggle button (chevron + count) instead of a plain label; `AgendaView.tsx` wires the toggle. Covered by new cases in `agendaSections.test.ts`, `useAgendaSections.test.ts`, and `AgendaView.test.tsx`.

  This follows the pattern used by task-first apps that keep an overdue section (Todoist, TickTick, Google Tasks): show the pile, but make it dismissable in one gesture. A hard cap on the list was considered and rejected — it hides work without saying how much, and a collapsed section is already one row regardless of size.

---

### #5 — The comparison table's open-source row is backwards — **open-source cell fixed, recurrence row still open**

- **Gap** declared-vs-served · **Question** communication · **Category** `differentiation` `proof`
- **Who it costs us** Obsidian users — precisely the beachhead — who know Obsidian's licensing and will read the error as either carelessness or spin. Anyone who reaches the comparison table.
- **Impact** 6 · **Breadth** 1 surface, 1 cell (of the still-open half)

**Evidence (open-source cell, as originally recorded):**

> `| Free & open source | ✅ | Partially (core only) | ❌ | ❌ | ❌ | ❌ |` — README.md (as it read when this finding was recorded)

**Verified and refuted, on both halves.** Obsidian's core application is proprietary and closed-source; its plugin and theme ecosystem is the open part. TaskNotes is MIT-licensed and open source. So the truthful cell is `Partially (plugin only)` — the exact inverse of what shipped.

**Fixed.** `README.md:181` now reads `| Free & open source | ✅ | Partially (plugin only) | ❌ | ❌ | ❌ | ❌ |`, corrected in commit `576ca37` (part of [PR #658](https://github.com/realJohnDoe/meridian/pull/658)).

**Still open — the adjacent row is contestable rather than wrong:**

> `| Rich recurrence rules | ✅ | Limited | ✅ | ❌ | ✅ | ❌ |` — [README.md:179](README.md:179)

TaskNotes supports RFC 5545 RRULE strings with `DTSTART`, per-instance completion tracking, nth-weekday, count-limited *and* completion-based recurrence. "Limited" understates it, and completion-based repeat is something Meridian's own feature list claims as a differentiator (`"repeat N days after completion"`, README:34). Meridian's real recurrence edge is narrower and more specific: multiple series in one entry, and pinning arbitrary one-off occurrences.

- **Recommended model** **Haiku 4.5 for the open-source cell** (done — the corrected facts were established and cited here, so the hazard the tier guards against was already retired). **Sonnet 5 for the recurrence row** — it requires deciding what claim Meridian can honestly make instead, not just correcting a fact.
- **Problem** The beachhead audience catches a factual error about the tool they use daily, in the section meant to build trust. (Fixed for the open-source row; the recurrence row still understates a TaskNotes capability while implicitly overclaiming Meridian's.)
- **Fix** ~~Change the cell to `Partially (plugin only)`~~ — done. Still open: re-rate the recurrence row to a claim that survives a TaskNotes user's scrutiny.

## 5. PMF bets and what would test them

**This is not a PMF assessment and cannot be one.** There is no analytics, no telemetry, and no feedback path in the app; `.github/` contains only workflows; and `plans/next-steps.md` now reads in full: `Multi-vault support / iCal import`, `Add vault retention period`, `Fix flow for adding a second vault`. Market contact has not happened, and the item that would have caused it has dropped off the roadmap. What follows are the open questions the first real contact would settle.

**The bets.**

1. **Mobile is the wedge against Obsidian + TaskNotes.** *Confirms:* people describe switching specifically because capture-on-phone is faster. *Kills:* they say TaskNotes on mobile is fine and they'd rather keep their plugin ecosystem.
2. **One timeline for tasks, events, and notes is a benefit, not a muddle.** *Confirms:* users put all three in and stop opening a second app. *Kills:* they use it as a calendar only and keep Todoist.
3. **Plain files justify their setup cost.** *Confirms:* people complete GitHub connection and stay past week one. *Kills:* they try the example vault and never connect storage — the sharpest available signal, and currently unmeasurable.
4. **Recurrence depth matters to real schedules.** *Confirms:* unprompted mention of shifting or cancelling single occurrences. *Kills:* nobody uses anything past weekly, making the deepest-invested subsystem (`model/`, 6,534 lines) over-serving.
5. **"Everything is a list" is learnable fast enough to be worth it.** *Confirms:* users create nested entries without reading the tutorial notes. *Kills:* they ask "how do I make a project?" — the question the model is designed to eliminate.
6. **A shared calendar with no accounts is worth switching for.** *Confirms:* families adopt a shared vault. *Kills:* nobody wants a calendar without per-person permissions. **Note:** as of [PR #658](https://github.com/realJohnDoe/meridian/pull/658) the README now states this claim (formerly finding #2's gap); still untested by market contact.

**The dogfooding read.** The signal is real and legible. The recurrence engine, the debug page, and the `extra`-bag preservation all trace to friction the author hit in daily use, and `src/types.ts` carries comments citing specific data-integrity findings — evidence of a user who noticed real breakage. The roadmap corroborates it: `Multi-vault support / iCal import` and `Fix flow for adding a second vault` are the complaints of someone actually running more than one vault. The author states the limit plainly: `I've used Meridian for my own tasks for about two months now, and my wife is just starting to keep hers in it; we haven't moved the family calendar off Proton yet.` So bets 1–5 have an n of roughly 1.5, and **bet 6 — the shared-family-calendar premise, reason #2 for building the product — has never been tested even by its author.** What dogfooding cannot tell you: whether "everything is a list" is learnable by someone who didn't invent it, and whether the GitHub setup path is tolerable to someone who didn't build it.

**Feedback-channel readiness.** Today the app contains **zero** feedback affordances — the only external links in the entire UI are a GitHub token settings page and the OAuth app install URL. The blog says `the best place for that is a GitHub issue`, but no in-app surface says so. The tension is genuine: a no-server, local-first product has principled reasons not to add telemetry, and **analytics is not recommended here**. Options that fit the stated values: an in-app "Report an issue" link in Settings (one line, zero data collection); enabling GitHub Discussions; adding issue templates to `.github/`; or simply watching a forum thread manually. The cheapest meaningful instrument is the in-app link — without it, a launch teaches nothing, because a bouncing user leaves no trace at all. **The choice is routed below.**

## 6. The decisions only you can make

1. ~~Who is the beachhead?~~ **Decided:** Obsidian-adjacent, plus a claim the original options didn't consider — the technical user installs, but whoever they share with just opens it. Implemented in [PR #658](https://github.com/realJohnDoe/meridian/pull/658).
2. ~~Which differentiator leads?~~ **Decided:** mobile, framed as the intersection of "files you own" and "phone-first" rather than the contested "Great mobile UX" row. Implemented in PR #658.
3. **Does "notes" stay in the headline?** Keeping it sets an expectation the README itself disclaims (`it doesn't try to be a better note-taking app than Obsidian`). Dropping it sharpens the pitch but discards a real capability. **Decided:** dropped from the headline/meta/manifest, kept in "What it does" — PR #658.
4. **Is the LLM-friendly audience worth targeting?** The Open Knowledge Format argument appears exactly once, inside idea #3, and in no headline, comparison row, or in-app surface. It is either an under-sold differentiator for a growing audience or a distraction from the declared niche. Nothing in this repository can settle it — only market contact can.
5. **Which feedback channel, if any?** In-app issue link (cheapest real signal, zero data collected) / GitHub Discussions (better for conversation, needs tending) / forum thread only (no product change, no passive signal) / nothing (preserves purity, guarantees a launch teaches nothing).
6. ~~Does the agenda keep landing on the backlog?~~ **Decided:** yes, unchanged — scroll-to-today still prefers the overdue section over Today when one exists. What changed is what that lands you on: the section is now collapsible and starts collapsed, so the target is a one-line bar above Today rather than the backlog itself. This also settles which word the product stands behind — "calm" left the headline in PR #658 before this decision was made, so the fix didn't have to choose between the two; it just had to stop making either reading painful. Implemented as finding #3.

Everything outside this list is actionable without further input — findings #1 and #3 are implemented; #5's open-source cell needs no strategy decision, only its recurrence-row half does (see above).

**Sources:** [Obsidian license](https://obsidian.md/license) · [Why isn't Obsidian Open Source?](https://obsidian.rocks/why-isnt-obsidian-open-source/) · [TaskNotes repository (MIT)](https://github.com/callumalpass/tasknotes) · [TaskNotes recurring tasks](https://tasknotes.dev/features/recurring-tasks/) · [File System Access API — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) · [MDN: showDirectoryPicker()](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
