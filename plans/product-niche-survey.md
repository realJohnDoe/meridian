# Product Niche Fit & Positioning Survey

Survey **Meridian's relationship to its own market niche**. Two questions, weighted equally:

1. **Fit** — how well does the product actually serve the niche it targets? Where does it under-serve that niche's real needs, over-serve needs the niche doesn't have, or quietly serve a different niche than the one it aims at?
2. **Communication** — how well does it tell people which niche it targets? Can the right person recognise "this is for me" in seconds, and can the wrong person recognise "this isn't for me" just as fast?

Produce the **top 5 findings** across both, each anchored to a verbatim quote from a real surface.

**Scope.** This is a survey of our own product and its positioning — not vendor research, and not a shopping exercise for components to integrate. Competing and adjacent products enter only as _the context that defines the niche_, and primarily through the set the README already names (Obsidian + TaskNotes, Google Calendar, GitHub Issues/Projects, Todoist, Google Keep). **One bounded exception:** the README makes factual claims about those products in its comparison table, and a stale claim about a competitor costs more trust than a missing feature does — so verifying those specific claims is in scope. Anything beyond that is a separate market-research exercise; record it as out of scope rather than drifting into it.

Code quality, UI implementation, speed, and data safety belong to the other surveys ([health-survey.md](health-survey.md), [health-survey-ui.md](health-survey-ui.md), [health-survey-performance.md](health-survey-performance.md), [health-survey-data-integrity.md](health-survey-data-integrity.md)) — cite them, don't duplicate them. A feature gap matters here only when it changes whether the target user can adopt the product.

**Visual design is in scope here, but from the opposite side of the UI survey.** That survey reads the same files — theme tokens, Tailwind usage, `components/ui/` — and asks whether the styling system is _internally consistent_. This survey asks whether the styling system says the _right thing about who this product is for_. A palette can be perfectly consistent and still address the wrong audience; a layout can be flawlessly systematic and still look like a different category of product. Same files, different question — when a finding is about consistency, hand it to the UI survey and say so.

## Product/market fit — what this survey can and cannot say

**It cannot assess product/market fit, and it must not pretend to.** PMF is a demand-side claim — do real people adopt this, keep using it, and choose it over what they use today? That is answered with evidence from outside the repository: retention, repeat use, unprompted feedback, people switching. This project currently has none of it. There is no analytics, telemetry, or feedback path in the app, `.github/` holds only workflows, and `plans/next-steps.md` lists only build work — market contact hasn't happened yet. There is no PMF signal here to read.

**Re-verify that premise before relying on it.** If a launch has happened, a feedback channel has shipped, or `next-steps.md` has grown a go-to-market item since this plan was written, then this section's premise has changed and the report should say so rather than repeating the paragraph above.

What this survey covers is the **precondition side**: niche coherence, recognisability, and adoption gates. Those can show you would **fail** PMF for a knowable reason — the right person can't tell it's for them, or can't get in the door. They can never show that you would pass.

**The hard rule that follows:** do not infer demand from the product. No claims about what users want, how big the audience is, what people would pay, or how a segment would react, unless you are quoting an actual artifact. This is the one place in the survey where confident invention is easy and worthless. When you catch yourself reaching for such a claim, stop and log it as a bet below — that is the useful form of the same thought.

Three things are legitimately available, and the report must deliver them:

- **The bet list.** State the product's core falsifiable bets — the things that must be true about real people for this to work — and for each, name the evidence that would confirm it and the evidence that would kill it. Derive them from what the product actually commits to (one timeline for tasks, events and notes; plain files being worth their setup cost; mobile experience as the wedge against the Obsidian + TaskNotes combination; recurrence depth mattering to real schedules), not from a template. Each bet should be phrased so that a forum thread, a first ten users, or a week of a stranger's use could refute it.
- **Dogfooding as the one real usage signal.** The author is the product's primary user, and PMF-of-one is legitimate early evidence. Read the repository for it: what the roadmap prioritises and why, what the example vault and fixtures reveal about actual use, where the code carries workarounds for the author's own friction. Report what daily use appears to confirm — and be equally interested in what it can't tell you, since a product shaped around one user's habits is the classic way a niche stays a niche of one.
- **Feedback-channel readiness.** Say what would have to exist for the first launch to teach anything at all, and note the genuine tension: a no-server, privacy-respecting, local-first product has principled reasons _not_ to add telemetry. Present the options that fit those values — an in-app feedback link, a discussions space, watching the forum thread — and route the choice to the decisions section. Do not recommend analytics by default.

