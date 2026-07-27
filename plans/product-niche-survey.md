# Product Niche Fit & Positioning Survey

Survey **Meridian's relationship to its own market niche**. Two questions, weighted equally:

1. **Fit** — how well does the product actually serve the niche it targets? Where does it under-serve that niche's real needs, over-serve needs the niche doesn't have, or quietly serve a different niche than the one it aims at?
2. **Communication** — how well does it tell people which niche it targets? Can the right person recognise "this is for me" in seconds, and can the wrong person recognise "this isn't for me" just as fast?

Produce the **top 8 findings** across both, each anchored to a verbatim quote from a real surface.

**Scope.** This is a survey of our own product and its positioning — not vendor research, and not a shopping exercise for components to integrate. Competing and adjacent products enter only as *the context that defines the niche*, and primarily through the set the README already names (Obsidian + TaskNotes, Google Calendar, GitHub Issues/Projects, Todoist, Google Keep). **One bounded exception:** the README makes factual claims about those products in its comparison table, and a stale claim about a competitor costs more trust than a missing feature does — so verifying those specific claims is in scope. Anything beyond that is a separate market-research exercise; record it as out of scope rather than drifting into it.

Code quality, UI implementation, speed, and data safety belong to the other surveys ([health-survey.md](health-survey.md), [health-survey-ui.md](health-survey-ui.md), [health-survey-performance.md](health-survey-performance.md), [health-survey-data-integrity.md](health-survey-data-integrity.md)) — cite them, don't duplicate them. A feature gap matters here only when it changes whether the target user can adopt the product.

## Phase 0 — establish the three niches (do this first, state it explicitly)

Everything else in this survey is a gap between these three. Write each as one or two sentences naming a **person**, the **job** they're hiring the product for, and the **alternative** they'd otherwise use.

- **Declared niche** — who the copy says this is for. Derive it from the surfaces, quoted: the README headline, the four "ideas behind Meridian", the comparison table and its honest-about-it paragraphs, the blog posts, the in-app copy.
- **Revealed niche** — who the product's *own priorities* say it's for, ignoring the copy entirely. Read this off what the product actually invests in: which features are deep versus shallow, what the default path optimises for, which platforms and backends are first-class, what the example vault teaches, what the recurrence model assumes about a user's life. A product's real positioning is what it spent its effort on.
- **Served niche** — who can actually succeed with it today, given the real constraints: the storage options and the setup each demands, browser and platform support, what a user must already understand before the product pays off, what breaks for someone outside the assumed profile.

Then state the gaps plainly. **Declared vs. revealed** is a strategy question — are we building what we say we're building? **Revealed vs. served** is an execution question — can the people we build for actually get in the door? **Declared vs. served** is the credibility question — do we promise a person we can't currently serve? Nearly every finding is an instance of one of these three, and each finding must say which.

## Process

- **Derive, then judge, then write.** Phase 0 first and in writing, then the walk, then the findings. Do not decide the niche you *expect* and collect quotes for it — derive the revealed niche from product evidence before re-reading the copy, so the copy can't anchor you.
- **Read the README cold, once, before anything else,** and record your honest first-pass answers to: what is this, who is it for, what would I use it instead of, and would I keep reading? That first read is unrepeatable — capture it before the code teaches you what the product means. It is the closest thing available to a real visitor's experience.
- **Every finding needs a verbatim quote** from a real surface — README, in-app string, tutorial entry, blog, or code — copy-pasted, not paraphrased. I will spot-check by grepping. Fit findings additionally need the product evidence: the feature, constraint, or code that creates the gap.
- **Time-box the recognition test.** Judge the surfaces by what a visitor learns in the first ~30 seconds — headline, first screen, first paragraph, the app's first view — and say explicitly at which line or screen the niche becomes unambiguous, or that it never does.
- **Make positioning measurable rather than a matter of taste:**
  - **Niche-signal audit.** For each claim and adjective in the positioning copy, name the audience it selects *and* the audience it excludes. The headline is `**A calm calendar, task manager, and notes app built on plain Markdown files.**` — "calm" turns away the gamified-productivity crowd, "plain Markdown files" strongly attracts people who know what that implies and means nothing to people who don't. Report which signals do real selection work and which are noise.
  - **Term census.** Count the words each surface uses for the same concept across README, in-app copy, tutorial entries, and blog. Vocabulary that fractures ("vault" ~45× in UI source but 5× in README; the tour says "a folder you own"; getting-started says "repo") makes a product harder to recognise, because the reader can't tell whether they're being sold one thing or three.
  - **Emphasis map.** Compare the space each surface gives a capability against how central that capability is to the declared niche's job. A capability argued at length that the niche doesn't need, and a niche-defining capability mentioned once, are both findings.
- **Distinguish "doesn't fit the niche" from "isn't finished."** An immature feature that clearly serves the target job is execution debt, not a positioning problem. Call something a fit finding only when the product's *direction* and the target's *needs* diverge.
- **Say when the status quo is right.** A deliberately narrow niche, a feature deliberately not built, an audience deliberately turned away — these are strategy, and the report should confirm them as such when the evidence supports it, rather than reflexively recommending expansion. `Meridian supports notes, but it doesn't try to be a better note-taking app than Obsidian` is exactly this kind of decision: test whether the product honours it, don't second-guess it.
- Treat every copy claim as a hypothesis to verify against the code and the product.

