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
