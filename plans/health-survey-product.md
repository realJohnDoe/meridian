# Product, Onboarding & Docs Survey

Survey **Meridian itself** — as a product a stranger meets for the first time. Two questions, weighted equally:

1. **Does the product tell the truth?** Do the README, in-app copy, and the example vault describe what the code actually does?
2. **Does it tell one story?** Do the positioning, voice, and vocabulary across every surface add up to a single coherent product with a clear promise — and does the product deliver the thing it promises?

Find the **top 8 issues** across both, each anchored to a real surface with a verbatim quote.

**This survey is inward-facing.** It is about our own product, docs, and onboarding. It is _not_ market or vendor research — no competitor comparisons, no evaluation of external services to integrate. (That genre lives separately, e.g. [storage-backend-survey.md](storage-backend-survey.md), and should not be mixed in here.) Code quality, UI implementation, speed, and data safety belong to the other surveys ([health-survey.md](health-survey.md), [health-survey-ui.md](health-survey-ui.md), [health-survey-performance.md](health-survey-performance.md), [health-survey-data-integrity.md](health-survey-data-integrity.md)); reference them rather than duplicating them.

## The surfaces (what counts as "the product" here)

Every finding must cite at least one of these:

- **README.md** — the front door for anyone arriving from GitHub or a link
- **In-app copy** — the coach tour (`src/onboarding/CoachTour.tsx`), button and menu labels, dialog text, empty states, error and permission messages, settings, toasts
- **The example vault** (`src/storage/exampleBackend.ts`) — the tutorial entries are documentation that the user reads _inside_ the product
- **The entry format** — the YAML/Markdown contract the user hand-edits, as documented in README vs. as implemented in `src/types.ts` (`INLINE_FIELDS`), `src/model/nodeSchema.ts`, and the parse pipeline
- **The blog posts** (`blog/`) — the long-form voice of the project
- **Visual identity** — app name, icons (`public/icon*.png`), install/PWA metadata (`index.html`, manifest), and whether they match the product's stated character

## The journey (findings must land on a stage)

Anchor each finding to where in the user's path it bites. A problem no arriving user ever reaches scores low regardless of how wrong it is.

1. **Decide** — a stranger reads the README or landing copy: what is this, is it for me, do I trust it?
2. **Try without committing** — the example vault and the coach tour: do they convey the core ideas, or just point at furniture?
3. **Commit storage** — connecting GitHub or a local folder. Highest-stakes, highest-drop-off step in the product.
4. **First entry of their own** — creating something real, in an empty vault.
5. **Learn the format** — the first time they hand-edit a file, or hit nesting, `defaults:`, series, or recurrence.
6. **Return and keep** — offline use, installing the PWA, a second device, coming back after a week.
7. **Trouble** — a permission lost, a token expired, a conflict, a malformed file, an empty state: does the product explain and offer a way forward?
8. **Leave** — the promise that the files stay theirs, readable and portable without Meridian.

## Process

- **Walk first, then judge, then write.** Three phases, in order:
  1. **Walk plan.** For each journey stage, name the surfaces the user actually encounters and what you'll check. State it before you start.
  2. **Walk pass.** Go through the product in order as a new user would — read the README cold, run the example vault and the tour, read every string the user can see on each path, read the tutorial entries as content. Collect verbatim quotes as you go.
  3. **Report.** Only then write findings. Do not decide the verdict first and collect quotes to support it.
- **Every finding needs a verbatim quote from a real surface** — doc text, UI string, tutorial entry, or code — copy-pasted, not paraphrased. I will spot-check by grepping. Findings of the "docs are wrong" kind need **two** quotes: the claim, and the code or behaviour that contradicts it.
- **Run the docs, don't just read them.** Every Markdown/YAML example in the README and in the tutorial entries is testable: feed it through the real parser (`parseToStoreItems` in `src/model/storeItems.ts`) and report which examples fail to parse, parse to something other than what the surrounding prose claims, or use fields the schema doesn't support. A documentation example that doesn't survive the real parser is a hard finding, not a style note.
- **Make the soft things measurable.** Positioning and voice are judged with evidence, not taste:
  - **Term census.** For each user-facing concept, count the words used for it across README, in-app copy, tutorial entries, and blog. Report where one concept has several names, or one name covers several concepts. (Starting point, already measured: "vault" appears ~45× in UI source but only 5× in README, while the tour calls the same thing "a folder you own" — three surfaces, three nouns.)
  - **Promise ledger.** Take each claim and adjective in the positioning copy, list it, and find the product evidence for or against. The README's headline is `**A calm calendar, task manager, and notes app built on plain Markdown files.**` — so "calm" is a promise with testable consequences (what does the UI do with badges, counts, urgency, notifications, empty-state pressure?), as are "plain Markdown files you can read, edit, and back up anywhere" and "free, open-source PWA".
  - **Emphasis map.** Compare how much space each surface gives a feature against how central it is in use. A capability the README argues for at length but the tour and tutorial never mention is a mismatch in one direction; a feature users rely on daily that no surface explains is a mismatch in the other.
