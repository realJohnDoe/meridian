# Product Niche Fit & Positioning Survey

Survey **Meridian's relationship to its own market niche**. Two questions, weighted equally:

1. **Fit** — how well does the product actually serve the niche it targets? Where does it under-serve that niche's real needs, over-serve needs the niche doesn't have, or quietly serve a different niche than the one it aims at?
2. **Communication** — how well does it tell people which niche it targets? Can the right person recognise "this is for me" in seconds, and can the wrong person recognise "this isn't for me" just as fast?

Produce the **top 5 findings** across both, each anchored to a verbatim quote from a real surface.

Shared process, scoring, and reporting rules — model-tier ratings, the ranking
formula, category-verdict conventions, and how to report results — live in [the
shared survey conventions](./README.md). Read that first; this file states only
what's specific to this survey.

**Scope.** A survey of our own product and its positioning — not vendor research, and not a shopping exercise for components to integrate. Competing products enter only as *the context that defines the niche*, and primarily through the set the README already names (Obsidian + TaskNotes, Google Calendar, GitHub Issues/Projects, Todoist, Google Keep). **One bounded exception:** the README makes factual claims about those products in its comparison table, and a stale claim about a competitor costs more trust than a missing feature does — so verifying those specific claims is in scope. Anything beyond that is separate market research; record it as out of scope rather than drifting into it.

Code quality, UI implementation, speed and data safety belong to the other surveys ([health.md](health.md), [health-ui.md](health-ui.md), [performance.md](performance.md), [data-integrity.md](data-integrity.md)) — cite them, don't duplicate them. A feature gap matters here only when it changes whether the target user can adopt the product.

**Visual design is in scope, but from the opposite side of the UI survey.** That survey reads the same files — theme tokens, Tailwind usage, `components/ui/` — and asks whether the styling system is *internally consistent*. This survey asks whether it says the *right thing about who this product is for*. A palette can be perfectly consistent and still address the wrong audience. Same files, different question: when a finding is about consistency, hand it to the UI survey and say so.

## Product/market fit — what this survey can and cannot say

**It cannot assess product/market fit, and must not pretend to.** PMF is a demand-side claim — do real people adopt this, keep using it, choose it over what they use today? That is answered with evidence from outside the repository, and this project has none of it: no analytics, telemetry or feedback path in the app, and `.github/` holds only workflows. **Re-verify that premise** rather than inheriting it — if a launch has happened or a feedback channel has shipped since, say so.

What this survey covers is the **precondition side**: niche coherence, recognisability, adoption gates. Those can show you would **fail** PMF for a knowable reason — the right person can't tell it's for them, or can't get in the door. They can never show you would pass.

**The hard rule that follows:** do not infer demand from the product. No claims about what users want, how big the audience is, what people would pay, or how a segment would react, unless you are quoting an actual artifact. This is the one place in the survey where confident invention is easy and worthless. When you catch yourself reaching for such a claim, log it as a bet in section 5 instead — that is the useful form of the same thought.

Three things *are* legitimately available, and the report must deliver them (section 5):

- **The bet list.** The product's core falsifiable bets — what must be true about real people for this to work — each with the evidence that would confirm it and the evidence that would kill it. Derive them from what the product actually commits to (one timeline for tasks, events and notes; plain files being worth their setup cost; mobile as the wedge against Obsidian + TaskNotes; recurrence depth mattering to real schedules), not from a template. Phrase each so a forum thread, a first ten users, or a week of a stranger's use could refute it.
- **Dogfooding as the one real usage signal.** The author is the primary user, and PMF-of-one is legitimate early evidence. Read the repo for it: what the roadmap prioritises, what the example vault and fixtures reveal about actual use, where the code carries workarounds for the author's own friction. Be equally interested in what it can't tell you — a product shaped around one user's habits is the classic way a niche stays a niche of one.
- **Feedback-channel readiness.** What would have to exist for a first launch to teach anything, and the genuine tension: a no-server, privacy-respecting, local-first product has principled reasons *not* to add telemetry. Present options that fit those values (an in-app feedback link, a discussions space, watching the forum thread) and route the choice to section 6. Do not recommend analytics by default.

## Phase 0 — establish the three niches (first, and in writing)