## Phase 0 — establish the three niches (do this first, state it explicitly)

Everything else in this survey is a gap between these three. Write each as one or two sentences naming a **person**, the **job** they're hiring the product for, and the **alternative** they'd otherwise use.

- **Declared niche** — who the copy says this is for. Derive it from the surfaces, quoted: the README headline, the four "ideas behind Meridian", the comparison table and its honest-about-it paragraphs, the blog posts, the in-app copy.
- **Revealed niche** — who the product's _own priorities_ say it's for, ignoring the copy entirely. Read this off what the product actually invests in: which features are deep versus shallow, what the default path optimises for, which platforms and backends are first-class, what the example vault teaches, what the recurrence model assumes about a user's life. A product's real positioning is what it spent its effort on.
- **Served niche** — who can actually succeed with it today, given the real constraints: the storage options and the setup each demands, browser and platform support, what a user must already understand before the product pays off, what breaks for someone outside the assumed profile.

Then state the gaps plainly. **Declared vs. revealed** is a strategy question — are we building what we say we're building? **Revealed vs. served** is an execution question — can the people we build for actually get in the door? **Declared vs. served** is the credibility question — do we promise a person we can't currently serve? Nearly every finding is an instance of one of these three, and each finding must say which.

## Process

- **Derive, then judge, then write.** Phase 0 first and in writing, then the walk, then the findings. Do not decide the niche you _expect_ and collect quotes for it — derive the revealed niche from product evidence before re-reading the copy, so the copy can't anchor you.
- **Read the README cold, once, before anything else,** and record your honest first-pass answers to: what is this, who is it for, what would I use it instead of, and would I keep reading? That first read is unrepeatable — capture it before the code teaches you what the product means. It is the closest thing available to a real visitor's experience.
- **Check for prior runs of this survey before starting.** This plan has been run before, and its findings docs are deleted as the findings are fixed (`git log --all --grep="niche"`, and the `plans/` history generally). Read what earlier passes reported and what was fixed in response, so that: a fixed finding isn't reported again as new; a finding that was *attempted* and left half-fixed is called out as such, which is more valuable than either a fresh finding or a silent re-report; and a claim that regressed is distinguishable from one that was never right. Say in the coverage statement which prior runs you found.
- **Every finding needs a verbatim quote** from a real surface — README, in-app string, tutorial entry, blog, or code — copy-pasted, not paraphrased. I will spot-check by grepping, so **quotes must be grep-safe**: quote a span that lives on one line, or, where the source is hard-wrapped prose (the blog is wrapped at ~90 characters), say so and give the line range. A quote that silently spans a line break reads as fabricated when the spot-check fails. Fit findings additionally need the product evidence: the feature, constraint, or code that creates the gap.
- **Verify this plan's own quotes before relying on them.** The plan quotes copy that the product keeps changing, and a stale example here is exactly the kind of error the survey exists to catch. Where a quotation in this document no longer matches the live surface, use the live surface and note the drift in the coverage statement.
- **Time-box the recognition test.** Judge the surfaces by what a visitor learns in the first ~30 seconds — headline, first screen, first paragraph, the app's first view — and say explicitly at which line or screen the niche becomes unambiguous, or that it never does.
- **Make positioning measurable rather than a matter of taste:**
  - **Niche-signal audit.** For each claim and adjective in the positioning copy, name the audience it selects _and_ the audience it excludes. Take the headline from the live README, not from this plan — at the time of writing it is `**Tasks and a calendar that are actually good on your phone — stored as plain Markdown files you own.**`, where "actually good on your phone" selects the mobile-frustrated and implicitly concedes that rivals win elsewhere, "plain Markdown files you own" strongly attracts people who know what that implies and means nothing to people who don't, and "Tasks and a calendar" is a category pair rather than a niche. Report which signals do real selection work and which are noise.
  - **Term census.** Count the words each surface uses for the same concept across README, in-app copy, tutorial entries, and blog — deriving the counts yourself, and stating the method (whole-word? case-insensitive? does the `src/` count include identifiers as well as user-visible strings?), because a raw `grep` over `src/` counts code symbols that no reader ever sees. Vocabulary that fractures — "vault" dominating the UI source while the README barely uses it, the tour saying "a folder you own", getting-started saying "repo" — makes a product harder to recognise, because the reader can't tell whether they're being sold one thing or three.
  - **Emphasis map.** Compare the space each surface gives a capability against how central that capability is to the declared niche's job. A capability argued at length that the niche doesn't need, and a niche-defining capability mentioned once, are both findings.
  - **Blind visual read.** Screenshot the running app — mobile and desktop width, every theme it ships — and, _before_ re-reading any positioning copy, write down what kind of product it looks like, who it looks like it's for, what it looks like it costs, and which existing tool it most resembles. Visual identity is the fastest-read positioning signal there is: it lands before a single word is processed. Like the cold README read, this impression is unrepeatable — capture it first.
  - **Visual signal inventory.** Enumerate the concrete decisions — background lightness and hue, accent hue and saturation, corner radius, density and whitespace, typography, iconography, motion, use of badges, counts, and colour-coded urgency — and for each, name the audience it signals to and the product category it borrows from. Then check each against the declared niche. `src/index.css` is the primary evidence; quote the tokens.
  - **Adjacency test.** Put the product's look mentally beside the alternatives the README names. Does it read as belonging to that set, as belonging to a _different_ set, or as generic? Any of the three can be right — a deliberate outlier is a positioning choice — but it should be deliberate, and the report should say which it is.