## Known suspects

Hypotheses to verify or refute. The report must state a verdict on each (confirmed / refuted / couldn't verify). A refutation is as valid an outcome as a confirmation.

- **The headline sells a category the README later disclaims.** The first line offers a `calendar, task manager, and notes app`, while the comparison section concedes it isn't trying to win at notes. Check whether the three-category framing sets an expectation the product deliberately doesn't meet — and which of the two statements is the real position.
- **The strongest niche asset is at the bottom.** The comparison table — the fastest way for a visitor to place the product among tools they already know — sits at README line ~143 of 178, after four sections of philosophy. Test whether a visitor can identify the niche before reaching it.
- **"Great mobile UX" is the first row of the comparison table**, i.e. the claimed lead differentiator, and `CLAUDE.md` describes a mobile-focused PWA. Verify that the product's investment matches that claim, and that the surfaces sell it as *the* lead rather than as one of ten equal-weight rows.
- **The declared audience and the front-door setup path may select different people.** The pitch is calm and file-based; the recommended way in is a GitHub repository (with a hand-made fine-grained token as fallback), and local folders require a Chromium browser. Determine which niche the *setup path* actually selects, and whether it's the one the copy targets.
- **The real beachhead may be Obsidian-adjacent.** `If you're already an Obsidian user, Meridian's vault format will feel immediately familiar` suggests the natural first user is someone who already keeps a Markdown vault and wants tasks and calendar to be first-class. Check whether the product and its onboarding treat that person as primary — and whether any surface says so near the top.
- **An emerging niche signal appears exactly once.** The LLM-friendliness argument (Markdown + YAML frontmatter as the format LLM tooling already reads, citing the Open Knowledge Format) sits inside idea #3 and appears in no headline, no comparison row, and no in-app surface. Decide whether that's an under-sold differentiator for a real and growing audience, or a distraction from the declared niche.
- **The comparison table's competitor claims can rot.** Its rows assert current facts about six other products. Verify each claim a reasonable reader would check; a wrong "❌" against a competitor costs more credibility than an honest gap.
- **The conceptual model may be a bigger adoption gate than the copy admits.** "Lists model hierarchies" is a genuinely different mental model, taught as principle #2. Assess how much a target user must absorb before the product pays off, and whether the surfaces make that investment feel worthwhile or merely mandatory.

## Budget

- **Read completely** (they are the positioning): `README.md` end to end, both posts in `blog/`, the coach tour (`src/onboarding/CoachTour.tsx`), and the tutorial entries seeded in `src/storage/exampleBackend.ts` — the example vault is the product's argument for itself, made in content.
- **Derive the revealed niche from the product, not the docs:** the feature surface (which capabilities are deep — recurrence, wikilinks, participants, search — and which are thin), the storage options and what each demands of a user (`src/storage/`, plus the trade-offs already recorded in [storage-backend-survey.md](storage-backend-survey.md)), platform and browser constraints, the entry-format surface area in `src/types.ts` (`INLINE_FIELDS`) and `src/model/`, and what the default first-run path optimises for.
- **Walk the first-run experience** on the example vault via the preview tools (follow the preview gotchas in `CLAUDE.md`: worktree-specific launch config, unique port, base path `/meridian/`). Judge it as a visitor deciding whether this product is for them. Note honestly that the automated browser **cannot complete GitHub OAuth or grant File System Access permissions**, so the real setup path can only be assessed from code and copy — state that limitation up front rather than discovering it mid-pass.
- **Check the app's own front door**: `index.html`, the PWA manifest, the app name, and the icons (`public/icon*.png`). The install prompt and the home-screen icon are positioning surfaces too, and often the only ones a returning user sees.
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

One line per category (1–6): **clean** (the walk for this category was executed and nothing turned up), **findings: #N, #M**, or **partially assessed** (say what was skipped and why). Clean is only available to categories actually walked.

### 4. Findings — top 8

For each finding:

- **Title** — short label
- **Gap** — which of the three: `declared-vs-revealed` (strategy), `revealed-vs-served` (execution), or `declared-vs-served` (credibility)
- **Question** — `fit` or `communication` (or both)
- **Category** — one or more of: `niche-definition` `differentiation` `recognition` `audience-selection` `feature-fit` `adoption-gate` `proof` `identity`
- **Who it costs us** — the person who bounces, misjudges, or churns because of it, and roughly what share of arrivals are that person
- **Impact** — 1–10, where 10 = the product targets a niche it cannot serve, or the right visitor cannot tell the product is for them; 5 = a real differentiator goes unrecognised, or a segment is attracted and then disappointed; 1 = a wording nit with no selection consequence
- **Evidence** — verbatim quote(s) with file paths; for fit findings, also the product evidence (feature, constraint, or code) that creates the gap
- **Breadth** — how many surfaces carry it; from an actual search — name it; "est." if estimated
- **Recommended model** — which tier is capable enough to do this fix well: **Haiku 4.5** / **Sonnet 5** / **Opus 5** / **Opus 5 in plan mode, for a plan spanning multiple PRs** (or the current equivalent tier). Judge by how much of the fix is load-bearing judgment versus mechanical edit, and by **how the fix fails** — here the dangerous failure is a confident rewrite that sounds better and positions worse: copy broadened until it selects nobody, a differentiator sharpened into a claim the product can't back, a term unified on one surface so the vocabulary fractures further, a comparison row "corrected" without checking the competitor. Reserve plan mode + multi-PR for anything that changes **what the product is or who it's for** — the niche itself, the headline, the lead differentiator, whether to chase an emerging audience. Those are the user's decisions: the plan lays out options and consequences, it does not pick. **State the specific hazard that sets the tier**, and say when naming it would allow a lower one (e.g. "Haiku 4.5 if the approved headline text is given in the task; else Opus 5 in plan mode")
- **Problem** — one sentence: what the target user misunderstands, misses, or walks away from
- **Fix** — one sentence: the concrete change; for anything touching the niche itself, present options rather than asserting one

Rank by `(impact × breadth) ÷ effort`, where `effort` is the tier as an ordinal — Haiku 4.5 = 1, Sonnet 5 = 2, Opus 5 = 3, Opus 5 plan-mode/multi-PR = 5 — but report the fields separately so the reader can re-sort. Add a **summary table** (finding → gap → question → recommended model) above the findings.

Where findings touch the same surface, add a one-line **sequencing note**: positioning decisions must land before the copy edits that express them, or the edits get redone.

### 5. The decisions only you can make

Close with a short, explicit list of the **strategy questions this survey surfaces but must not answer** — what the niche is, who the beachhead user is, which differentiator leads, whether the notes category stays in the headline, whether the LLM-friendly audience is worth targeting. State the options and the consequence of each, then stop. Everything outside this list should be actionable without further input.

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
- Whether the niche the product is *best* at is the niche it claims — a product often fits an adjacent niche better than its declared one, and that is a strategy finding, not a bug

### 2. Niche recognition — the first 30 seconds

**Scope:** how fast, and how correctly, a visitor can place this product.

- Whether the headline names a niche or lists categories; whether "who this is for" appears anywhere above the fold
- How far a reader must get before the product is placeable against tools they already know
- Philosophy-before-placement ordering: the right content in the wrong position
- Whether the app's own first screen communicates a niche or only an interface
- Whether name, icon, and install metadata reinforce a recognisable identity or stay generic

### 3. Differentiation & alternatives

**Scope:** whether the reason to choose this over the obvious alternative is clear and credible.

- Whether one lead differentiator is chosen and repeated, or many are listed at equal weight — a table where every row looks equally important asserts no priority
- Comparison claims about other products that are stale, unfair, or unverifiable, and the trust cost of each
- Differentiators that are real but never claimed anywhere prominent
- Claims a competitor could match trivially, presented as a moat
- Honest limitations stated well — where conceding something earns credibility, note it as working

### 4. Audience selection — attracting and repelling

**Scope:** whether the surfaces sort visitors correctly, in both directions.

- Signals that attract someone the product will disappoint — a promise the served niche can't cash
- Signals that repel someone the product would serve well: unnecessary jargon, assumed tooling knowledge, a setup path that reads as "developers only"
- Whether any surface says plainly who this is *not* for; failing to exclude is a positioning failure, not politeness
- Mismatch between the register of the pitch and the register of the setup instructions
- Whether the free/open-source/no-server story is positioned as a benefit to the target user or merely stated as a fact about the architecture

### 5. Adoption gates

**Scope:** what a target user must accept, learn, or configure before the product pays off.

- The conceptual model's learning cost versus its payoff, and whether the surfaces make that trade explicit
- Setup demands (accounts, repos, tokens, browser choice) measured against the declared audience's tolerance
- Platform constraints that silently exclude part of the target niche
- Where the product asks for commitment before it has demonstrated value
- Whether a try-before-committing path exists, is discoverable, and is convincing

### 6. Niche drift & emerging signals

**Scope:** whether the positioning still matches where the product and its context are going.

- Positioning written for an earlier version of the product, or claims that predate features which changed the story
- Emerging audiences visible in the product but absent from the pitch (e.g. the LLM/agent-context angle stated once and nowhere else)
- A niche narrowing or widening in the code without the copy following
- Surfaces that disagree because they were written at different times — blog, README, and in-app copy each freezing a different era's positioning

---

**Scoring guidance:** A gap that makes the right user bounce outranks any amount of imprecise wording. A misfit between what the product is best at and what it claims outranks a missing feature, because the first is a strategy error and the second is a backlog item. Weight by how many arrivals encounter the problem: the headline and the first screen outrank a section most readers never scroll to. Confirm deliberate narrowness as a strength when the evidence supports it — recommending that a focused product become a general one is almost always the wrong answer, and this survey must never reach for it by default.
