# Product Niche Fit & Positioning — survey results

Run of [`plans/surveys/product-niche.md`](surveys/product-niche.md), 2026-09-03,
against `2b343c8`.

---

## 1. Niche verdict

**Declared niche** — a person who already keeps their life in Markdown (Obsidian
+ TaskNotes, or a folder of `.md` files), hiring Meridian to make tasks and dates
first-class *and fast on a phone*, instead of the desktop-first plugin they use
today.

**Revealed niche** — read off investment rather than copy, the product is built
for someone running a **multi-source personal/household calendar over files they
control**: `src/storage/` is the largest non-test directory (7,557 lines), of
which ~1,950 lines are an iCal subsystem nobody is told about; `vaultRegistry.ts`
(766 lines) makes several vaults normal; participants, per-vault colours and ICS
export all point at scheduling shared with other people, not at note-taking.

**Served niche** — someone who will either install a third-party GitHub App on a
repo and sign in twice, or run Chrome/Edge on desktop or Android for a local
folder. In practice: a developer. Everyone else gets the read-only Tutorial vault.

**Fit is good; communication is where this loses people.** The product genuinely
does the job it claims — the mobile screenshots prove the lead differentiator,
and recurrence depth is real (`model/expansion.ts` alone is 1,191 lines). The
widest of the three gaps is **declared vs. served**: the README explicitly sells
to "someone who won't configure a vault" while the app says "vault" in 33
user-visible strings and the recommended path routes you out to GitHub to
install an App and back again to sign in a second time.

