# Product Niche Fit & Positioning — Survey Results

Survey run: 2026-08-11, against `main` at `451f310`.
Plan: [product-niche-survey.md](product-niche-survey.md).

---

## 1. Niche verdict

**Declared niche** — a person who already keeps their life in Markdown (Obsidian + TaskNotes), hiring Meridian to make tasks and dates first-class and fast on a phone instead of plugin-mediated and desktop-first; their alternative is the Obsidian + TaskNotes combination they already run. The README promotes a **second** declared persona to line 7: the partner, child, or colleague you share with, who "doesn't have to be you" and is hiring it as a shared kitchen-wall calendar against Google Calendar.

**Revealed niche** — read off investment, this is a *developer with a GitHub account and a genuinely irregular schedule*. `model/` carries 3,206 lines of recurrence and occurrence logic and `storage/` 3,245 (GraphQL blob batching, throttling, conflict detection, an OAuth worker) against 294 lines of search and 168 of onboarding; the recommended backend is a git repo; seven of the eight themes are code-editor palettes; the entry format is documented as hand-editable YAML on three separate surfaces.

**Served niche** — anyone holding a GitHub account, on any device; plus Chromium desktop/Android users who want a local folder. Everyone else gets a read-only tutorial. With no iCal import, adoption also costs retyping an existing calendar by hand.

**Fit is strong; communication is where the product loses people.** The product genuinely serves its revealed niche — the recurrence depth is real and, per the comparison table, unmatched by any named alternative, and the mobile interaction vocabulary (`vaul` drawers, `embla` swipe, a 52px thumb-reach search bar) is real mobile-native investment rather than a reflowed desktop layout. **The widest gap is declared-vs-served, and it sits on README line 7**: the product promises a sharing story — "no accounts to create" — that the code cannot deliver, because every writable GitHub vault requires either OAuth sign-in or a pasted personal access token. That single line targets a person the product cannot serve today, and it is the founding motivation of the entire project, which makes it the most expensive sentence in the repository.

**The single change that would close the most of the gap** is to decide the sharing story explicitly — either build a token-less read path so a sharee really can just open a link, or retract line 7's "no accounts to create" to what the product actually does (a shared repo among people who each have a GitHub account). Either is defensible; leaving both live is not.

---

## 2. Coverage statement

### Cold-read first impressions (recorded before any code was read)

- **What I thought this was:** a mobile-first web calendar and task manager sitting on top of a Markdown vault — Obsidian-adjacent, not an Obsidian replacement.
- **Who for:** someone already in Obsidian/TaskNotes who is annoyed that capture on a phone takes too many taps. Secondarily, a family or team wanting a shared calendar without everyone signing up for something.
- **Instead of what:** Obsidian + TaskNotes first; Google Calendar / Todoist second.
- **Would I keep reading:** yes. The headline names a job rather than a category list, and "Who it's for" is line 5 — the niche is unambiguous by **line 5**, which is unusually fast. The "Open the app →" link at line 9 arrives before any philosophy, which is the right order.

### Surfaces read completely

`README.md`, `blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md`, `blog/1-…/interview.md` (skimmed), `blog/3-…/interview.md` (skimmed), `src/onboarding/CoachTour.tsx`, `src/storage/exampleBackend.ts` (all 14 tutorial entries), `src/index.css` (all 8 themes), `index.html`, the PWA manifest in `vite.config.ts`, `src/types.ts`, `plans/next-steps.md`.

### Sampled

`src/storage/githubBackend.ts`, `githubApi.ts`, `sync.ts`, `fs.ts`, `vaultRegistry.ts`; `src/components/AddVaultWizard.tsx`, `SyncButton.tsx`, `VaultSettings.tsx`; `src/routes/__root.tsx`, `_app.tsx`; `src/persistencePort.ts`; `package.json`. Feature depth measured by line count per directory rather than by reading each module.

### Assessed from code and copy only