- **Judge the copy against its stated audience, and name that audience.** State up front who the product says it is for, from the copy itself — then check whether the language, the assumed knowledge, and the first-run path fit that person. Where a surface addresses a different reader than the positioning claims (e.g. the pitch reads consumer-friendly while getting-started assumes repositories and tokens), that gap is a finding, and it belongs to positioning, not to the storage design.
- **Distinguish "wrong" from "missing" from "unfindable."** All three are findings, but they need different fixes, and the report should say which it is: a claim that is false, a capability that is real but documented nowhere, or a doc that exists but is not where the user looks.
- Treat claims in `README.md`, `CLAUDE.md`, `src/model/AGENTS.md`, and the blog as hypotheses to verify against the code, never as settled fact.

## Known suspects

Hypotheses to verify or refute. The report must state a verdict on each (confirmed / refuted / couldn't verify). A refutation is as valid an outcome as a confirmation.

- **Undocumented entry fields.** `INLINE_FIELDS` in `src/types.ts` registers `tags` and `timezone`; neither appears in the README's entry-format section. Check the full registry against the documented format in both directions — fields that exist but aren't documented, and fields documented but not (or no longer) supported.
- **Three names for the user's data.** The UI says "vault" (Settings, "manage vaults"), the README mostly says files/folder, the tour says "a folder you own", and the recommended backend makes it a "repo". Decide whether one term should win, and whether "vault" is the right word to meet a new user with.
- **Model jargon reaching users.** "occurrence" is model vocabulary (`expansion.ts`, `StoreItem`) that appears in user-visible strings. Sweep every user-facing string for internal terms (occurrence, series, scope, instance, slug, node, frontmatter) and judge each: some are legitimately the domain's word for a thing the user must learn, others are leakage.
- **Does the tour teach the ideas, or just the furniture?** The four coach-tour steps cover agenda, search, and the menu, then hand off: `start with “Welcome to Meridian” to learn the ideas at your own pace`. The README, meanwhile, opens with four numbered "ideas behind Meridian". Verify whether the tutorial vault actually delivers those four ideas, and whether the handoff survives a user who taps Skip.
- **The tour only auto-starts on the example vault**, once, and never again after Skip or Done. Check what onboarding a user gets who connects GitHub or a local folder first and never opens the example vault — plausibly none.
- **Positioning vs. first-run friction.** The headline promises calm and plain files; step 3 of Getting started routes users to GitHub sign-in or a hand-made fine-grained token. Verify how the first five minutes actually read for the audience the positioning claims.
- **No `docs/` at all.** A 178-line README is the entire user-facing documentation for a bespoke format with nesting, `defaults:` inheritance, series splitting, after-completion recurrence, and timezones. Judge whether the format's real surface area fits in a README section — and if not, say what the minimum second document is.

## Budget

- **Read completely** (they're small, and they are the product): `README.md`, `src/onboarding/CoachTour.tsx` and `tourState.ts`, the seed content in `src/storage/exampleBackend.ts` (every tutorial entry, as prose _and_ as YAML), and `index.html` plus PWA/manifest metadata.
- **Sweep all user-facing strings**, not just the happy path. Grep the UI source for literals and read them in context: empty states, error and permission messages (`ensurePermission` failures, `unreachable`, expired tokens), conflict notifications (`src/storage/notifications.ts`, `conflictName.ts`), destructive confirmations, and toasts. Error copy is where a product's respect for its user is most visible and least reviewed.
- **Walk the flows you can.** Run the app on the example vault via the preview tools (follow the preview gotchas in `CLAUDE.md`: worktree-specific launch config, unique port, base path `/meridian/`, SPA-navigate rather than hard-navigating to `?editor=`). Note honestly that the automated browser **cannot complete GitHub OAuth or grant File System Access permissions** — so journey stage 3, the highest-stakes step, can mostly only be assessed from code and copy. Record that limitation up front rather than discovering it mid-pass.
- **Read the blog posts** for voice and positioning, and compare against the README and in-app copy. Three surfaces, one product — or three?
- **Sample the code only as far as needed to check a claim.** This survey reads implementation to verify documentation, not to review it.
- Record anything skipped in the coverage statement.

## Output structure

### 1. Product verdict (~5 sentences)

Plain language: what does Meridian promise, what does it actually deliver, and where do the two diverge most? Name the **weakest journey stage** and the **single biggest coherence theme** (e.g. "the product is pitched to a calm-notes audience but the first five minutes are addressed to a git user"). This is the headline; findings are the evidence.

### 2. Coverage statement

- Which journey stages you walked in the running app, which you assessed from code and copy only, and which you skipped — with the reason.
- Which surfaces you read completely versus sampled.
- The result of the doc-example parse check: how many examples you ran, how many passed.
- Anything you suspect but could not verify — flag it "unverified," and say what would settle it.

### 3. Category verdicts

One line per category (1–6): **clean** (walk plan executed, nothing found), **findings: #N, #M**, or **partially assessed** (say what was skipped and why). A category may only be called clean if its walk was actually performed.

### 4. Findings — top 8

For each finding:

- **Title** — short label
- **Journey stage** — which numbered stage(s) it bites at
- **Category** — one or more of: `accuracy` `coverage-gap` `discoverability` `positioning` `voice` `vocabulary` `onboarding` `error-copy` `identity` `trust`
- **Kind** — **wrong** (a false claim), **missing** (real but undocumented), or **unfindable** (documented in the wrong place)
- **Who it hits** — the arriving stranger, the nontechnical user, the technical user, or the returning user — and roughly what fraction of arrivals reach it
- **Impact** — 1–10, where 10 = an arriving user bounces, cannot get started, or is actively misled about where their data goes; 5 = a real capability stays undiscovered, or the docs mislead recoverably; 1 = a copy nit nobody would notice
- **Evidence** — verbatim quote(s) from the surface(s), with file paths. For accuracy findings, quote both the claim and the contradicting code
- **Breadth** — how many surfaces or files carry the problem; counts from an actual search — name it; "est." if estimated
- **Recommended model** — which model tier is capable enough to do this fix well: **Haiku 4.5** / **Sonnet 5** / **Opus 5** / **Opus 5 in plan mode, for a plan spanning multiple PRs** (or the current equivalent tier, if these names have moved on). Judge by how much of the fix is load-bearing judgment versus mechanical edit, and by **how the fix fails**: prose that is merely awkward gets caught on read, but this domain's silent failures are specific — a doc "fixed" to describe intended rather than actual behaviour, an example that reads plausibly but never runs through the parser, a term renamed on one surface so the vocabulary fractures further instead of converging, copy that fixes a claim while quietly abandoning the product's voice. Reserve plan mode + multi-PR for findings that need a **product decision the user owns** — the positioning line, what the product is called, which term wins, who the audience is, whether a `docs/` section exists at all. Those are not model judgment calls; the plan should surface the options and the trade-offs rather than pick. **State the specific hazard that sets the tier.** If naming that hazard makes a lower tier sufficient, say so explicitly (e.g. "Haiku 4.5 if the chosen term and the exact files are listed in the task; else Sonnet 5")
- **Problem** — one sentence: what the user misunderstands, misses, or mistrusts as a result
- **Fix** — one sentence: the concrete change; for positioning findings, present the options rather than asserting one

Rank by `(impact × breadth) ÷ effort`, where `effort` is the recommended-model tier read as an ordinal — Haiku 4.5 = 1, Sonnet 5 = 2, Opus 5 = 3, Opus 5 plan-mode/multi-PR = 5 — but report the fields separately so the reader can re-sort. Add a short **summary table** (finding → stage → kind → recommended model) above the findings.

Where findings touch the same surface, add a one-line **sequencing note** — copy changes collide more than code does, and a vocabulary decision should land before the edits that apply it.

**Separate the decisions from the chores.** Close the findings with a short list of the **product questions only the user can answer** (the positioning line, the audience, the winning vocabulary, whether to add `docs/`). Everything else should be actionable without further input.

Do not pad to 8 — if fewer clear issues exist, stop there.

---

## Categories to walk — ranked by priority

The ranking is a tiebreaker, not a filter. Bullets are illustrative, not the boundary.

### 1. Truthfulness — docs vs. the product _(highest weight)_

**Scope:** anywhere a surface says something the code does not do.

- Entry-format fields documented but unsupported, or supported but undocumented (`INLINE_FIELDS`, `nodeSchema.ts`)
- README or tutorial examples that don't survive the real parser, or parse to something other than the prose claims
- Feature claims that overstate: capabilities described without their real constraints (browser support, platform limits, what a backend can and cannot see)
- Getting-started steps whose UI labels no longer match the buttons they name
- Promises about the user's data — where files go, what is readable elsewhere, what is picked up on the next sync — that the sync and storage code doesn't uphold
- Stale claims in `CLAUDE.md` and `src/model/AGENTS.md` that would mislead a contributor (the latter's layering table points at `src/meridian.ts` and `src/App.tsx`, neither of which exists)

### 2. Positioning & brand coherence

**Scope:** whether the product's promise, character, and audience are one thing across every surface.

- The headline promise versus the experienced product — each adjective in the positioning line, tested against what the app does ("calm" is a claim about restraint: badges, counts, urgency cues, notification pressure, empty-state nagging)
- Audience drift — a pitch written for one reader and a getting-started written for another
- Voice drift across README, blog, tour, and error messages; the blog's long-form voice versus the product's terse one
- Feature emphasis that doesn't match real centrality, in either direction
- Visual identity — name, icon, install metadata — matching or contradicting the stated character
- Claims of restraint or simplicity contradicted by the surface area a new user actually meets

### 3. Vocabulary consistency

**Scope:** one concept, one name, everywhere.

- The same thing called different things across surfaces (vault / folder / repo / files)
- Internal model vocabulary reaching users (occurrence, series, scope, instance, slug, node, frontmatter) — decide per term whether it's the domain's real word or leakage
- One word covering several concepts (entry as file, as occurrence, and as a row in a list)
- Terms used in the UI that no surface ever defines, and terms defined in the README that the UI never uses
- Field names in the file format whose meaning isn't obvious from their name and isn't explained anywhere

### 4. Onboarding effectiveness

**Scope:** whether a new user reaches competence, not just first paint.

- Whether the tour teaches concepts or only points at furniture, and what a user who skips it retains
- Users who never see onboarding at all — connecting a real backend first, or returning after a reset
- Whether the tutorial vault teaches the product's actual core ideas, in an order that builds, and whether it survives the user editing or deleting it
- The empty vault: what a user sees after connecting real storage with nothing in it
- The gap between "first entry created" and "understands nesting, defaults, and recurrence"
- Whether the product ever teaches the file format at the moment it becomes relevant, rather than only in a README the user has left behind

### 5. Trouble & error copy

**Scope:** what the product says when something goes wrong.

- Permission lost, token expired, backend unreachable, offline: does the copy explain the state and offer a next step, or state a fact and stop?
- Conflict artifacts: does the user find out one was created, and does anything explain what to do with it?
- Malformed or unparseable files: does the message identify the file and the problem in the user's terms?
- Destructive confirmations that don't convey blast radius; toasts that vanish before they're read
- Any error string that exposes internal vocabulary or an error code with no human sentence around it

### 6. Documentation structure & findability

**Scope:** whether what exists is where the user will look.

- Whether the format's real surface area fits in one README section, and what the minimum second document would be
- Reference material the user needs while editing (the field registry, recurrence syntax) available only outside the app
- Contributor-facing and user-facing content mixed in one file
- Docs that exist but are unreachable from the app at the moment of need
- README length and ordering versus the order a stranger's questions arrive in

---

**Scoring guidance:** A false claim about where the user's data goes outranks any amount of awkward phrasing. An incoherence repeated on every surface (one concept with three names) outranks a single confusing sentence. Weight by how many arriving users reach the problem: a flaw in the first screen outranks an equally wrong sentence in a section most readers never scroll to. Prefer findings that name a specific surface and quote it; skip anything you can't attach to a quote, and don't file taste as a finding — if the only argument is that you'd have written it differently, leave it out.