- **Distinguish "doesn't fit the niche" from "isn't finished."** An immature feature that clearly serves the target job is execution debt, not a positioning problem. Call something a fit finding only when the product's _direction_ and the target's _needs_ diverge.
- **Say when the status quo is right.** A deliberately narrow niche, a feature deliberately not built, an audience deliberately turned away — these are strategy, and the report should confirm them as such when the evidence supports it, rather than reflexively recommending expansion. `Meridian supports notes, but it doesn't try to be a better note-taking app than Obsidian` is exactly this kind of decision: test whether the product honours it, don't second-guess it.
- Treat every copy claim as a hypothesis to verify against the code and the product.

## Budget

- **Read completely** (they are the positioning): `README.md` end to end; the prose in `blog/` — currently the three numbered post directories, of which `1-…/meridian-why-i-built-a-markdown-first-calendar.md` is the positioning post, `1-…/interview.md` and `3-…/interview.md` are prose, and `2-how-meridian-was-built/` is a generated explorer (`explorer.html`, `iterations.json`) that should be skimmed for framing only, not read; the coach tour (`src/onboarding/CoachTour.tsx`); and the tutorial entries seeded in `src/storage/exampleBackend.ts` — the example vault is the product's argument for itself, made in content.
- **Derive the revealed niche from the product, not the docs:** the feature surface (which capabilities are deep — recurrence, wikilinks, participants, search — and which are thin; line counts per `src/` directory are a fast first cut), the storage options and what each demands of a user (`src/storage/`, plus the trade-offs already recorded in [storage-backend-survey.md](storage-backend-survey.md)), platform and browser constraints, the entry-format surface area in `src/model/fieldRegistry.ts` (`INLINE_FIELDS`, `STRUCTURAL_KEYS`) and the rest of `src/model/`, and what the default first-run path optimises for.
- **Walk the first-run experience** on the example vault via the preview tools (follow the preview gotchas in `CLAUDE.md`: worktree-specific launch config, unique port, base path `/meridian/`). Judge it as a visitor deciding whether this product is for them. Note honestly that the automated browser **cannot complete GitHub OAuth or grant File System Access permissions**, so the real setup path can only be assessed from code and copy — state that limitation up front rather than discovering it mid-pass.
- **If no preview tooling is available in the session at all** — check before planning around it — do not silently skip the visual work or quietly substitute a guess for it. Say so in the coverage statement, fall back to assessing visual identity from `src/index.css` tokens, the dependency set, and layout source, mark category 3 **partially assessed**, and flag any finding that rests on the un-taken screenshots as needing confirmation before it is acted on. An impression invented from tokens is worse than an admitted gap.
- **Check the app's own front door**: `index.html`, the PWA manifest, the app name, and the icons (`public/icon*.png`). The install prompt and the home-screen icon are positioning surfaces too, and often the only ones a returning user sees.
- **Read the visual identity as evidence, not decoration:** the theme tokens and their comments in `src/index.css` (colour, radius, density), the typography, the icon set (`lucide-react` — one family, consistently used?), the interaction vocabulary the dependencies imply (`vaul` drawers signal a mobile-native product; heavy dialog use would signal a desktop one), and the app icons. Capture screenshots at mobile and desktop width in every theme the app ships — the blind visual read above depends on them, so take them before analysing anything else.
- **Bounded competitor verification only**, per the scope note: confirm the comparison table's specific factual claims, nothing further.
- Skim the rest so nothing is invisible. Record anything skipped in the coverage statement.

