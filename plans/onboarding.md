# Onboarding for people who don't already have a repo

Plan for closing finding #5 of `plans/product-niche-results.md` — the README
promises Meridian is "usable by someone who won't configure a vault", and the
setup path can't currently cash that. Written 2026-09-04.

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

Verified live (2026-09-04): `https://github.com/new` still honours `?name=` to
prefill the form across the sign-in redirect, so the picker's "Create a new
repository on GitHub" link uses `?name=meridian-vault`.

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
(`VaultSettings.tsx:151`), directly under the `Repository` row at
`VaultSettings.tsx:211-220`, gated the same way on `vault.kind === 'github'`:

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
straight to the callback with a `code` — collapsing the "install, then come
back and sign in separately" round trip into one. Deferred because it starts
with a toggle in the App's own settings page that only the repo owner can
flip, not with code, and because the picker's out-links already remove most
of the pain without it. The callback would then need to handle arriving with
an `installation_id` alongside `code`.

**A desktop layout worth the name.** Out of scope here, noted so it isn't lost:
at 1440px the app is the phone layout widened, with ~300px of dead gutter. That
is consistent with phone-first, but it is the first thing a desktop visitor
sees. Sub-threshold item (G) in the survey results.
