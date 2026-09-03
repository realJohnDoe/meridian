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
Microsoft (OAuth) or any ICS feed". Meridian now matches the ICS half and says
so nowhere — see finding #3.

### Unverified, flagged

- **Whether a collaborator on a shared repo needs their own GitHub App
  installation.** `githubOAuth.ts:387` calls `GET /user/installations`, which
  *may* surface an owner's installation to a repo collaborator. The README's
  line 7 sharing promise depends on this. **What would settle it:** two real
  GitHub accounts and one repo. Finding #5 is written only around the path I
  could verify from code (the owner's), not around the collaborator's.
- **Whether the desktop dead gutter is deliberate.** It reads as phone-first
  applied honestly, but nothing in the repo states it as a choice.

### PMF premise — re-verified, unchanged

The plan's premise still holds at this commit: no analytics, telemetry or
feedback path anywhere in the app; `.github/` holds four workflow files and
nothing else; `plans/next-steps.md` is two lines, both build work. There is no
PMF signal in this repository to read. Section 5 is written accordingly.

---

## 3. Category verdicts

1. **Niche fit** — *findings: #3.* The product honours its stated non-goal:
   `src/search/` is 313 lines and there is no graph view, no plugin API, no
   backlink-heavy note tooling — "it doesn't try to be a better note-taking app
   than Obsidian" is a decision the code keeps. Confirmed as strategy, not a gap.
2. **Niche recognition** — *findings: #4.*
3. **Visual identity & aesthetic fit** — *findings: below the cut* (see G).
   Fully assessed via real screenshots.
4. **Differentiation & alternatives** — *findings: #1, #3.*
5. **Audience selection** — *findings: #5.*
6. **Adoption gates** — *findings: #5.* Confirmed as working: the read-only
   Tutorial vault is a genuine try-before-committing path, reachable with zero
   setup, and it is the app's default state.
7. **Niche drift & emerging signals** — *findings: #2, #3, and below the cut* (F).

---

## 4. Findings — top 5

**The verdict and this table disagree on order, deliberately.** The niche verdict
leads on impact and names #4 as the change to make; the table below ranks on
`(impact × breadth) ÷ effort`, which is return on effort. #1 and #2 outrank #4
and #5 because they are cheap and wide, not because they matter more.

| Rank | # | Finding | Gap | Question | Impact | Breadth | Recommended model | Score |
|---|---|---|---|---|---|---|---|---|
| 1 | #1 | No visual proof of the phone claim | declared-vs-served (inverted) | communication | 7 | 3 | Haiku 4.5 | 21 |
| 2 | #2 | "Example vault" / "Tutorial vault" and the folder/vault/repo fracture | declared-vs-served | communication | 4 | 5 | Haiku 4.5 | 20 |
| 3 | #3 | iCal, backlog, favorites, themes, multi-vault shipped and unclaimed — blog says the opposite | declared-vs-revealed | both | 7 | 4 | Sonnet 5 | 14 |
| 4 | #4 | The first-run coach tour never runs | declared-vs-served | communication | 8 | 3 | Sonnet 5 | 12 |
| 5 | #5 | "Usable by someone who won't configure a vault" is not a promise the product can cash | declared-vs-served | fit + communication | 8 | 5 | Opus 5, plan mode, multi-PR | 8 |

**Sequencing note.** #5 is a positioning decision and #2 picks the surviving
term; both touch `README.md` and the settings/onboarding copy. Land #5's decision
first, then #2's rename, then #1 and #3's README edits — otherwise the copy gets
written twice. #4 is independent (source only) and can go first or in parallel.

---

### #1 — The phone claim is asserted five times and shown zero times

- **Gap:** `declared-vs-served`, inverted — the served experience is *better*
  than the declared surface can prove. Worth stating plainly rather than forcing
  it into one of the three labels.
- **Question:** communication
- **Category:** `proof` `differentiation` `recognition`
- **Who it costs us:** the visitor who arrives from a link or a forum post and
  does not click through to the app. **Share: unknown** — there is no analytics.
  What *is* knowable from artifacts: the claim carries the headline (README:3),
  so every arrival meets it, and the only three surfaces that could carry an
  image carry none.
- **Impact:** 7
- **Evidence:**
  - `README.md:3` — `**Tasks and a calendar that are actually good on your phone — stored as plain Markdown files you own.**`
  - `README.md` contains **no image at all** (`grep -n '!\[' README.md` → no matches).
  - `index.html:42` — `    <meta property="og:image" content="https://realjohndoe.github.io/meridian/icon-512.png">` — every shared link previews the app *icon*, not the product.
  - `vite.config.ts:151-183` — the manifest declares `name`, `description`,
    `icons`, `display`, `start_url`, `background_color`. There is **no
    `screenshots` key**, so the Android install prompt shows the minimal dialog
    rather than the richer install UI.
  - Product evidence: the mobile UI genuinely is the differentiator — verified by
    screenshot at 390×844 (bottom-anchored search + FAB, one-handed reach,
    no reflowed desktop chrome). And usable screenshots already exist in-repo at
    `blog/1-meridian-why-i-built-a-markdown-first-calendar/images/agenda-view.png`.
- **Breadth:** 3 surfaces, from an actual search (`README.md`, `index.html`,
  `vite.config.ts` manifest).
- **Recommended model:** **Haiku 4.5.** The work is adding images and one
  manifest key; a wrong version is visibly wrong, not silently wrong.
  - *Task context:* the in-repo `agenda-view.png` is from a July build (red sync
    icon, no bottom search bar) — **regenerate rather than reuse it**. The recipe
    that produced fresh ones this run: `pnpm exec vite --port 5199 --strictPort`,
    then `playwright-core` (already a devDependency) with
    `executablePath: '/opt/pw-browsers/chromium'`, viewport 390×844,
    `deviceScaleFactor: 2`, navigate to `http://localhost:5199/meridian/`, wait
    ~2.5s. **The trap:** the PWA manifest's `theme_color` is deliberately
    `undefined` and `vite.config.ts:155-174` is a 20-line comment explaining why
    — add `screenshots` **without** touching `theme_color`, or you re-introduce
    the Firefox-for-Android status-bar bug that comment documents. `screenshots`
    entries need `src`, `sizes`, `type` and `form_factor` (`"narrow"` for the
    390×844 shot, `"wide"` for a desktop one) for Chrome to use the rich prompt.
- **Problem:** the target user is asked to take the product's single most
  important claim entirely on trust, on every surface where they meet it.
- **Fix:** put a phone screenshot directly under the README headline, point
  `og:image` at it, and add a `screenshots` array to the manifest.

---

### #2 — The product renamed the Tutorial vault and the copy still says "Example vault"

- **Gap:** `declared-vs-served`
- **Question:** communication
- **Category:** `recognition` `identity`
- **Who it costs us:** the visitor following the README's getting-started list
  literally and looking for a button that no longer exists. **Share: unknown**,
  but this is on the default path — `README.md:61` is step 2 of 4 in the only
  setup instructions the project publishes.
- **Impact:** 4
- **Evidence:**
  - `README.md:61` — `2. Try the **Example vault** to get a feel for the interface — click through the onboarding tour.`
  - `src/settings/AddVaultWizard.tsx:40` — `  title: 'Tutorial vault',`
  - `src/storage/devFixtures/tutorialVault.ts:426` — `This example vault is **read-only** — edits and new entries won't be saved here.` (the vault's own content still uses the retired name)
  - The wider fracture, same concept, four words: `src/onboarding/CoachTour.tsx:47`
    says `plain Markdown files in a folder you own`, then
    `src/onboarding/CoachTour.tsx:73` says `manage vaults in Settings` — the term
    is introduced, undefined, two steps after a different word for the same
    thing. `README.md:63` adds a third: `click "Connect GitHub repo"`.
  - Term census (method: whole-word, case-insensitive; `src/` counted over
    quoted string literals and JSX text in non-test `.tsx` only, so identifiers
    are excluded): `vault` 33 in user-visible `src/` strings vs 8 in the README;
    the same raw grep including identifiers gives 1,749, which is why the
    identifier-excluded count is the one to use.
- **Breadth:** 5 files, from an actual search (`README.md` ×3 occurrences,
  `AddVaultWizard.tsx`, `tutorialVault.ts`, `CoachTour.tsx`, `index.html`).
- **Recommended model:** **Haiku 4.5**, *given the surviving term is named in the
  task* — that choice is #5's to make, not the fixer's.
  - *Task context:* the enumerated work, once the term is decided — `README.md`
    lines 9, 52, 61 ("Example vault" → decided term); `tutorialVault.ts:426`
    ("This example vault"); and if the decision is to define "vault" rather than
    drop it, one clause at `CoachTour.tsx:47`. **What stays:** the ~1,749
    `vault` identifiers in `src/` — this is a user-visible-copy change only, and
    `vaultRegistry`/`VaultRef`/`AddVaultWizard` symbol names must not be touched.
    **The trap:** `GLOSSARY.md` is enforced by `src/glossary.test.ts`, which
    fails the build if a renamed term is not updated there and blocks retired
    names from returning — check `GLOSSARY.md` before renaming anything, per
    `CLAUDE.md`.
- **Problem:** a reader cannot tell whether a folder, a vault and a repo are
  three things or one, and the one button the README names is labelled
  differently in the app.
- **Fix:** pick one user-facing word, apply it to the five sites above, and
  define it once on first use.

---

### #3 — The product shipped its own biggest stated blocker and no surface says so

- **Gap:** `declared-vs-revealed`
- **Question:** fit + communication
- **Category:** `differentiation` `niche-definition` `proof`
- **Who it costs us:** the Obsidian/TaskNotes user comparing feature lists, who
  reads that Meridian cannot import their existing calendar and stops.
  **Share: unknown.** What is knowable: the blog post is the project's only
  long-form pitch, and the sentence sits in its closing section.
- **Impact:** 7
- **Evidence:**
  - `blog/1-meridian-why-i-built-a-markdown-first-calendar/meridian-why-i-built-a-markdown-first-calendar.md:241` — `off Proton yet. The most useful missing piece is probably iCal import — until you can pull` *(hard-wrapped prose at ~90 chars; the thought runs lines 241–243)*
  - Same file, `:77` — `iCal compatibility ever matters, I can add it underneath.)` *(thought runs 76–77)*
  - Contradicted by shipped code: `src/settings/AddVaultWizard.tsx:33` —
    `    desc:  'Paste an iCal address from Google, Outlook, Apple or anywhere else. Read-only — its events appear alongside your own.',`
  - Scale of the unclaimed investment: `src/storage/ical/` is 1,948 lines across
    6 non-test files, plus `icalBackend.ts` (182) and `exportVaultIcs` — roughly
    28% of `src/storage/`, more than all of `src/settings/`.
  - Also shipped and absent from the README's "What it does" (lines 30–42), each
    from an actual count of user-visible `src/` strings: **Backlog** (own route
    `_app.backlog.tsx`, 29), **Favorites** (76), **themes** (113 — nine
    palettes, `src/settings/themes.ts:30-38`), and multi-vault
    (`vaultRegistry.ts`, 766 lines), which the README's backend table presents
    as a one-of-three choice rather than something you can add several of.
- **Breadth:** 4 surfaces (`README.md` — both the backend table and the feature
  list, `blog/1-…`, `index.html` description, `vite.config.ts` manifest
  description).
- **Recommended model:** **Sonnet 5.**
  - *Task context:* **the trap is overclaiming.** The iCal backend is a
    **read-only subscription** — `icalBackend.ts:6-15` synthesizes virtual `.md`
    files and the wizard copy says "Read-only" — so copy must not imply two-way
    calendar sync. Export is separate (`exportVaultIcs`, one direction out).
    Feeds the browser cannot read go through Meridian's own Worker
    (`icalBackend.ts:20-23`), which is worth a word in a README that otherwise
    says "Meridian doesn't run a server that holds your notes" (`README.md:46`)
    — that sentence stays true (the Worker proxies, it does not hold notes), but
    the two claims should be written so they do not appear to contradict.
    **The blog is a dated post, not a spec** — prefer a short correction note to
    silently rewriting a first-person narrative about what was missing in July.
- **Problem:** the product's strongest recent answer to "why can't I switch?" is
  invisible, and its own blog still tells the reader the answer is no.
- **Fix:** add a "Calendar subscription" row to the README backend table and an
  iCal bullet to "What it does"; append a dated note to the blog post; decide
  separately (section 6) whether backlog/favorites/themes/multi-vault join the
  feature list or stay deliberately unlisted.

---

### #4 — The coach tour never runs, so the app never says what it is

- **Gap:** `declared-vs-served`
- **Question:** communication
- **Category:** `recognition` `adoption-gate` `niche-definition`
- **Who it costs us:** **every** first-time visitor to the app. This is the one
  place in the finding list where the share is knowable and total: the auto-start
  path is unreachable for anyone who has never connected a vault, which is the
  definition of a first-time visitor.
- **Impact:** 8
- **Evidence:**
  - `src/onboarding/CoachTour.tsx:82` — `  // Auto-start once, before any real vault exists (never again after Skip/Done)`
  - The hook it relies on cannot do that. `src/hooks/useResetOnChange.ts`
    initialises `prevDeps` to the *current* deps, so `changed` is `false` on the
    first render and `sync` never runs on mount. `hasRealVault` starts `false`
    for a new visitor and stays `false`, so it never flips and the guard is
    unreachable.
  - The test suite documents the defect instead of catching it.
    `src/onboarding/CoachTour.test.tsx:20` — ` * value, never on mount — so the tour needs \`hasRealVault\` to actually flip`
    — and `mountAndDropVault()` mounts *with* a real vault and then removes it, a
    sequence a first-time visitor never performs. All tour tests pass green.
  - Confirmed empirically this run: a clean browser profile at
    `http://localhost:5199/meridian/`, 6s wait — `[role="dialog"]` count `0`,
    `localStorage['meridian.tourDone']` `null`, no tour text in `document.body.innerText`.
  - What is therefore never said: `src/onboarding/CoachTour.tsx:47` —
    `Meridian keeps your notes, events, and tasks as plain Markdown files in a folder you own.`
    That is the **only** statement of the niche anywhere inside the app. The
    first screen otherwise shows an agenda list with no reference to Markdown,
    files, folders or ownership (verified by screenshot, both widths).
  - `README.md:61` instructs the user to `click through the onboarding tour.`
- **Breadth:** 3 surfaces (`CoachTour.tsx` production path, `CoachTour.test.tsx`
  which encodes the wrong precondition, `README.md:61` which promises it).
- **Recommended model:** **Sonnet 5.** The bug is located and the fix is small,
  but it is a state-machine change with two easy ways to fail silently.
  - *Task context:* the fix is to make auto-start evaluate on mount, not only on
    a `hasRealVault` transition — e.g. seed `useResetOnChange`'s `prevDeps` with
    a sentinel in this call site, or replace the call here with a mount-time
    check. **Do not change `useResetOnChange` itself**: its "never on mount"
    behaviour is the documented React-docs pattern (`useResetOnChange.ts:3-9`)
    and it has other callers. **Trap 1:** the store loads asynchronously, so
    `vaults` is briefly empty even for a user who *does* have a real vault —
    gate on the store having loaded, or a returning user gets the tour again.
    **Trap 2:** `isTourDone()` returns `true` when `localStorage` throws
    (`tourState.ts:4`), which is the intended fail-closed behaviour — keep it.
    **Update `mountAndDropVault()` in `CoachTour.test.tsx:25-33`** and add a test
    that mounts with *no* vault ever present and asserts the dialog appears;
    that is the case with no coverage today. The four existing behaviour tests
    (advance/back, Done, Escape, Skip) should keep passing unchanged.
- **Problem:** the app's first screen communicates an interface and never a
  niche, so a visitor who arrives without reading the README cannot tell this is
  a Markdown-files product at all.
- **Fix:** make the tour auto-start on first mount when no real vault exists, and
  add the missing first-visit test.

---

### #5 — "Usable by someone who won't configure a vault" is not a promise the product can cash

- **Gap:** `declared-vs-served`
- **Question:** fit + communication
- **Category:** `audience-selection` `adoption-gate` `differentiation`
- **Who it costs us:** the non-technical person a current user tries to share a
  calendar with — the exact person README:7 recruits. **Share: unknown**, and it
  belongs in the bet list rather than an estimate; see bet 5 in section 5. What
  is knowable: the claim sits in the first comparison table, at line 24, above
  the fold.
- **Impact:** 8
- **Evidence:**
  - `README.md:24` — `| Usable by someone who won't configure a vault | ✅ | ❌ | ✅ |`
  - `README.md:7` recruits that person explicitly: `**And whoever you share with doesn't have to be you.** Point Meridian at a repo and everyone you share it with reads and writes the same repo — no vault to configure, no plugins. Tag people on entries, filter the calendar down to one person.`
  - The served path contradicts it three ways:
    1. **The word.** 33 user-visible `vault` strings in `src/`; the settings
       screen is a vault list; the wizard is `AddVaultWizard`; and
       `src/onboarding/CoachTour.tsx:73` tells the user to `manage vaults in Settings`.
    2. **The setup.** `src/routes/auth.callback.tsx:170` —
       `        description="You're signed in, but the app isn't installed on any repository yet. Install it, then come back and sign in again."`
       — a round trip out to GitHub to install a third-party App
       (`githubOAuth.ts:7`), then a **second** sign-in. `README.md:63` describes
       this as `click "Connect GitHub repo", **Sign in with GitHub**, and pick the repository to use — no token to create by hand.`
    3. **The alternative.** The only non-GitHub writable backend needs Chrome or
       Edge (`AddVaultWizard.tsx:27`), which the README concedes at lines 51 and 64.
  - Counter-evidence worth weighing before changing anything: the visual identity
    genuinely does recruit that person (see the blind visual read — it looks like
    a consumer app), and the read-only Tutorial vault genuinely is a zero-setup
    front door. The claim is not fantasy; it is ahead of the setup path.
- **Breadth:** 5 surfaces (`README.md` lines 7/24/63, `AddVaultWizard.tsx`,
  `auth.callback.tsx`, `CoachTour.tsx:73`, the settings vault screens).
- **Recommended model:** **Opus 5, in plan mode, spanning multiple PRs** — and
  the task context does **not** bring this down a tier, because what is expensive
  here is a decision, not missing information. Whether the beachhead is the
  Markdown-vault keeper or the person they share a calendar with determines
  whether the right move is to delete the claim or to build the setup path that
  earns it. That is the user's call, and section 6 states it as such.
  - *The hazard that sets the tier:* the tempting fix — deleting the row and
    softening line 7 — is a silent positioning loss. It removes the product's
    only differentiator against Obsidian + TaskNotes that is about *other
    people* rather than about the author, and the code has been investing in
    exactly that (participants, per-vault colours, ICS export, multi-vault). A
    confident copy edit here would position the product *away* from where it is
    demonstrably heading.
  - Options the plan should lay out, not choose between: (a) keep the promise and
    close the gap — a share/invite path that does not require the recipient to
    understand repos; (b) keep the promise but scope it honestly — "usable by
    someone who won't configure a vault" becomes "…once you've set it up for
    them"; (c) drop the audience and commit to the technical niche, in which case
    the theme menu (below) becomes an asset to surface rather than a curiosity.
- **Problem:** a person is recruited by an above-the-fold promise and then meets
  a GitHub App install and a vocabulary the promise said they would not have to
  learn.
- **Fix:** decide the beachhead first (section 6), then either build the sharing
  path or requalify the claim — do not simply delete the row.

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
aimed at the declared niche is buried. Depends on #5's decision; do not act on it
before that.

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

The code corroborates the shape of that use. The unclaimed iCal subsystem
(finding #3) is the author solving their own named blocker — you cannot leave
Proton until you can pull a calendar in. Participants, per-vault colours and
multi-vault are all the household-scheduling problem. `next-steps.md` lists
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
   TaskNotes. Either update the pitch to match where the effort went, or decide
   the effort was a detour. *Consequence:* leaving it means the strongest recent
   work stays invisible (finding #3).
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

Everything outside this list is actionable without further input, except
finding #2's choice of surviving term, which decision 1 settles.

---

*The survey file `plans/surveys/product-niche.md` was updated in a separate
commit on this branch: its `exampleBackend.ts` pointer was stale, its
preview-tooling fallback did not anticipate driving a browser directly via the
repo's own `playwright-core`, and the term-census instruction needed the
identifier-exclusion method that this run had to derive.*