## Output structure

### 1. Niche verdict (~6 sentences)

State the three niches from Phase 0 in one line each, then answer the two headline questions directly: how well does the product fit its niche, and how well does it communicate it? Name the **widest of the three gaps** and the **single change that would close the most of it**. This is the answer; the findings are the evidence.

### 2. Coverage statement

- Your cold-read first impressions, recorded before analysis (what you thought this was, who for, instead of what).
- Which surfaces you read completely, which you sampled, and what you assessed from code and copy only because it couldn't be walked.
- Which comparison-table claims you verified and which you couldn't.
- Anything you suspect but couldn't verify — flag it "unverified," and say what would settle it.

### 3. Category verdicts

One line per category (1–7): **clean** (the walk for this category was executed and nothing turned up), **findings: #N, #M**, or **partially assessed** (say what was skipped and why). Clean is only available to categories actually walked.

A category can also be walked, turn up something real, and still lose its slot to the top-5 cap. Don't round that to "clean" — it isn't — and don't pad the findings list to accommodate it. Mark the category **findings: below the cut**, and record the item in a single short paragraph after the findings, with its quote and an impact score, clearly marked as sub-threshold. One or two of these is a sign the cap is working; five means the cap is wrong for this run and you should say that instead.

This section is also where the status quo gets confirmed. If a category's walk found a deliberate narrowness, a non-goal the product honours, or an audience correctly turned away, say so here with the evidence — the plan asks for that judgment in the Process section, and it needs somewhere to land that isn't the findings list.

### 4. Findings — top 5

For each finding:

- **Title** — short label
- **Gap** — which of the three: `declared-vs-revealed` (strategy), `revealed-vs-served` (execution), or `declared-vs-served` (credibility)
- **Question** — `fit` or `communication` (or both)
- **Category** — one or more of: `niche-definition` `differentiation` `recognition` `visual-language` `aesthetic-fit` `audience-selection` `feature-fit` `adoption-gate` `proof` `identity`
- **Who it costs us** — the person who bounces, misjudges, or churns because of it, and roughly what share of arrivals are that person. **"Unknown" is a permitted and often correct answer**: this field must not become the back door through which invented demand claims re-enter the report. Where the share is knowable from an artifact (which surface carries it, how far down the page it sits, whether it is on the default path), say so and how you know; where it isn't, write "unknown" and add it to the bet list in section 5 instead of estimating
- **Impact** — 1–10, where 10 = the product targets a niche it cannot serve, or the right visitor cannot tell the product is for them; 5 = a real differentiator goes unrecognised, or a segment is attracted and then disappointed; 1 = a wording nit with no selection consequence
- **Evidence** — verbatim quote(s) with file paths; for fit findings, also the product evidence (feature, constraint, or code) that creates the gap
- **Breadth** — how many surfaces carry it; from an actual search — name it; "est." if estimated
- **Recommended model** — which tier is capable enough to do this fix well: **Haiku 4.5** / **Sonnet 5** / **Opus 5** / **Opus 5 in plan mode, for a plan spanning multiple PRs** (or the current equivalent tier). Judge by how much of the fix is load-bearing judgment versus mechanical edit, and by **how the fix fails** — here the dangerous failure is a confident rewrite that sounds better and positions worse: copy broadened until it selects nobody, a differentiator sharpened into a claim the product can't back, a term unified on one surface so the vocabulary fractures further, a comparison row "corrected" without checking the competitor. Reserve plan mode + multi-PR for anything that changes **what the product is or who it's for** — the niche itself, the headline, the lead differentiator, whether to chase an emerging audience. Those are the user's decisions: the plan lays out options and consequences, it does not pick. **State the specific hazard that sets the tier**, and say when naming it would allow a lower one (e.g. "Haiku 4.5 if the approved headline text is given in the task; else Opus 5 in plan mode")
- **Problem** — one sentence: what the target user misunderstands, misses, or walks away from
- **Fix** — one sentence: the concrete change; for anything touching the niche itself, present options rather than asserting one

