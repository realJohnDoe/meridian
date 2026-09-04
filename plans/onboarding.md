# Onboarding for people who don't already have a repo

Plan for closing finding #5 of `plans/product-niche-results.md` — the README
promises Meridian is "usable by someone who won't configure a vault", and the
setup path can't currently cash that. Written 2026-09-04; nothing implemented
yet.

Per `plans/CLAUDE.md`: delete each PR's section from this file in the PR that
implements it, so what remains is only outstanding work.

---

## The decision this rests on

Survey decision 1 was **keep the promise and close the gap** — the multi-user /
shared-repo story stays in the pitch and gets advertised, so the setup path has
to earn it rather than the claim being softened. That rules out the "delete the
row from the README" option the survey listed, and makes everything below
product work rather than copy work.

Copy fixes for findings #1, #2 and #3 are *not* here — they are separate, and
the survey's sequencing note says the positioning decision lands first. The one
exception is PR 3, which fixes in-product instructions that are actively wrong
and sit directly on this flow.

---

## Rejected: creating the repo for the user

The obvious fix — a **"Create a repo for me"** button — was investigated and
**rejected**. Recording why, so it isn't re-proposed:

A GitHub App **user access token cannot create repositories**. `POST /user/repos`
needs an OAuth App token with the `repo` (or `public_repo`) scope; the App's
`Contents` permission covers reading and writing files in a repo that already
exists, not making new ones. Two community threads land on the same answer and
the same workaround — run an *OAuth App alongside* the GitHub App
([discussion 65724](https://github.com/orgs/community/discussions/65724),
[discussion 172926](https://github.com/orgs/community/discussions/172926)).

That workaround costs more than it buys here:

- a second `client_id`/secret pair in `worker/`, and a second consent screen;
- the `repo` scope is **all repositories, read and write** — strictly broader
  than the current per-repo App install, so the consent screen gets scarier
  precisely for the non-technical user this whole plan is for;
- it undercuts the fine-grained-permission story that makes the current install
  defensible.

**Instead:** link out to GitHub's own new-repo page and make the round trip
legible. A link costs nothing and asks for no new permission.

> Unverified, worth two minutes before PR 1: whether `https://github.com/new`
> still honours `?name=` and `?description=` query params to prefill the form.
> If it does, prefill `name=meridian-vault`. If not, plain-link it — the rest of
> the PR is unaffected.

---

## The current flow, and where it breaks

```
Settings → Vaults → Add vault → "GitHub repository"
  → [wizard GitHub step]  AddVaultWizard.tsx:228-241
      one button, "Sign in with GitHub". Says nothing about needing a repo,
      nothing about the App having to be installed.
  → github.com/login/oauth/authorize          githubOAuth.ts:55-62
  → /auth/callback                            auth.callback.tsx
      0 repos → 'no-installations' dead end   :166-177
      1 repo  → auto-connects, no picker      :90
      2+      → picker                        :192-207
```

Four distinct failure points, in the order a newcomer meets them:

1. **The wizard step promises nothing and warns of nothing** (`:228-241`). A
   user with no repo learns that only after a full OAuth round trip.
2. **The picker is skipped at exactly one repo** (`:90`, and again at `:118` in
   the `reconnect` fallback). Someone with one repo installed who wants to
   connect a *different* one is auto-connected to the wrong one with no way
   back except Settings.
3. **The picker has no way to add a repo** (`:192-207`) — bare
   `{owner}/{repo}` buttons, no install link, no create link.
4. **`no-installations` says "come back and sign in again"** (`:170`) — a second
   full OAuth round trip after installing.

And one that bites after the flow appears to succeed:

5. **An empty repo reads as a sync conflict.** A first-timer who creates a repo
   without ticking "Add a README" gets a repo with no commits.
   `githubBackend.ts:153` calls `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`;
   GitHub answers **409** on an empty repo; `failureKind.ts:57` maps 409 →
   `conflict`; `githubBackend.ts:184` calls `mapGitHubError(e)` **without a
   path**, so the user gets a `ConflictError` reading
   `Conflict on unknown: backend version diverged since last sync.`
   The mapping is verified from source; the 409 itself was not exercised against
   a live empty repo — do that first in PR 2.

---

## PR 1 — Make the GitHub connect path survivable without a repo

**Model: Sonnet 5.** Every site is named below, the traps are located, and a
wrong guess breaks a test rather than failing quietly.

The core of finding #5. All in `src/routes/auth.callback.tsx` and
`src/settings/AddVaultWizard.tsx`; no storage or model changes.

**1. Always show the picker.** Delete the `repos.length === 1` auto-connect at
`auth.callback.tsx:90` *and* the duplicate at `:118` in `reconnect`'s
vault-missing fallback — both branches must change or the two paths diverge.
`repos.length === 0` keeps its own phase. The picker becomes the single
destination for every non-reconnect sign-in.

This is also the previously-listed `next-steps.md` item **"fix flow for adding a
second vault"**: with one repo installed, signing in to add a second vault
auto-reconnects the first and never offers a choice. Same one-line cause.

Note the `reconnect` success path at `:130-132` is **not** affected — a genuine
reconnect of a known vault should still go straight through without asking.

**2. Give the picker somewhere to go.** Under the repo list at `:192-207`, add:

- **"Create a new repository on GitHub"** → `https://github.com/new` (see the
  prefill note above), and
- **"Add another repository…"** → `GITHUB_APP_INSTALL_URL`
  (`githubOAuth.ts:7`, already imported at `:5`).

Both are plain `<a>` elements, `target="_blank" rel="noreferrer"`, styled as
secondary to the repo buttons — the common case is still picking an existing
repo. Add one line above them saying the App has to be installed on a repo for
it to appear in the list, which is the fact that makes an empty list make sense.

**3. Fold `no-installations` into the picker.** It is the zero-length case of the
same screen and currently a separate dead end (`:166-177`). Concretely: delete
the `no-installations` phase from the `Phase` union (`:41`) and its render block
(`:166-177`), and make both call sites set `{ kind: 'picking', tokens, repos }`
unconditionally — `tokens` is already in scope at `:89` and `:117`. The picker
then branches on `repos.length === 0` for its lead line only ("Meridian isn't
installed on any repository yet" vs "Choose a repository"), and both links are
present either way. That removes the "come back and sign in again" instruction
entirely, since there is now something to click in place.

Leave `reconnect-repo-missing` (`:179-190`) alone — it is a genuinely different
state with an owner/repo in its message, and it is not on the new-user path.

**4. Tell the user what's coming, before the redirect.** In
`AddVaultWizard.tsx:234-237`, replace *"Choose which repository to connect after
signing in."* with copy that names the two prerequisites — a repository, and
Meridian installed on it — and links to `GITHUB_APP_INSTALL_URL`. This is the
one place a user can still back out cheaply.

**Traps.**
- `startGitHubSignIn` stores its PKCE verifier in **`sessionStorage`**
  (`githubOAuth.ts:46-52`) and the comment there is load-bearing: *"survives the
  redirect to github.com and back (same tab), but not a new tab — the flow must
  stay in one tab"*. Two consequences, in opposite directions. The **sign-in
  redirect must stay same-tab** — it is `window.location.href` at
  `githubOAuth.ts:62`; do not "improve" it into a popup or a new tab, or the
  verifier is unreachable when the callback lands. The **out-links must open in
  a new tab** (`target="_blank" rel="noreferrer"`), so a user who goes off to
  create a repo or install the App doesn't lose the screen they were on. Note
  the wizard's link is clicked before any verifier exists, so nothing is lost
  there beyond wizard state — it is the picker's links, after the exchange, and
  the sign-in redirect itself where the one-tab rule actually bites.
- `auth.callback.tsx:56-59` explains why `Route.useSearch()` carries an explicit
  annotation — CI lints before `routeTree.gen.ts` is regenerated. Don't "tidy"
  that away.
- The route is under the **document-flow** shell, not `_app` (see the Route
  shells table in `CLAUDE.md`) — leave it there; it has no virtualizer.

**Tests.** `src/routes/-entryTopbar.test.tsx` and `settings.test.tsx` are the
nearest precedents for route-level tests. Cover: one installed repo now renders
the picker rather than auto-connecting (the regression this PR is fixing);
zero repos renders both links; the reconnect success path still bypasses the
picker.

---

## PR 2 — An empty repository is a normal state, not a conflict

**Model: Sonnet 5 for the code — but it cannot start until someone answers the
one question at the end of this section**, which needs a GitHub token and a
throwaway repo, so it is not a model-tier question at all. The likely answer
makes this a small PR; the unlikely one makes it a different, larger one.

The same throwaway repo answers a second, smaller thing worth having: connect it
and record the **exact error text** the user currently sees. The 409 →
`ConflictError` mapping is verified from source, but the observed string is what
the fix has to replace, and it belongs in the PR description.

Then, in `githubBackend.ts:153-186`: catch **409 specifically in `statAll`** and
return an empty `Map` rather than throwing. An empty repo has no files, which is
exactly what an empty tree listing means — the current failure is a category
error, not a missing feature. Everything downstream (`parseToStoreItems` →
expansion → agenda) already handles a vault with no files, since that is what a
freshly-created local folder looks like.

**Do not** widen `failureKind.ts:57` to treat 409 as non-conflict globally — 409
is a real SHA-mismatch conflict on the write paths, and the comment at
`githubApi.ts:58-64` explains why the status and GitHub's own message are kept
on the error. Scope the change to `statAll`'s catch, matching on GitHub's
`Git Repository is empty` message rather than the bare status if the live check
shows the status alone is ambiguous.

**The one open question, and why it decides the size of this PR.**

Connecting an empty repo touches GitHub twice, and the fix above only covers
the first:

1. **The read.** `statAll` asks for the tree of branch `main`. On a repo with
   no commits that ref does not exist, so GitHub 409s. That is the fix above.
2. **The first write.** `write()` (`githubBackend.ts:276-296`) uses
   `PUT /repos/{owner}/{repo}/contents/{path}` with `branch: this._cfg.branch`
   — i.e. `main`, which still doesn't exist at that moment, because the
   repo *still* has no commits. Fixing the read gets the user connected; it
   does nothing about this.

So the question is exactly one thing:

> **Does `PUT /repos/{owner}/{repo}/contents/{path}` with `branch: "main"`
> succeed on a repository with zero commits, creating the initial commit and
> the branch?**

- **If yes** → the `statAll` catch is the entire PR. Sonnet 5, as scoped above.
- **If no** → Meridian has to create an initial commit itself before the first
  write can land. That is a different piece of work — what to commit, what
  happens when two devices connect the same empty repo at once, how it
  interacts with `syncJournal` — and it should be its own PR at Opus tier
  rather than being absorbed into this one. **Stop and re-plan if the answer
  is no.**

**Expectation, stated as an expectation:** probably yes. The Contents API is the
usual way to bootstrap an empty repo, and it is a different endpoint family from
the Git Data API (blobs/trees/commits/refs), which definitely does 409 on an
empty repo and is what most "409 Git Repository is empty" reports are about.
Meridian uses the Contents API, not the Git Data API, so it is on the side of
that split more likely to work. This could not be confirmed from a primary
source in the session that wrote this plan — `docs.github.com` was unreachable —
so it stays a question rather than an assumption.

**How to answer it** (~30 seconds, no code): create a throwaway repo with *no*
README, then

```
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/<you>/<throwaway>/contents/test.md \
  -d '{"message":"test","content":"aGk=","branch":"main"}'
```

A 201 means yes. Record the answer here, then implement.

---

## PR 3 — Make the app's own instructions true

**Model: Sonnet 5** for part 1 (a state-machine change with two named
silent-failure modes); **Haiku 4.5** for part 2 if the surviving vault term is
given in the task, since it is then a copy rewrite against labels listed below.
Splittable into two PRs on that line if you'd rather.

Two things a new user reads that are currently wrong, both cheap.

**1. The first-run tour never runs** (finding #4 — full diagnosis and traps in
`plans/product-niche-results.md`). Short version: `useResetOnChange`
(`src/hooks/useResetOnChange.ts`) seeds `prevDeps` with the current deps, so it
never fires on mount; `hasRealVault` (`CoachTour.tsx:27`) starts `false` for a
newcomer and never flips, leaving the guard at `CoachTour.tsx:83-87` unreachable.
Fix at the call site — **do not change `useResetOnChange`**, it has other callers
and its mount behaviour is the documented React-docs pattern. Gate on the store
having loaded (`vaultLoading`, as `auth.callback.tsx:19-26` does) so a returning
user doesn't get the tour again during the async restore. Update
`mountAndDropVault()` (`CoachTour.test.tsx:25-33`) and add the missing case:
mounts with no vault ever present, asserts the dialog appears.

**2. "Make it yours" names three buttons that don't exist.**
`src/storage/devFixtures/tutorialVault.ts:421+` tells the user to tap
**"Manage vaults"**, then **"Add local folder"** or **"Add GitHub repo"**. I
grepped all three across `src/**/*.tsx`: none exist. The real path is
Settings → **"Vaults"** → **"Add vault"** → **"GitHub repository"** /
**"Local folder"** (`VaultList.tsx`, `AddVaultWizard.tsx:16-41`). Same entry
also says local folders are *"(Chrome / Edge desktop only)"* while
`AddVaultWizard.tsx:27` says "desktop or Android" — it is turning away Android
users who could use it. Rewrite the steps against the real labels, and put
GitHub first since it is the only path that works on iOS.

While here: `tutorialVault.ts:426` says *"This example vault"* — the UI calls it
the **Tutorial vault** (`AddVaultWizard.tsx:40`). That is finding #2's rename;
fix it here only if #2 has already settled the surviving term, otherwise leave
it and let #2 do all sites at once. **Check `GLOSSARY.md` before renaming** —
`src/glossary.test.ts` fails the build on a stale term.

---

## PR 4 — An invite path for the shared-repo story

**Model: Sonnet 5.** One `SettingsRow`, one link, one copyable message.

The decision above keeps multi-user in the pitch, and right now **all** of it
happens outside the product: to share a vault, the second person has to be added
as a repo collaborator on github.com. There is no invite affordance anywhere in
`src/`.

### What the invitee actually has to do

**Install is per repo, not per person; each additional person only has to
authorize.** Settled by the app owner, and it matches how user-to-server tokens
are specified to work: a user access token's reach is the *intersection* of what
the installation can see and what the user can see. So once A has installed
Meridian on `A/vault`, a collaborator B who signs in gets `A/vault` back from
`GET /user/installations` → `GET /user/installations/{id}/repositories`
(`githubOAuth.ts:384-399`) without installing anything — B's OAuth consent at
sign-in is the whole of B's setup.

Two conditions this rests on, both satisfied by construction: A's installation
must actually cover that repo (it does — it is the repo A connected), and B must
have repo access on GitHub (that is what being added as a collaborator means).

This is asserted from the app's own configuration plus the documented token
semantics, **not** from a two-account test. The first real shared vault
confirms it for free; if B ever lands on an empty repo list after being added as
a collaborator, this is the assumption that broke, and the invite copy below
then needs `GITHUB_APP_INSTALL_URL` added and `README.md:7` qualified.

### The PR

A new `SettingsRow` in the existing **Source** `SettingsSection`
(`VaultSettings.tsx:142`), directly under the `Repository` row at
`VaultSettings.tsx:202-210`, gated the same way on `vault.kind === 'github'`:

- A link to `https://github.com/{owner}/{repo}/settings/access` — the page where
  a collaborator is added. `vault.github.owner`/`.repo` are already in scope.
- A copy-to-clipboard button yielding a short message the owner can send: what
  Meridian is, the app URL, and that the recipient signs in with GitHub and
  picks the repo. **No install step in that text** — per the above, they don't
  need one, and telling them to install would send them somewhere confusing.

`target="_blank" rel="noreferrer"` per PR 1's out-link rule. `README.md:7` needs
no qualification: "everyone you share it with reads and writes the same repo —
no vault to configure, no plugins" is accurate under this model.

---

## Deferred

**One-hop install → sign-in.** GitHub Apps can be configured to request user
authorization (OAuth) during installation, so `installations/new` redirects
straight to the callback with a `code` — collapsing the two round trips that
`auth.callback.tsx:170` currently spells out. Deferred because it starts with a
toggle in the App's own settings page that only the repo owner can flip, not
with code, and because PR 1 removes most of the pain without it. The callback
would then need to handle arriving with an `installation_id` alongside `code`.

**A desktop layout worth the name.** Out of scope here, noted so it isn't lost:
at 1440px the app is the phone layout widened, with ~300px of dead gutter. That
is consistent with phone-first, but it is the first thing a desktop visitor
sees. Sub-threshold item (G) in the survey results.
