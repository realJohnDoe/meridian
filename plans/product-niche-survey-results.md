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
- **The entire visual walk.** **No `preview_*` tools are available in this session** — `ToolSearch` returns only `WebFetch` and `DesignSync`. So the **blind visual read and the screenshot set (mobile/desktop × 8 themes) were not performed**, and neither was the first-run walk on the example vault. Everything in category 3 below is inferred from `src/index.css` tokens, the dependency set, and layout source. This is the largest hole in the survey; the finding it most affects is #5, which should be re-checked against real screenshots before acting on it.

### Comparison-table claims verified

| Claim | Verdict |
|---|---|
| Obsidian — "Works in the browser ❌" | **Confirmed.** No official browser version exists; only third-party Docker/Electron-in-browser projects. |
| Todoist — "Multiple participants / assignees ✅ (paid)" | **Wrong on both halves.** Todoist supports exactly one assignee per task by design, and assignment works on the free plan (5 collaborators per project). See finding #5. |
| Obsidian — "Free & open source: Partially (plugin only)" | **Confirmed** as fair: Obsidian is free for personal use but proprietary; TaskNotes is open source. |
| Obsidian/GCal/Todoist — "Multiple series + one-off overrides in one entry ❌ (single rule per …)" | **Not re-verified** — already corrected in `cb2549f`. Note the row's parentheticals are the accurate part; the bare ❌ may read as "cannot move one occurrence," which Google Calendar can do. Low priority. |
| Google Keep, GitHub Issues rows | **Not verified.** Out of the time box. |

### Suspected but unverified

- **Creating an entry in the tutorial vault silently discards it.** `ExampleBackend.write()` is a no-op, `sync.ts` returns early on `readOnly`, and the `+` button is not gated — but I could not run the app to confirm the entry appears and then vanishes rather than erroring. **Unverified**; a single manual click of `+` in the example vault settles it. Finding #2 is written to hold either way, since the *disclosure* gap is confirmed by code regardless.
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
| 4 | Differentiation & alternatives | **findings: #5** |
| 5 | Audience selection | **findings: #3, #4** |
| 6 | Adoption gates | **findings: #1, #2, #3** |
| 7 | Niche drift & emerging signals | **findings: #3**, plus one below-the-cut item (tags, see the note after the findings). |

**Working as intended — confirmed as strategy, not flagged as findings:**

- `Meridian supports notes, but it doesn't try to be a better note-taking app than Obsidian` (README:186) is honoured in the code. There is no graph view, no plugin API, no backlink-graph investment; the notes surface is deliberately thin and the comparison table concedes `Advanced note-taking … | Partial` rather than claiming parity. The non-goal is real.
- **The mobile-first claim is backed by real investment**, not just asserted: `vaul` for drawers, `embla-carousel-react` for swipe navigation, a 52px `.search-bar-wrap` with `--shadow-float` pinned in thumb reach, `env(safe-area-inset-*)` threaded through `--th`, and `apple-mobile-web-app-capable` in `index.html`. This is the lead differentiator and the product actually spent on it.
- **The seven code-editor themes are well-matched to the *primary* declared niche.** Tokyo Night, Dracula, Solarized, Catppuccin and Rosé Pine are exactly the palettes an Obsidian user recognises. The narrow problem is the default and the second persona — see #4 — not the theme set, which should not be broadened.
- **Honest limitations earn credibility where they appear.** README:161's frontmatter caveat ("comments are dropped, and keys may be reordered, requoted…") and README:186's Obsidian concession are both the kind of conceding that buys trust. Keep them.

---

## 4. Findings — top 5