Rank by `(impact × breadth) ÷ effort`, where `effort` is the tier as an ordinal — Haiku 4.5 = 1, Sonnet 5 = 2, Opus 5 = 3, Opus 5 plan-mode/multi-PR = 5 — but report the fields separately so the reader can re-sort. Add a **summary table** (finding → gap → question → recommended model) above the findings.

**This formula routinely inverts the impact ordering, and that is intended, not a bug to correct.** A cheap mechanical fix touching five surfaces will outrank a strategy finding twice its impact, because the formula ranks return on effort, not importance. It therefore appears to contradict the scoring guidance at the foot of this document ("a gap that makes the right user bounce outranks any amount of imprecise wording"). Resolve it this way, explicitly, every time: **the niche verdict leads on impact** — it names the widest gap and the single change that would close the most of it, regardless of cost — while **the findings list ranks on the formula**. When the two orderings disagree, say so in one line above the findings table, so the reader is not left thinking the report buried its own headline.

Where findings touch the same surface, add a one-line **sequencing note**: positioning decisions must land before the copy edits that express them, or the edits get redone.

### 5. PMF bets and what would test them

Deliver the three items from the product/market-fit section above: the bet list (each with its confirming and killing evidence), the dogfooding read, and the feedback-channel options. Keep it to a page. State plainly at the top that this is not a PMF assessment and cannot be one — it is the list of things the first real contact with the market would settle, written so that contact can actually settle them.

Findings do **not** live here: nothing in this section is ranked, scored, or given a model tier. It is a set of open questions, and its value is that it stays open.

### 6. The decisions only you can make

Close with a short, explicit list of the **strategy questions this survey surfaces but must not answer** — what the niche is, who the beachhead user is, which differentiator leads, whether the notes category stays in the pitch (it has already left the three shortest surfaces — the README headline, the `index.html` meta description, and the PWA manifest — but survives in the README feature list and philosophy, the blog's self-description, and the coach tour's opening sentence; check where it currently lives before framing the question), whether the LLM-friendly audience is worth targeting, and which feedback channel (if any) fits a product built on not running a server. State the options and the consequence of each, then stop. Everything outside this list should be actionable without further input.

Do not pad to 8 — a short report grounded in real quotes beats a long one built on speculation.

---

## Categories to walk — ranked by priority

The ranking is a tiebreaker, not a filter. Bullets are illustrative, not the boundary.

### 1. Niche fit — does the product serve the job it targets? _(highest weight)_

**Scope:** the match between the target user's actual job and what the product invests in.

- **Under-serving:** something the target niche needs in order to adopt at all that the product doesn't do, or does too shallowly to rely on
- **Over-serving:** depth built for a user the product isn't targeting — sophistication the declared niche would never miss
- **Mis-serving:** capability aimed at a different niche than the declared one, competing for attention with the real job
- Whether the product honours its own stated non-goals, or drifts toward the competitor it declared it wouldn't chase
- Whether the niche the product is _best_ at is the niche it claims — a product often fits an adjacent niche better than its declared one, and that is a strategy finding, not a bug

### 2. Niche recognition — the first 30 seconds

**Scope:** how fast, and how correctly, a visitor can place this product.