- **The real setup path** — GitHub OAuth and File System Access permission grants cannot be driven by an automated browser, as the plan anticipated. Assessed from `AddVaultWizard.tsx`, `githubOAuth`, and `fs.ts` instead.
- **The entire visual walk.** **No `preview_*` tools are available in this session** — `ToolSearch` returns only `WebFetch` and `DesignSync`. So the **blind visual read and the screenshot set (mobile/desktop × 8 themes) were not performed**, and neither was the first-run walk on the example vault. Everything in category 3 below is inferred from `src/index.css` tokens, the dependency set, and layout source. This is the largest hole in the survey; the finding it most affects is #4, which should be re-checked against real screenshots before acting on it.

### Comparison-table claims verified

| Claim | Verdict |
|---|---|
| Obsidian — "Works in the browser ❌" | **Confirmed.** No official browser version exists; only third-party Docker/Electron-in-browser projects. |
| Todoist — "Multiple participants / assignees ✅ (paid)" | **Wrong on both halves; fixed.** Todoist supports exactly one assignee per task by design, and assignment works on the free plan (5 collaborators per project). README:180 now reads `Partial (one assignee per task)`; GitHub Issues (up to 10 assignees) and Google Keep (collaboration only, no assignee concept) were re-verified and left unchanged. |
| Obsidian — "Free & open source: Partially (plugin only)" | **Confirmed** as fair: Obsidian is free for personal use but proprietary; TaskNotes is open source. |
| Obsidian/GCal/Todoist — "Multiple series + one-off overrides in one entry ❌ (single rule per …)" | **Not re-verified** — already corrected in `cb2549f`. Note the row's parentheticals are the accurate part; the bare ❌ may read as "cannot move one occurrence," which Google Calendar can do. Low priority. |
| Google Keep, GitHub Issues rows | **Not verified.** Out of the time box. |

### Suspected but unverified

- **Creating an entry in the tutorial vault silently discards it.** `ExampleBackend.write()` is a no-op, `sync.ts` returns early on `readOnly`, and the `+` button is not gated — but I could not run the app to confirm the entry appears and then vanishes rather than erroring. **Unverified**; a single manual click of `+` in the example vault settles it.
- **Whether the 8 themes read as "developer tool" to a non-developer.** That is a claim about perception I cannot make from tokens alone, and the plan forbids inventing audience reactions. Flagged inside finding #4 as the bet it is.

### Plan drift noted

Two premises in the survey plan are now stale, which is itself evidence the positioning is moving: the plan quotes the headline as `A calm calendar, task manager, and notes app built on plain Markdown files.` — the README was repositioned in `576ca37` and now leads `**Tasks and a calendar that are actually good on your phone — stored as plain Markdown files you own.**`, with "calm" gone entirely. The plan also states the first line of `plans/next-steps.md` is `Post about Meridian in Obsidian forums`; that line no longer exists. **Market contact still has not happened**, so section 5 stands.

---

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Niche fit | **findings: #3** — and largely healthy otherwise; see the "working as intended" note below. |
| 2 | Niche recognition | **clean.** The niche is unambiguous by README line 5 and the app link is at line 9, before any philosophy. This is the strongest surface in the repository. |
| 3 | Visual identity & aesthetic fit | **partially assessed** — no preview tooling in this session, so the blind visual read and all screenshots were skipped. Assessed from tokens/deps only; **finding: #4**. |
| 4 | Differentiation & alternatives | **fixed** — see the comparison-table verification note above. |
| 5 | Audience selection | **findings: #3, #4** |
| 6 | Adoption gates | **findings: #3** |
| 7 | Niche drift & emerging signals | **findings: #3**, plus one below-the-cut item (tags, see the note after the findings). |

**Working as intended — confirmed as strategy, not flagged as findings:**