**The single change that closes the most of it: repair the first-run coach tour,
which currently never runs** (finding #4). It is the only surface inside the app
that states the niche at all, every first-time visitor is supposed to hit it, and
right now 100% of them get a generic agenda list that never mentions Markdown,
files, or ownership. The credibility half of the same gap is not a change but a
decision, and it is in section 6.

---

## 2. Coverage statement

### Cold-read first impressions (recorded before any analysis)

- **What I thought this was:** a browser PWA calendar + task app storing entries
  as Markdown with YAML frontmatter, in a GitHub repo or local folder.
- **Who for:** people already keeping life in Markdown; implicitly people
  comfortable with a GitHub repo.
- **Instead of what:** Obsidian + TaskNotes on mobile; secondarily Google
  Calendar / Todoist.
- **Would I keep reading?** Yes. Two frictions: paragraph 3 (line 7, the sharing
  pitch) reads as a *different* product from paragraph 2 and I could not tell
  whether this was personal or small-team; and "Usable by someone who won't
  configure a vault" sat oddly beside a setup path whose recommended route is a
  GitHub repo. **The niche became unambiguous at line 5** ("Who it's for") —
  genuinely fast — then un-clarified at line 7.

### Blind visual read (recorded from screenshots, before re-reading copy)

Looks like a **polished consumer mobile calendar/todo app** — rounded cards,
soft blue-grey ground, generous whitespace, bottom-anchored search pill with a
gradient **+** FAB. Looks like it costs $3–5/mo; does not read as free or
open-source. Most resembles Todoist's upcoming view or Google Calendar's
schedule view — **not** Obsidian or any local-first Markdown tool. Nothing on
the first screen, mobile or desktop, refers to files, Markdown, folders or a
vault. **Mobile-first is visually proven**: thumb-reachable, one-handed,
bottom-anchored primary action. Desktop is the phone layout widened, with ~300px
of dead gutter at 1440px. Urgency cues are low (colour codes item type, not
lateness) — calm, consistent with the promise.

### What was read completely

`README.md`; `blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md` and
both `interview.md` files; `src/onboarding/CoachTour.tsx`; the tutorial entries
in `src/storage/devFixtures/tutorialVault.ts`; `index.html`; the PWA manifest in
`vite.config.ts`; `src/settings/themes.ts`; `src/settings/AddVaultWizard.tsx`;
`src/model/fieldRegistry.ts`; `src/routes/auth.callback.tsx`.
`blog/2-how-meridian-was-built/` skimmed for framing only, per the budget.

### What was walked in a real browser

**Preview tooling: none in this session** (no `preview_*` tools). Rather than
fall back to a tokens-only read, the walk was done directly with the repo's own
`playwright-core` devDependency against `pnpm exec vite --port 5199`, at
390×844 and 1440×900, in the default, Meridian Dark, Tokyo Night and Solarized
Light themes. **Category 3 is therefore fully assessed, not partially** — the
blind visual read above rests on real screenshots.

### Assessed from code and copy only

The real setup paths. As the plan predicts, an automated browser cannot complete
GitHub OAuth or grant File System Access permissions, so the GitHub App install
→ re-sign-in flow (finding #5) is evidenced from `src/routes/auth.callback.tsx`
and `src/storage/githubOAuth.ts`, not from walking it.

### Comparison-table claims

**Verified:** TaskNotes uses a single RRULE string per task with a
`complete_instances` list, so "❌ (single rule per task)" holds — though the
"one-off overrides" half of that compound row is partly matched by
`complete_instances`, so the row is generous to Meridian rather than unfair to
TaskNotes. TaskNotes is MIT-licensed, so "Free & open source | Partially (plugin
only)" is accurate. TaskNotes documents no assignees, so "Partial" is generous,
not a trust risk.

**Could not verify:** every claim about Obsidian itself, Google Calendar, GitHub
Issues, Todoist and Google Keep — `obsidian.md` and `tasknotes.dev` are both
blocked by this session's network egress proxy, and I declined to rate a
competitor from memory. The rows most worth a human check are Obsidian "Works in
the browser ❌" and GitHub Issues "Phone-first UI | Partial".

**Found while verifying:** TaskNotes advertises "Calendar sync with Google and
Microsoft (OAuth) or any ICS feed". Meridian now matches the ICS half, and the
README's backend table and feature list now say so.

### Unverified, flagged

- ~~**Whether a collaborator on a shared repo needs their own GitHub App
  installation.**~~ **Answered by the app owner, 2026-09-04:** installation is
  per repo, and each additional person only has to authorize — which matches the
  intersection semantics of a user-to-server token. `README.md:7` therefore
  needs no qualification, and `plans/onboarding.md` PR 4 is written against that
  single case rather than two branches.
- **Whether the desktop dead gutter is deliberate.** It reads as phone-first
  applied honestly, but nothing in the repo states it as a choice.

### PMF premise — re-verified, unchanged

The plan's premise still holds at this commit: no analytics, telemetry or
feedback path anywhere in the app; `.github/` holds four workflow files and
nothing else; `plans/next-steps.md` is two lines, both build work. There is no
PMF signal in this repository to read. Section 5 is written accordingly.

---

## 3. Category verdicts

1. **Niche fit** — **clean.** The product honours its stated non-goal:
   `src/search/` is 313 lines and there is no graph view, no plugin API, no
   backlink-heavy note tooling — "it doesn't try to be a better note-taking app
   than Obsidian" is a decision the code keeps. Confirmed as strategy, not a gap.
2. **Niche recognition** — *findings: #4.*
3. **Visual identity & aesthetic fit** — *findings: below the cut* (see G).
   Fully assessed via real screenshots.
4. **Differentiation & alternatives** — **clean.**
5. **Audience selection** — *findings: #5.*
6. **Adoption gates** — *findings: #5.* Confirmed as working: the read-only
   Tutorial vault is a genuine try-before-committing path, reachable with zero
   setup, and it is the app's default state.
7. **Niche drift & emerging signals** — *findings: below the cut* (F).

---

## 4. Findings — top 5

**The verdict and this table disagree on order, deliberately.** The niche verdict
leads on impact and names #4 as the change to make; the table below ranks on
`(impact × breadth) ÷ effort`, which is return on effort.

| Rank | # | Finding | Gap | Question | Impact | Breadth | Recommended model | Score |
|---|---|---|---|---|---|---|---|---|
| 5 | #5 | "Usable by someone who won't configure a vault" — the setup half is fixed, the word isn't | declared-vs-served | communication | 5 | 4 | Haiku 4.5 | 20 |

**Sequencing note.** #5's decision (keep the promise, build the sharing path
rather than soften the claim) has been made and its harder half shipped —
`plans/onboarding.md`'s PR 4 landed the invite path, 2026-09-04
(realJohnDoe/meridian#959). #4 is independent (source only) and can go first
or in parallel.

---

### #5 — "Usable by someone who won't configure a vault" — the setup half is fixed, the word isn't

- **Gap:** `declared-vs-served`
- **Question:** communication (was fit + communication — the fit question, "is a
  shared repo a viable calendar for a non-technical second person," is answered:
  the invite path now does what the README says. What's left is a naming
  inconsistency, not a fit gap.)
- **Category:** `recognition` (was also `audience-selection` `adoption-gate` — the
  hard adoption gate, a required GitHub App install, is gone for this audience)
- **Who it costs us:** the non-technical person a current user tries to share a
  calendar with — the exact person README:7 recruits. They can now actually do
  what the README says (sign in, pick the repo); what still costs them is
  meeting the word "vault" along the way, not a technical wall.
- **Impact:** 5 *(was 8 — downgraded now that evidence point 2, the hard block, is resolved)*
- **Evidence:**
  - `README.md:24` — `| Usable by someone who won't configure a vault | ✅ | ❌ | ✅ |`
  - `README.md:7` recruits that person explicitly: `**And whoever you share with doesn't have to be you.** Point Meridian at a repo and everyone you share it with reads and writes the same repo — no vault to configure, no plugins. Tag people on entries, filter the calendar down to one person.`
  - The served path contradicted it three ways; one is now fixed:
    1. **The word.** Still open. 33 user-visible `vault` strings in `src/`; the
       settings screen is a vault list; the wizard is `AddVaultWizard`; and
       `src/onboarding/CoachTour.tsx:73` tells the user to `manage vaults in Settings`.
       This is the same underlying problem finding #2 already tracks — closing
       #2's rename closes this too, no separate fix needed.
    2. ~~**The setup.** `src/routes/auth.callback.tsx:170` — a round trip out to
       GitHub to install a third-party App, then a second sign-in.~~ **Resolved
       2026-09-04:** `plans/onboarding.md` PR 4 (merged as
       realJohnDoe/meridian#959) shipped an in-app invite path for exactly the
       audience this finding is about — a collaborator adds an "Invite someone"
       row (`src/settings/VaultSettings.tsx`) that links to the repo's
       collaborator-access page and copies a message telling the recipient to
       sign in with GitHub and pick the repo, with no install step, because per
       the app owner's confirmation (see "Unverified, flagged" above) a
       collaborator never needs one. `README.md:7`'s claim now holds for this
       path. (The *owner's* own first-time setup still goes through the
       App-install round trip at `auth.callback.tsx:170` — untouched, but that
       was never who this finding is about.)
    3. **The alternative.** Still open, and minor: the only non-GitHub writable
       backend needs Chrome or Edge (`AddVaultWizard.tsx:27`) — a real
       limitation, but a disclosed one (the README concedes it at lines 51 and
       64), so it is not the same kind of broken promise as points 1 and 2 were.
  - Counter-evidence worth weighing before changing anything: the visual identity
    genuinely does recruit that person (see the blind visual read — it looks like
    a consumer app), and the read-only Tutorial vault genuinely is a zero-setup
    front door. The claim is not fantasy; it is ahead of the setup path.
- **Breadth:** 4 surfaces *(was 5 — `auth.callback.tsx` dropped, resolved)*:
  `README.md` lines 7/24, `AddVaultWizard.tsx`, `CoachTour.tsx:73`, the settings
  vault screens.
- **Recommended model:** **Haiku 4.5** *(was Opus 5, plan mode, multi-PR)* — the
  expensive part was the beachhead decision and the sharing-path build; both are
  done. What remains is the copy-level rename finding #2 already scopes.
- **Problem:** a person invited to a shared vault no longer meets a GitHub App
  install, but still meets the word "vault" the moment they add the shared
  repo — the promise is functionally true now and terminologically inconsistent.
- **Fix:** none beyond finding #2's rename. Once #2 lands, re-check that the
  invite path's own screens (Settings → Vaults → Add vault) don't still say
  "vault" to the person README:7 told they wouldn't have to learn that word.

---

### Below the cut

Two categories were walked, turned up something real, and lost their slot to the
top-5 cap. Recording them here as sub-threshold rather than rounding either
category to "clean".

**(F) Emphasis map: the pitch spends half its length on the adoption cost and
five lines on the benefit.** *Sub-threshold — impact 6, breadth 1 (README only),
Opus 5, score 2.* "The ideas behind Meridian" plus the "Entry format" block run
`README.md:69–165` — roughly 48% of a 202-line file — and teach the conceptual
model, which is a cost the user pays, not a benefit they receive. The lead
differentiator appears on exactly five lines (3, 5, 17, 23, 173) and **never
below line 23** except one comparison-table cell; it is absent from "What it
does", from all four philosophy principles, and from the entry-format section.
The formula ranks this near the bottom because it is one surface and needs
judgment; the ordering is doing its job, but the finding is real.

**(G) The theme menu is the only surface that signals the technical niche, and
it is three taps deep in Settings.** *Sub-threshold — impact 5, breadth 2,
Sonnet 5, score 5.* `src/settings/themes.ts:30-38` ships nine palettes, of which
**seven are borrowed code-editor and terminal schemes** — `catppuccin-latte`,
`catppuccin-mocha`, `dracula`, `rose-pine-dawn`, `solarized-dark`,
`solarized-light`, `tokyo-night`. Nothing recruits an Obsidian user faster than
seeing Catppuccin and Tokyo Night in a theme list. Meanwhile the default look
is consumer-app: `src/index.css:224` `  --radius: 0.625rem;`, `:152`
`  --primary:            oklch(0.68 0.22 278);   /* indigo — balanced for text on dark surfaces and filled button bg */`,
DM Sans at `:245`, plus gradients and a multi-layer `--shadow-float` at `:230`.
**Adjacency test:** the default look belongs to the *consumer calendar* family
(Todoist, Structured), not to the local-first tools-for-thought family the README
names as its context. That is a defensible deliberate divergence — it is how the
product looks better on a phone than Obsidian does — but it is currently an
accident of two audiences rather than a stated point of view, and the one signal
aimed at the declared niche is buried. **#5's decision has landed** (keep the
promise, build the sharing path rather than drop the audience — see finding
#5), which was the branch under which this item's own "commit to the
technical niche" framing would have applied. It didn't; this item stays as
recorded, not acted on.

---

## 5. PMF bets and what would test them

**This is not a product/market-fit assessment and cannot be one.** PMF is a
demand-side claim answered by retention, repeat use and people switching. This
repository has no analytics, no telemetry, no feedback path, four workflow files
in `.github/`, and a two-line `next-steps.md` — market contact has not happened.
Nothing below is ranked, scored or given a model tier; the value of this section
is that it stays open.

### The bets

1. **One timeline for tasks, events and notes beats three apps.** The product's
   deepest commitment — `README.md:77` "Lists model hierarchies", and the whole
   `model/` core. *Confirms:* users create entries that change type or carry
   both a `date` and a `done`, unprompted. *Kills:* users mentally partition it
   back into "calendar" and "todo" and ask for separate views, or the tutorial's
   `everything-is-a-list` entry is the most-skipped.
2. **Plain files are worth their setup cost.** *Confirms:* someone edits a `.md`
   file by hand outside the app and says so; someone cites "no lock-in" as their
   reason for choosing it. *Kills:* users never open the files, and the setup
   friction (finding #5) is what they actually talk about.
3. **Mobile is the wedge against Obsidian + TaskNotes.** The load-bearing bet.
   *Confirms:* a TaskNotes user says they moved for the phone; capture-speed
   comes up unprompted. *Kills:* they try it and go back because the desktop
   experience (currently the phone layout widened) is where they actually work.
4. **Recurrence depth matters to real schedules.** ~1,191 lines of expansion say
   this is believed strongly. *Confirms:* real vaults use `instances:` overrides
   or multiple series — the features nothing else has. *Kills:* real vaults are
   `FREQ=WEEKLY` and nothing more, i.e. the depth is over-serving.
5. **A shared repo is a viable shared calendar between two people.** The newest
   bet, from `README.md:7`, and the one with the least evidence. *Confirms:* one
   non-author person who did not set it up themselves keeps using it for a
   month. *Kills:* every shared setup is done *by* the technical partner and
   abandoned when it breaks. This is the bet finding #5 is really about.

### The dogfooding read

The one real usage signal, and it is honest about itself:
`blog/1-…/meridian-why-i-built-a-markdown-first-calendar.md:239-241` — the
author has used it for their own tasks for about two months, their wife is
"just starting" to keep hers in it, and the family calendar has **not** moved
off Proton. So bet 5 is untested even in the author's own household, and bet 3
is confirmed only for the person who built the app to fit their hands.

The code corroborates the shape of that use. The iCal subsystem is the author
solving their own named blocker — you cannot leave Proton until you can pull
a calendar in, and the README now claims it. Participants, per-vault colours
and multi-vault are all the household-scheduling problem, and remain
unclaimed. `next-steps.md` lists
"Fix flow for adding a second vault", which is a friction only a multi-calendar
user hits. This is a product being shaped, visibly and coherently, around one
household's migration — which is the classic way a niche stays a niche of one,
and is also why the revealed niche has drifted toward *multi-source household
calendar* while the copy still says *Markdown-vault keeper*.

What dogfooding cannot tell you: anything about bet 1 (the author already
thinks in lists — `interview.md:5` says the schema predates the app by years),
or about whether the conceptual model is learnable by someone who did not
design it.

### Feedback-channel readiness

For a first launch to teach anything, one thing must exist: **a place where a
stranger's reaction lands where you will see it.** Today there is none — a
visitor who bounces at finding #5 leaves no trace.

The genuine tension: a no-server, local-first, privacy-respecting product has
principled reasons not to add telemetry, and adding it would contradict
`README.md:46`. **No analytics is recommended here.** Options that fit the
values, for section 6:

- **GitHub Discussions** — zero server, zero new privacy surface, already where
  the code lives. Costs nothing; reaches only people who already found the repo.
- **An in-app "Send feedback" link** opening a pre-filled GitHub issue. One
  anchor tag, no data collection, and it is the only option that catches the
  person who bounced *inside the app*. Requires a public issue tracker and
  someone to answer it.
- **Watching an Obsidian-forum or Reddit thread** for the launch. Highest-quality
  signal about the declared niche specifically, since that is where the declared
  user already is. Time-bounded and manual.

The cheapest thing that would settle the most: post once where TaskNotes users
read, and watch which of the five bets the replies are about.

---

## 6. The decisions only you can make

1. **What is the beachhead — the Markdown-vault keeper, or the person they share
   a calendar with?** Everything above forks here. Choosing the vault keeper
   means dropping `README.md:24`'s claim and leaning into the technical signals
   (theme menu, entry format, LLM-friendliness). Choosing the shared-calendar
   user means the setup path in finding #5 is the product's biggest debt and the
   next quarter belongs to it. *Consequence of not choosing:* the copy keeps
   promising both and the product keeps serving one.
2. **Does the revealed niche become the declared one?** The code has been
   investing in multi-source household calendaring (iCal, multi-vault,
   participants, ICS export) while the copy still leads with Obsidian +
   TaskNotes. iCal itself is now claimed in the README; multi-vault,
   participants and ICS export are not. Either update the pitch to match where
   the effort went, or decide the effort was a detour. *Consequence:* leaving
   it means that remaining investment stays invisible.
3. **Which differentiator leads?** Today "phone-first" leads the headline but
   recurrence depth is the thing no competitor has (verified: TaskNotes is one
   RRULE per task). Phone-first is easier to feel and easier for others to copy;
   recurrence depth is defensible and harder to explain. *Consequence:* leading
   with recurrence narrows the audience and strengthens the moat.
4. **Does "notes" stay in the pitch?** It has already left the three shortest
   surfaces — README headline, `index.html` meta description, PWA manifest
   description — and survives in the README feature list (line 34), philosophy
   (lines 73–98), the blog, and `CoachTour.tsx:47`. *Consequence:* keeping it
   invites comparison with Obsidian on ground the README explicitly concedes at
   line 186; dropping it makes the "one timeline" philosophy harder to state.
5. **Is the LLM-friendly audience worth targeting?** Stated once
   (`README.md:98`) with an Open Knowledge Format link, and nowhere else — no
   in-app surface, no blog framing. *Consequence:* it is either a growing
   distinct audience worth its own surface, or a paragraph that dilutes a pitch
   already carrying two audiences.
6. **Which feedback channel, if any?** Options and trade-offs in section 5.
   *Consequence of none:* the first launch teaches nothing, and every bet above
   stays open indefinitely.

Everything outside this list is actionable without further input.

---

*The survey file `plans/surveys/product-niche.md` was updated in a separate
commit on this branch: its `exampleBackend.ts` pointer was stale, its
preview-tooling fallback did not anticipate driving a browser directly via the
repo's own `playwright-core`, and the term-census instruction needed the
identifier-exclusion method that this run had to derive.*