- Whether the headline names a niche or lists categories; whether "who this is for" appears anywhere above the fold
- How far a reader must get before the product is placeable against tools they already know
- Philosophy-before-placement ordering: the right content in the wrong position
- Whether the app's own first screen communicates a niche or only an interface
- Whether name, icon, and install metadata reinforce a recognisable identity or stay generic

### 3. Visual identity & aesthetic fit

**Scope:** whether the look — layout, colour, density, typography, motion — signals the niche the product targets. This is the positioning question about the same files the UI survey reads for consistency; keep the two apart.

- **Category dialect:** whether the palette, chrome, and density place the product in the family it wants to be read as (local-first tools for thought, consumer calendar, developer utility, enterprise dashboard) — and whether that family is the declared niche's family. Colour choices carry this fastest; a code-editor palette and a consumer-calendar palette recruit different people before a word is read
- **Layout as a claim about the job:** what the default view's information density, hierarchy, and whitespace assert about how the user is expected to work — a dense grid says power tool, a spacious single column says calm daily companion — and whether that matches the promise
- **Mobile-first proof, visually:** if great mobile UX is the lead differentiator, whether the app _looks_ mobile-native at phone width (drawers, thumb reach, one-handed layout) rather than a desktop layout that merely reflows
- **Character-versus-promise mismatches:** urgency and pressure cues (colour-coded overdue states, counts, badges, streaks, nagging empty states) weighed against a promise of calm; or the reverse — a product promising rigour that looks unserious
- **Theming as audience selection:** which theme a first-time visitor sees by default, and who that recruits or repels
- **Distinctiveness versus genericness:** whether the interface is recognisable as _this_ product, or is default-styled to the point of being unmemorable — and whether the app icon and home-screen presence carry the same identity as the app itself
- **Deliberate divergence:** where the look intentionally breaks from the category, whether that reads as a point of view or as an accident — and say so when it's working

### 4. Differentiation & alternatives

**Scope:** whether the reason to choose this over the obvious alternative is clear and credible.

- Whether one lead differentiator is chosen and repeated, or many are listed at equal weight — a table where every row looks equally important asserts no priority
- Comparison claims about other products that are stale, unfair, or unverifiable, and the trust cost of each
- Differentiators that are real but never claimed anywhere prominent
- Claims a competitor could match trivially, presented as a moat
- Honest limitations stated well — where conceding something earns credibility, note it as working

### 5. Audience selection — attracting and repelling

**Scope:** whether the surfaces sort visitors correctly, in both directions.

- Signals that attract someone the product will disappoint — a promise the served niche can't cash
- Signals that repel someone the product would serve well: unnecessary jargon, assumed tooling knowledge, a setup path that reads as "developers only"
- Whether any surface says plainly who this is _not_ for; failing to exclude is a positioning failure, not politeness
- Mismatch between the register of the pitch and the register of the setup instructions
- Whether the free/open-source/no-server story is positioned as a benefit to the target user or merely stated as a fact about the architecture

### 6. Adoption gates

**Scope:** what a target user must accept, learn, or configure before the product pays off.

- The conceptual model's learning cost versus its payoff, and whether the surfaces make that trade explicit
- Setup demands (accounts, repos, tokens, browser choice) measured against the declared audience's tolerance
- Platform constraints that silently exclude part of the target niche
- Where the product asks for commitment before it has demonstrated value
- Whether a try-before-committing path exists, is discoverable, and is convincing

### 7. Niche drift & emerging signals

**Scope:** whether the positioning still matches where the product and its context are going.

- Positioning written for an earlier version of the product, or claims that predate features which changed the story
- Emerging audiences visible in the product but absent from the pitch (e.g. the LLM/agent-context angle stated once and nowhere else)
- A niche narrowing or widening in the code without the copy following
- Surfaces that disagree because they were written at different times — blog, README, and in-app copy each freezing a different era's positioning

---

**Scoring guidance:** A gap that makes the right user bounce outranks any amount of imprecise wording. A misfit between what the product is best at and what it claims outranks a missing feature, because the first is a strategy error and the second is a backlog item. Weight by how many arrivals encounter the problem: the headline and the first screen outrank a section most readers never scroll to. Confirm deliberate narrowness as a strength when the evidence supports it — recommending that a focused product become a general one is almost always the wrong answer, and this survey must never reach for it by default.