- `Meridian supports notes, but it doesn't try to be a better note-taking app than Obsidian` (README:186) is honoured in the code. There is no graph view, no plugin API, no backlink-graph investment; the notes surface is deliberately thin and the comparison table concedes `Advanced note-taking … | Partial` rather than claiming parity. The non-goal is real.
- **The mobile-first claim is backed by real investment**, not just asserted: `vaul` for drawers, `embla-carousel-react` for swipe navigation, a 52px `.search-bar-wrap` with `--shadow-float` pinned in thumb reach, `env(safe-area-inset-*)` threaded through `--th`, and `apple-mobile-web-app-capable` in `index.html`. This is the lead differentiator and the product actually spent on it.
- **The seven code-editor themes are well-matched to the *primary* declared niche.** Tokyo Night, Dracula, Solarized, Catppuccin and Rosé Pine are exactly the palettes an Obsidian user recognises. The narrow problem is the default and the second persona — see #4 — not the theme set, which should not be broadened.
- **Honest limitations earn credibility where they appear.** README:161's frontmatter caveat ("comments are dropped, and keys may be reordered, requoted…") and README:186's Obsidian concession are both the kind of conceding that buys trust. Keep them.

---

## 4. Findings — top 5

Ranked by `(impact × breadth) ÷ effort`. Fields are reported separately so you can re-sort.

| # | Finding | Gap | Question | Recommended model |
|---|---|---|---|---|
| 4 | Forced dark default recruits against the line-7 persona | declared-vs-revealed | communication | **Opus 5** |

**Sequencing note.** #3 and #5 are resolved (see the category-verdicts table above and the comparison-table note). #4 no longer waits on #3 — the line-7 persona survives under the option-(b) rewrite, so #4's copy half can proceed against it.

---

### Finding #4 — The forced dark default recruits against the line-7 persona

- **Gap:** `declared-vs-revealed`
- **Question:** communication
- **Category:** `visual-language` `aesthetic-fit` `audience-selection` `identity`
- **Who it costs us:** the non-developer sharee from README:7, and any visitor arriving from a light-mode phone. They meet a saturated indigo dark IDE palette before reading a word. Share of arrivals is unknown — that is precisely the bet.
- **Impact:** 5
- **Breadth:** 2 surfaces (`src/routes/__root.tsx`; the theme block of `src/index.css`), but both are unconditional — every visitor meets them.
- **Evidence:** `src/routes/__root.tsx:85-86`

  ```tsx
  defaultTheme="meridian"
  enableSystem={false}
  ```

  `enableSystem={false}` means a visitor whose OS is set to light **still lands in dark**; the product declines to read the one preference signal it is handed for free. And the eight themes in `src/index.css` are: `.meridian` (`--background: oklch(0.18 0.05 252)`), `.tokyo-night`, `.rose-pine-dawn`, `.solarized-light`, `.solarized-dark`, `.dracula`, `.catppuccin-latte`, `.catppuccin-mocha` — **seven of eight are code-editor palettes**, and there is no neutral or consumer-calendar option. The default's own comment reads `--primary: oklch(0.68 0.22 278);   /* indigo — balanced for text on dark surfaces and filled button bg */`.
- **Adjacency read:** placed beside the alternatives the README names, this reads as belonging firmly to the **Obsidian / local-first tools-for-thought** set, and emphatically *not* to the Google Calendar / Keep consumer set. For the primary declared niche that is correct and should not change. It is a deliberate outlier only with respect to the *second* declared persona.
- **Recommended model:** **Opus 5.** The mechanical half (`enableSystem` → `true`, with `.catppuccin-latte` or `.rose-pine-dawn` as the light pair) is trivial, but the judgment half is not: the hazard is an agent "broadening the appeal" by adding a neutral consumer theme or desaturating the default, which would dissolve the strongest identity signal the product has in exchange for an audience it may not want. The correct output is usually **the small fix plus an explicit recommendation to keep the theme set exactly as it is**. Drops to **Haiku 4.5 if the decision is given as "respect system preference, pair dark Meridian with Catppuccin Latte, change nothing else."**
- **Problem:** a light-mode, non-developer visitor is shown a code-editor palette they didn't ask for and can't tell the product is meant to include them.
- **Fix:** set `enableSystem` and designate an existing light theme as the light-mode pair — **without** adding a neutral theme or softening the default; the code-editor identity is an asset for the primary niche and should be defended.