Everything else is a gap between these three. Write each as one or two sentences naming a **person**, the **job** they're hiring the product for, and the **alternative** they'd otherwise use.

- **Declared niche** — who the copy says this is for. Derive it from quoted surfaces: the README headline, the four "ideas behind Meridian", the comparison table, the blog posts, the in-app copy.
- **Revealed niche** — who the product's own priorities say it's for, ignoring the copy entirely. Read it off what the product invests in: which features are deep versus shallow, what the default path optimises for, which platforms and backends are first-class, what the example vault teaches, what the recurrence model assumes about a user's life.
- **Served niche** — who can actually succeed with it today, given the real constraints: the storage options and the setup each demands, browser and platform support, what a user must already understand before the product pays off, what breaks for someone outside the assumed profile.

Then state the gaps plainly. **Declared vs. revealed** is a strategy question — are we building what we say we're building? **Revealed vs. served** is execution — can the people we build for get in the door? **Declared vs. served** is credibility — do we promise a person we can't serve? Nearly every finding is an instance of one of the three, and each must say which.

## Process

- **Derive, then judge, then write.** Phase 0 first and in writing, then the walk, then the findings. Derive the revealed niche from product evidence *before* re-reading the copy, so the copy can't anchor you.
- **Read the README cold, once, before anything else,** and record your honest first-pass answers to: what is this, who is it for, what would I use it instead of, would I keep reading? That first read is unrepeatable — capture it before the code teaches you what the product means. It's the closest thing to a real visitor's experience.
- **Every finding needs a verbatim quote** from a real surface, per the [shared Evidence rule](./README.md#finding-fields). The blog is hard-wrapped at ~90 characters, so give a line range there rather than a quote that silently spans a break. Fit findings additionally need the product evidence — the feature, constraint or code that creates the gap.
- **Verify this file's own quotes before relying on them.** It quotes copy the product keeps changing, and a stale example here is exactly the error the survey exists to catch. Where a quotation no longer matches the live surface, use the live surface and note the drift.
- **Time-box the recognition test.** Judge the surfaces by what a visitor learns in the first ~30 seconds — headline, first screen, first paragraph, the app's first view — and say at which line or screen the niche becomes unambiguous, or that it never does.
- **Make positioning measurable rather than a matter of taste:**
  - **Niche-signal audit.** For each claim and adjective in the positioning copy, name the audience it selects *and* the audience it excludes. Take the headline from the live README, not from this file. Report which signals do real selection work and which are noise.
  - **Term census.** Count the words each surface uses for the same concept across README, in-app copy, tutorial entries and blog — deriving the counts yourself and **stating the method**, because a raw `grep` over `src/` counts code symbols no reader ever sees. The method that worked last run: whole-word, case-insensitive, and for `src/` count only quoted string literals and JSX text in non-test `.tsx` files (`grep -ohE '("[^"]*"|'\''[^'\'']*'\''|>[^<>{}]+<)'`). For "vault" that gave 33 user-visible strings against 1,749 raw matches — the method changes the finding by two orders of magnitude, so report both numbers. Vocabulary that fractures ("vault" dominating the UI while the README barely uses it, the tour saying "a folder you own", getting-started saying "repo") makes a product harder to recognise.
  - **Emphasis map.** Compare the space each surface gives a capability against how central it is to the declared niche's job. A capability argued at length that the niche doesn't need, and a niche-defining capability mentioned once, are both findings.
  - **Blind visual read.** Screenshot the running app — mobile and desktop width, every theme — and *before* re-reading any positioning copy, write down what kind of product it looks like, who for, what it looks like it costs, and which existing tool it most resembles. Visual identity lands before a single word is processed, and this impression is unrepeatable: capture it first.
  - **Visual signal inventory.** Enumerate the concrete decisions — background lightness and hue, accent saturation, corner radius, density, typography, iconography, motion, badges, counts, colour-coded urgency — and for each name the audience it signals to and the product category it borrows from. Then check each against the declared niche. `src/index.css` is the primary evidence; quote the tokens.
  - **Adjacency test.** Put the product's look mentally beside the alternatives the README names. Does it read as belonging to that set, a *different* set, or as generic? Any of the three can be right — a deliberate outlier is a positioning choice — but it should be deliberate, and the report should say which.
- **Distinguish "doesn't fit the niche" from "isn't finished."** An immature feature that clearly serves the target job is execution debt, not a positioning problem. Call something a fit finding only when the product's *direction* and the target's *needs* diverge.
- **Say when the status quo is right.** A deliberately narrow niche, a feature deliberately not built, an audience deliberately turned away — these are strategy, and the report should confirm them as such when the evidence supports it rather than reflexively recommending expansion. *"Meridian supports notes, but it doesn't try to be a better note-taking app than Obsidian"* is exactly this kind of decision: test whether the product honours it, don't second-guess it.

## Budget

- **Read completely** (they *are* the positioning): `README.md` end to end; the prose in `blog/` — the numbered post directories, of which `1-…/meridian-why-i-built-a-markdown-first-calendar.md` is the positioning post and the two `interview.md` files are prose, while `2-how-meridian-was-built/` is a generated explorer to skim for framing only; the coach tour (`src/onboarding/CoachTour.tsx`); and the tutorial entries in `src/storage/devFixtures/tutorialVault.ts` (`exampleBackend.ts` is only the ~66-line shim that serves them) — the Tutorial vault is the product's argument for itself, made in content.
- **Derive the revealed niche from the product, not the docs:** the feature surface (which capabilities are deep — recurrence, wikilinks, participants, search — and which are thin; per-directory line counts are a fast first cut), the storage options and what each demands of a user (`src/storage/`, plus [storage-backend.md](../reports/storage-backend.md)), platform and browser constraints, the entry-format surface in `src/model/fieldRegistry.ts` (`INLINE_FIELDS`, `STRUCTURAL_KEYS`), and what the default first-run path optimises for.
- **Walk the first-run experience** on the example vault, judging it as a visitor deciding whether this product is for them. The real setup path can only be assessed from code and copy — see [what this environment can and cannot do](./README.md#what-this-environment-can-and-cannot-do) — so state that up front.
- **Take the screenshots yourself if there is no preview tooling** — check before planning around it, and don't treat this as a last resort. `@playwright/test` is a devDependency (it drives `e2e/` and `scripts/perf/stress.mjs`), so a session with Bash and a Chromium binary can still take real screenshots: start the server (`pnpm exec vite --port <unique> --strictPort`), then drive it from a scratch script — importing `@playwright/test` by absolute path if the script lives outside the repo — at 390×844 and 1440×900, setting `localStorage['meridian_theme']` in an init script to reach each palette. That path was taken on the last run and category 3 came back fully assessed. Only if that is also unavailable: say so in the coverage statement, fall back to assessing visual identity from `src/index.css` tokens and layout source, mark category 3 **partially assessed**, and flag any finding resting on the un-taken screenshots. An impression invented from tokens is worse than an admitted gap.
- **Check the app's own front door:** `index.html`, the PWA manifest, the app name, the icons (`public/icon*.png`). The install prompt and home-screen icon are positioning surfaces too, and often the only ones a returning user sees.
- **Read the visual identity as evidence, not decoration:** the theme tokens and their comments in `src/index.css`, the typography, the icon set (`lucide-react` — one family, consistently used?), and the interaction vocabulary the dependencies imply (`vaul` drawers signal a mobile-native product; heavy dialog use would signal a desktop one).
- **Bounded competitor verification only**, per the scope note: confirm the comparison table's specific factual claims, nothing further.
- Skim the rest so nothing is invisible. Record anything skipped.

## Output structure

**Reporting:** per the [shared reporting conventions](./README.md#reporting), including suggested improvements to this survey file itself.

### 1. Niche verdict (~6 sentences)

State the three niches from Phase 0 in one line each, then answer the two headline questions directly. Name the **widest of the three gaps** and the **single change that would close the most of it**.

### 2. Coverage statement

Your cold-read first impressions, recorded before analysis (what you thought this was, who for, instead of what). Which surfaces you read completely, which you sampled, and what you assessed from code and copy only because it couldn't be walked. Which comparison-table claims you verified and which you couldn't. Anything unverified, and what would settle it.

### 3. Category verdicts

One line per category (1–7), per the [shared convention](./README.md#category-verdicts); here "the plan" means the walk, and **clean** is only available to categories actually walked.

A category can be walked, turn up something real, and still lose its slot to the top-5 cap. Don't round that to "clean" — mark it **findings: below the cut** and record the item in one short paragraph after the findings, with its quote and impact score, clearly marked sub-threshold. One or two of these means the cap is working; five means the cap is wrong for this run, and you should say that instead.

This is also where the status quo gets confirmed: a deliberate narrowness, a non-goal the product honours, an audience correctly turned away — with the evidence.

### 4. Findings — top 5

Findings carry the [shared fields](./README.md#finding-fields), with three notes: `Breadth` counts **surfaces** rather than files; `Problem` is what the target user misunderstands, misses or walks away from; and `Fix` must present options rather than assert one for anything touching the niche itself. This survey adds:

- **Gap** — `declared-vs-revealed` (strategy), `revealed-vs-served` (execution), or `declared-vs-served` (credibility). One case recurs that none of the three names cleanly: the product **serves better than it declares** — a real strength the copy asserts but never evidences. Label that `declared-vs-served (inverted)` and say so in a clause, rather than forcing a label that reads backwards.
- **Question** — `fit` or `communication` (or both)
- **Category** — one or more of: `niche-definition` `differentiation` `recognition` `visual-language` `aesthetic-fit` `audience-selection` `feature-fit` `adoption-gate` `proof` `identity`
- **Who it costs us** — the person who bounces, misjudges or churns, and roughly what share of arrivals are that person. **"Unknown" is permitted and often correct**: this field must not become the back door through which invented demand claims re-enter the report. Where the share is knowable from an artifact (which surface carries it, how far down the page, whether it's on the default path), say so and how you know; otherwise write "unknown" and add it to the bet list.
- **Impact** — 1–10 (10 = the product targets a niche it cannot serve, or the right visitor can't tell it's for them; 5 = a real differentiator goes unrecognised, or a segment is attracted then disappointed; 1 = a wording nit with no selection consequence)

**Fails silently here:** a confident rewrite that sounds better and positions worse — copy broadened until it selects nobody, a differentiator sharpened into a claim the product can't back, a term unified on one surface so the vocabulary fractures further, a comparison row "corrected" without checking the competitor. Reserve plan mode + multi-PR for anything that changes **what the product is or who it's for** — the niche, the headline, the lead differentiator, whether to chase an emerging audience. Those are the user's decisions: the plan lays out options and consequences, it does not pick. Hazard note example: "Haiku 4.5 if the approved headline text is given in the task; else Opus 5 in plan mode."

The summary table adds `gap` and `question` columns. **The ranking formula routinely inverts the impact ordering here, and that is intended** — it ranks return on effort, so a cheap copy fix touching five surfaces outranks a strategy finding twice its impact. Resolve it explicitly every time: the **niche verdict leads on impact**, the **findings list ranks on the formula**, and one line above the table says so when they disagree. Where findings touch the same surface, add a **sequencing note** — positioning decisions must land before the copy edits that express them, or the edits get redone.

### 5. PMF bets and what would test them

The three deliverables from the PMF section: the bet list (each with confirming and killing evidence), the dogfooding read, and the feedback-channel options. Keep it to a page, and state plainly at the top that this is not a PMF assessment and cannot be one. Findings do **not** live here: nothing in this section is ranked, scored or tiered. It is a set of open questions, and its value is that it stays open.

### 6. The decisions only you can make

A short, explicit list of the **strategy questions this survey surfaces but must not answer** — what the niche is, who the beachhead user is, which differentiator leads, whether the notes category stays in the pitch (check where it currently lives before framing that one), whether the LLM-friendly audience is worth targeting, and which feedback channel fits a product built on not running a server. State the options and the consequence of each, then stop. Everything outside this list should be actionable without further input.

---

## Categories to walk — ranked by priority

Bullets are illustrations, not your search space — see [Running a survey](./README.md#running-a-survey).

### 1. Niche fit — does the product serve the job it targets? _(highest weight)_

**Scope:** the match between the target user's actual job and what the product invests in.

- **Under-serving:** something the niche needs in order to adopt at all that the product doesn't do, or does too shallowly to rely on
- **Over-serving:** depth built for a user the product isn't targeting — sophistication the declared niche would never miss
- **Mis-serving:** capability aimed at a different niche, competing for attention with the real job
- Whether the product honours its own stated non-goals, or drifts toward the competitor it declared it wouldn't chase
- Whether the niche the product is *best* at is the niche it claims — a strategy finding, not a bug

### 2. Niche recognition — the first 30 seconds

**Scope:** how fast, and how correctly, a visitor can place this product.

- Whether the headline names a niche or lists categories; whether "who this is for" appears above the fold
- How far a reader must get before the product is placeable against tools they already know
- Philosophy-before-placement ordering: the right content in the wrong position
- Whether the app's own first screen communicates a niche or only an interface
- Whether name, icon and install metadata reinforce a recognisable identity or stay generic

### 3. Visual identity & aesthetic fit

**Scope:** whether the look — layout, colour, density, typography, motion — signals the niche the product targets. Keep this apart from the UI survey's consistency question.

- **Category dialect:** whether the palette, chrome and density place the product in the family it wants to be read as (local-first tools for thought, consumer calendar, developer utility, enterprise dashboard) — and whether that family is the declared niche's. A code-editor palette and a consumer-calendar palette recruit different people before a word is read.
- **Layout as a claim about the job:** what the default view's density, hierarchy and whitespace assert about how the user is expected to work — a dense grid says power tool, a spacious single column says calm daily companion — and whether that matches the promise
- **Mobile-first proof, visually:** if great mobile UX is the lead differentiator, whether the app *looks* mobile-native at phone width (drawers, thumb reach, one-handed layout) rather than a desktop layout that merely reflows
- **Character-versus-promise mismatches:** urgency cues (colour-coded overdue states, counts, badges, nagging empty states) against a promise of calm — or the reverse, a product promising rigour that looks unserious
- **Theming as audience selection:** which theme a first-time visitor sees, and who that recruits or repels
- **Distinctiveness versus genericness**, and **deliberate divergence** — where the look intentionally breaks from the category, whether that reads as a point of view or an accident. Say so when it's working.

### 4. Differentiation & alternatives

**Scope:** whether the reason to choose this over the obvious alternative is clear and credible.

- Whether one lead differentiator is chosen and repeated, or many are listed at equal weight — a table where every row looks equally important asserts no priority
- Comparison claims about other products that are stale, unfair or unverifiable, and the trust cost of each
- Differentiators that are real but never claimed anywhere prominent; claims a competitor could match trivially, presented as a moat
- Honest limitations stated well — where conceding something earns credibility, note it as working

### 5. Audience selection — attracting and repelling

**Scope:** whether the surfaces sort visitors correctly, in both directions.

- Signals that attract someone the product will disappoint — a promise the served niche can't cash
- Signals that repel someone the product would serve well: unnecessary jargon, assumed tooling knowledge, a setup path that reads as "developers only"
- Whether any surface says plainly who this is *not* for; failing to exclude is a positioning failure, not politeness
- Mismatch between the register of the pitch and the register of the setup instructions
- Whether the free/open-source/no-server story is positioned as a benefit to the target user or merely stated as a fact about the architecture

### 6. Adoption gates

**Scope:** what a target user must accept, learn or configure before the product pays off.

- The conceptual model's learning cost versus its payoff, and whether the surfaces make that trade explicit
- Setup demands (accounts, repos, tokens, browser choice) measured against the declared audience's tolerance
- Platform constraints that silently exclude part of the target niche
- Where the product asks for commitment before it has demonstrated value
- Whether a try-before-committing path exists, is discoverable, and is convincing

### 7. Niche drift & emerging signals

**Scope:** whether the positioning still matches where the product and its context are going.

- Positioning written for an earlier version of the product, or claims that predate features which changed the story
- Emerging audiences visible in the product but absent from the pitch (the LLM/agent-context angle stated once and nowhere else)
- A niche narrowing or widening in the code without the copy following
- Surfaces that disagree because they were written at different times — blog, README and in-app copy each freezing a different era's positioning

---

**Scoring guidance:** A gap that makes the right user bounce outranks any amount of imprecise wording. A misfit between what the product is best at and what it claims outranks a missing feature, because the first is a strategy error and the second a backlog item. Weight by how many arrivals encounter the problem: the headline and first screen outrank a section most readers never scroll to. Confirm deliberate narrowness as a strength when the evidence supports it — recommending that a focused product become a general one is almost always the wrong answer, and this survey must never reach for it by default.