Ranked by `(impact × breadth) ÷ effort`. **Note the ranking inverts the impact ordering**: the highest-impact finding (#3, impact 9) ranks third because its fix is a strategy decision, while the lowest-impact one (#1, impact 5) ranks first because its fix is mechanical and touches five surfaces. Fields are reported separately so you can re-sort.

| # | Finding | Gap | Question | Recommended model |
|---|---|---|---|---|
| 1 | Local-folder support stated five ways, two of them wrong | declared-vs-served | communication | **Haiku 4.5** |
| 2 | The trial can't demonstrate the thing being sold | revealed-vs-served | fit + communication | **Sonnet 5** |
| 3 | "No accounts to create" is false for the person you share with | declared-vs-served | fit + communication | **Opus 5 in plan mode, multi-PR** |
| 4 | Forced dark default recruits against the line-7 persona | declared-vs-revealed | communication | **Opus 5** |
| 5 | Todoist row gives away a real differentiator and invents a paywall | declared-vs-revealed | communication | **Sonnet 5** |

**Sequencing note.** #3 is a positioning decision and #1, #2 and #5 are copy/behaviour edits. #3 must land first *only where it overlaps* — the sharing sentence at README:7. #1, #2 and #5 touch disjoint surfaces (the storage table, the tutorial, the comparison table) and can proceed immediately without waiting on it. #4's copy half also waits on #3, since who the visual identity should address depends on whether the line-7 persona survives.

---

### Finding #1 — Local-folder support is stated five ways, two of them wrong

- **Gap:** `declared-vs-served`
- **Question:** communication
- **Category:** `adoption-gate` `audience-selection` `recognition`
- **Who it costs us:** a Safari-on-Mac user who reads the storage table, believes local folders will work, picks that path and hits a dead end — and a Firefox user who is told in the app that Firefox is fine when it isn't. Small share of arrivals, but they hit it at the exact moment they were converting.
- **Impact:** 5
- **Breadth:** **5 surfaces** (from `grep`), of which **2 are wrong**:
  - `README.md:51` — `Supported in Chrome and Edge, desktop or Android — not available on iOS or Firefox.` ❌ omits Safari on macOS
  - `src/components/AddVaultWizard.tsx:26` — `Works in Chrome and Edge, desktop or Android; not supported on iOS or Safari.` ❌ omits Firefox
  - `src/storage/exampleBackend.ts:397` — `On iOS, Safari, and Firefox, use a **GitHub repo**` ✅
  - `README.md:196` — `local folder access requires a Chromium-based browser` ✅
  - `src/storage/fs.ts:88` — `Use Chrome or Edge (desktop or Android), or connect a GitHub repo instead.` ✅
- **Evidence — the ground truth:** `src/storage/fs.ts:82-84`

  ```ts
  export function isFolderPickerSupported(): boolean {
    return typeof window.showDirectoryPicker === 'function'
  }
  ```

  `showDirectoryPicker` is Chromium-only, so the correct exclusion set is **Safari and Firefox on every platform** (which subsumes iOS, where all browsers are WebKit). The README and the wizard each drop a different half of that set — and the README contradicts *itself* between line 51 and line 196.
- **Recommended model:** **Haiku 4.5.** The truth is already known and written correctly in three of the five places; this is a mechanical alignment onto the `fs.ts:88` phrasing. The hazard that would normally raise the tier — "corrected" into a new wrong claim — is neutralised because the predicate is one line of code. A previous pass (`6669602`, *"Fix finding #1: local-folder support matrix and stale error copy"*) already attempted this and left two surfaces wrong, so **the task must name all five locations explicitly** rather than saying "fix the support matrix."
- **Problem:** a Safari or Firefox user is told local folders will work for them, picks that path, and finds it isn't offered.
- **Fix:** restate all five surfaces as "Chrome or Edge (desktop or Android); not available in Safari or Firefox," and delete the platform-specific enumerations that keep drifting.

---

### Finding #2 — The trial can't demonstrate the thing being sold

- **Gap:** `revealed-vs-served`
- **Question:** fit + communication
- **Category:** `adoption-gate` `proof` `feature-fit`
- **Who it costs us:** the evaluating visitor who took the "try it" invitation — i.e. **most arrivals**, since it is the primary call to action at README line 9 and the app's default vault. They come to test one claim (phone capture is fast) and that is the single claim the sandbox cannot answer.
- **Impact:** 8
- **Breadth:** 3 surfaces carry the invitation (`README.md:9`, the blog's closing paragraph, the app's default-vault behaviour in `vaultRegistry.ts`); **0 surfaces in the app's own chrome disclose the restriction** before a visitor hits it.
- **Evidence — the promise:**
  - `README.md:9` — `**[Open the app →](https://realjohndoe.github.io/meridian/)** — try the example vault first, nothing to sign up for.`
  - `README.md:3` — `**Tasks and a calendar that are actually good on your phone — stored as plain Markdown files you own.**`
- **Evidence — the product:** `src/storage/exampleBackend.ts:469` sets `readonly readOnly = true`, and `write()`/`delete()` are no-ops. The `+` button in `SearchBar.tsx:122` is **not gated on `readOnly`** — nor is the editor. The only in-app signal is in `src/storage/sync.ts:28`:

  ```ts
  setStoreState({ syncDirtyCount: 0, syncError: 'Read-only vault' })
  ```

  which `SyncButton.tsx` renders as `text-destructive` **inside a popover the visitor must open**, behind an icon tinted `var(--destructive)`. So the first screen of the demo shows a red fault indicator, and the explanation for it is one tap away. Everything else that discloses read-only status lives in the *body text of the tutorial notes themselves* — `This is a read-only sandbox — poke around freely.` (`exampleBackend.ts:99`) — i.e. only a visitor who reads the notes learns it.
- **Recommended model:** **Sonnet 5**, for the disclosure fix (a non-destructive read-only affordance on the create/save path, and demoting `'Read-only vault'` from an error to an informational state so the demo doesn't open on a red icon). **Opus 5 if the chosen fix is a writable scratch sandbox** backed by IndexedDB, because that touches the persistence port and the vault-registry lifecycle. The hazard that sets the tier: a naive fix simply disables the `+` button, which removes the friction *and* the demonstration — the visitor then cannot see capture at all, which is strictly worse for positioning than losing an entry.
- **Problem:** a visitor evaluating "is capture actually fast on my phone" cannot perform capture in the trial, and isn't told why until they open a red error popover.
- **Fix:** make the sandbox writable to local device storage (preferred — it demonstrates the lead differentiator), or at minimum surface a calm, non-destructive "tutorial vault — changes aren't saved" affordance on the create/save path and stop styling the state as an error.

---

### Finding #3 — "No accounts to create" is false for the person you share with

- **Gap:** `declared-vs-served`
- **Question:** fit + communication
- **Category:** `niche-definition` `audience-selection` `adoption-gate` `proof`
- **Who it costs us:** the sharee — the partner, child, or colleague named in the founding story. They are not an arrival at all today; they are someone the *primary* user is promised they can bring along, and cannot. It costs the primary user their reason to switch, at the moment they try to onboard the second person.
- **Impact:** 9
- **Breadth:** 2 surfaces (`README.md:7`; the blog's founding narrative). Deliberately promoted — line 7 is above the fold, third paragraph.
- **Evidence — the promise:** `README.md:7`

  > `**And whoever you share with doesn't have to be you.** Point Meridian at a repo and the people you share it with just open a web app — no vault to configure, no plugins, no accounts to create. Tag people on entries, filter the calendar down to one person.`

  and the founding motivation it descends from, `blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md:19-24`:

  > `The first: I want to keep track of our child's calendar, but she doesn't need a Proton account. Every system I tried wanted her to _be a user_ before she could _have a calendar_.`

- **Evidence — the product:** there is no accountless path. `AddVaultWizard.tsx:20` offers exactly two routes — `'Sign in with GitHub, or connect manually with an access token. Works on any device and browser.'` — and `GitHubBackend`'s constructor unconditionally builds `makeOctokit(cfg.token)` from a `GitHubConfig` whose `token` is non-optional. A `grep` for `anonymous`, `public repo`, `unauthenticated`, `share link`, and `invite` across `src/` returns **nothing**. The sharee must therefore have a GitHub account, be added as a collaborator on a private repo, and complete OAuth or paste a fine-grained PAT. Meridian currently wants her to *be a user* before she can *have a calendar* — the exact condition the project was founded to escape.
- **Recommended model:** **Opus 5 in plan mode, for a plan spanning multiple PRs.** This is not a copy fix; it is the question of whether the shared-calendar persona is a target at all, and the answer changes what the product is. The hazard that sets the tier is the confident rewrite: an agent told to "fix line 7" will most likely soften it into something that selects nobody ("easy sharing for your team"), which costs the differentiator without gaining accuracy — or will sharpen it into a claim about collaborator setup that reads as *more* developer-only than the current text. It cannot be lowered by naming the copy, because the copy depends on the build decision. **If you decide the direction first**, the resulting copy edit alone is Sonnet 5.
- **Problem:** the primary user adopts Meridian for the shared-calendar promise, then discovers the person they wanted to share with must create a GitHub account and be added to a repository.
- **Fix:** decide the sharing story, then state it. Options — (a) build an unauthenticated read path against a public repo, so a sharee genuinely just opens a link (delivers the promise; requires the vault be public); (b) keep the current model and rewrite line 7 to "everyone you share with reads and writes the same repo — no vault to configure, no plugins" (honest, weaker, free); (c) treat accountless sharing as a roadmap commitment and mark it as such on the surface rather than claiming it in the present tense.

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

### Finding #5 — The Todoist row gives away a real differentiator and invents a paywall

- **Gap:** `declared-vs-revealed`
- **Question:** communication
- **Category:** `differentiation` `proof`
- **Who it costs us:** the comparison-shopping reader who knows Todoist. They see Meridian concede parity on a feature Meridian actually wins, and they see a paywall claim they know to be false — which discounts every other row in the table. Small share of arrivals, high trust cost per reader.
- **Impact:** 6
- **Breadth:** 1 surface (`README.md:180`).
- **Evidence:** `README.md:180`

  ```
  | Multiple participants / assignees | ✅ | Partial | ❌ | ✅ | ✅ (paid) | ❌ |
  ```

  Both halves of the Todoist cell are wrong. Todoist supports **exactly one assignee per task** as an explicit product decision (the "Direct Responsible Individual" model) — so a ✅ on a row titled *Multiple* participants is not a small imprecision, it is the wrong answer. And assignment is available on the **free** plan (5 collaborators per project), so `(paid)` is false. Meanwhile Meridian's own `participants: string[]` (`src/types.ts:56`) is a genuine list, with calendar-wide filtering — one of the few rows where Meridian beats every named alternative outright, and the table hands it away.
- **Recommended model:** **Sonnet 5.** The correction itself is small, but the hazard is the one the plan names directly — a row "corrected" without checking the competitor. The task must require per-claim verification against vendor documentation, and should extend to the two rows this survey did not check (Google Keep, GitHub Issues). Not Haiku, because the failure mode is confident invention about products the model isn't re-reading.
- **Problem:** a reader who knows Todoist sees Meridian concede a feature it actually wins and assert a paywall that doesn't exist, and discounts the whole table.
- **Fix:** change the Todoist cell to `Partial (one assignee per task)`, drop `(paid)`, and re-verify the Google Keep and GitHub Issues cells in the same pass.

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

4. **Does the notes category stay in the headline?** It is already out of the README headline but still in `index.html`'s meta description and the blog's self-description (`a calendar, task manager, and notes app`). *Consequence:* keeping it invites an Obsidian comparison you have explicitly decided not to win.

5. **Is the LLM-friendly audience worth targeting?** It appears once, at README:98, with an Open Knowledge Format reference — and nowhere else on any surface. *Consequence:* either promote it deliberately or accept it as a footnote; a single mention does no selection work.

6. **Which feedback channel, given a product built on not running a server?** See section 5. *Consequence:* choosing none means the first launch teaches you only what the GitHub-fluent subset volunteers.

Everything outside this list is actionable without further input.