---

**Below the cut (verified, did not make the top 5).** The philosophy table at `README.md:86` lists `| **Tag** | — | everything tagged with it |` as one of five entry kinds, implying a tag is an openable list. In the code a tag is a plain label: `tags: string[]` (`src/types.ts:28`), rendered as a non-interactive chip, with no resolution to an entry — and the tutorial says so correctly at `exampleBackend.ts:368` (`` `tags` — free-text labels ``). The blog still narrates first-class tags as achieved — `I had tags implemented _as_ wikilinks, which is how I got my first-class` / `tags.` (`blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md:155-156`, wrapped across the line break) — which the `topics` → `items` migration of 2026-06-20 superseded. Classic niche drift — three surfaces frozen at three different eras — but it sits deep in the README where few readers reach, so impact is ~4.

---

## 5. PMF bets and what would test them

**This is not a product/market-fit assessment and cannot be one.** PMF is a demand-side claim, and this repository contains no demand-side evidence: there is no analytics, telemetry, or in-app feedback path; `.github/` holds only workflows; and market contact has not happened. What follows is the list of things the first real contact would settle, written so that contact can settle them.

### The bets

| # | Bet | Confirmed by | Killed by |
|---|---|---|---|
| 1 | **Mobile capture speed is a strong enough wedge to move someone off Obsidian + TaskNotes.** The whole repositioning rests on it. | A forum reply of the form "this is the thing TaskNotes can't do on my phone"; a first-ten user who keeps a Meridian vault alongside their Obsidian vault past week two. | Replies that praise the recurrence model or the file format but say they'll stay in Obsidian; users who install and never return after day one. |
| 2 | **Plain files are worth their setup cost to someone who isn't already sold on plain files.** | A non-Obsidian user completing GitHub setup and staying. | Drop-off concentrated at the "Connect GitHub repo" step; feedback of the form "I just wanted a calendar." |
| 3 | **One timeline for tasks, events and notes is a feature, not a mess.** | Users who put all three in and say the single agenda is why they stayed. | Users who ask for separate task and calendar views, or who use it only for one of the three. |
| 4 | **Recurrence depth matters to real schedules.** The product's single largest investment (3,206 lines in `model/`). | Unprompted mention of multi-series or after-completion repeats; bug reports about *edge cases* in recurrence, which imply real reliance. | Nobody ever creating a `repeat` block beyond weekly; no recurrence feedback at all after launch. |
| 5 | **The shared-calendar story is a real draw and not just the author's origin story.** Currently **unbacked by the product** — see finding #3. | Requests for a way to share with a non-GitHub person — which would confirm both the demand *and* the gap. | Silence on sharing; all interest concentrated on the single-user Markdown story. |
| 6 | **Switching without iCal import is tolerable.** The author names this himself: `The most useful missing piece is probably iCal import — until you can pull an existing calendar in, switching means retyping it, which is a lot to ask.` | Users who retype and stay. | "I'll try it when it can import my calendar," repeatedly. |

### The dogfooding read

The one legitimate usage signal, and it is genuinely informative. `I've used Meridian for my own tasks for about two months now, and my wife is just starting to keep hers in it; we haven't moved the family calendar off Proton yet.` PMF-of-one is real evidence — and this is a careful, honest statement of its limits.

What daily use appears to confirm: recurrence depth (the debugger built four days in, the 3,206-line model, the `defaults`/`instances` design), sync reliability (conflict detection, four-layer cache coherence work), and phone performance (`Cut cold-start time-to-today from ~1s to the first painted frame` in recent history). Those are the marks of a tool someone actually opens every morning, and they are why fit reads as strong.

What it cannot tell you — and this is the sharper half: **the flagship persona is not yet dogfooded.** The family calendar is still on Proton, and the shared-calendar promise on README line 7 is therefore backed neither by product capability (finding #3) nor by the author's own use. The example vault is likewise shaped by a single user's fluency — it teaches YAML frontmatter fields, `[[wikilinks]]`, and a `repeat` block, which is what *this* user needed to see. A product shaped around one user's habits is the classic way a niche stays a niche of one, and the two thinnest directories in the repository — `onboarding/` at 168 lines and `search/` at 294 — are exactly the two things a *second* user needs most and the first user never does.

### Feedback-channel readiness

Nothing currently exists that would let a launch teach anything: no analytics, no telemetry, no in-app feedback path. The blog's closing line is the whole channel today — `Tell me what works and what doesn't — the best place for that is a [GitHub issue]`. That is a real channel, but it selects for exactly the audience whose reactions you can already predict, and excludes the line-7 sharee entirely.

There is a genuine tension here and it should not be resolved by default: a no-server, privacy-respecting, local-first product has principled reasons *not* to add telemetry, and adding it would contradict `Meridian doesn't run a server that holds your notes.` Options that fit those values, routed to section 6:

- **Watch the forum thread.** Zero code, zero values cost; captures only pre-adoption reactions, not retention.
- **GitHub Discussions.** Low cost, more inviting than an issue tracker; still GitHub-gated, so it inherits finding #3's exclusion.
- **An in-app feedback link** (mailto or a form) in Settings. Small change, no server, no data collection; reaches users the forum never sees. **The cheapest thing that would tell you something new.**
- **Analytics — not recommended**, and named here only to be explicitly declined. It would contradict the product's central claim to reach a signal the first ten users can give you by hand.

---

## 6. The decisions only you can make

1. **Is the shared-calendar persona a target, or the origin story?** *Options:* build an unauthenticated read path (delivers README:7, requires public repos, is real work) / keep the current model and rewrite line 7 honestly (free, weaker pitch) / defer it explicitly as roadmap. *Consequence:* this decides whether Meridian is a single-user tool for Markdown people or a shared calendar, and everything from the theme default to the onboarding copy follows from it. Nothing else in this report is as load-bearing.

2. **Who is the beachhead — the Obsidian user, or the developer?** The README says the first, the blog says `the readers I care about first are developers`, and the product's investment says the second. *Consequence:* picking the developer makes the GitHub-first setup a feature and the code-editor themes a strength; picking the Obsidian user makes both a tax to be reduced. Right now you are paying for both.

3. **Which differentiator leads — phone-first, or recurrence depth?** The headline says phone-first; the codebase says recurrence (3,206 lines, and the only comparison row no named alternative can match). *Consequence:* if recurrence leads, it deserves more than bullet #3 of 9 in a list where "Search" (294 lines) gets equal weight.

4. **Does the notes category stay in the pitch?** It has been stripped from the three shortest surfaces — the README headline, `index.html`'s meta description, and the PWA manifest (`Tasks and a calendar on plain Markdown files you own — fast on a phone.`) — but survives in the longer copy: `README.md:33` (`- **Tasks, events, and notes in one place**`), the blog's self-description (`a calendar, task manager,` / `and notes app`, wrapped at `blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md:29-30`), and — most conspicuously — `src/onboarding/CoachTour.tsx:34`, the first sentence a new user reads inside the app: `Meridian keeps your notes, events, and tasks as plain Markdown files in a folder you own.` *Consequence:* the short surfaces have already made the narrowing decision and the long ones haven't followed, so a visitor is told "tasks and a calendar" on the way in and "notes, events, and tasks" once they arrive. Finishing the narrowing avoids an Obsidian comparison you have explicitly decided not to win; reversing it means putting notes back in the headline.

5. **Is the LLM-friendly audience worth targeting?** It appears once, at README:98, with an Open Knowledge Format reference — and nowhere else on any surface. *Consequence:* either promote it deliberately or accept it as a footnote; a single mention does no selection work.

6. **Which feedback channel, given a product built on not running a server?** See section 5. *Consequence:* choosing none means the first launch teaches you only what the GitHub-fluent subset volunteers.

Everything outside this list is actionable without further input.
