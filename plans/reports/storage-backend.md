# Storage backend survey

_Findings from a survey of candidate storage backends (July 2026). The question: what
backends fit the Meridian mindset — a directory in the cloud, protected by a
token/password, accessible via API from a static PWA, easy to set up for nontechnical
people?_

_Revised 2026-09-14 (#1082) with a second dimension the original survey never asked
about: **what the person you share with needs.** It reorders the recommendation and
retires the original #1 as written — see "Sharing: what the second person needs"._

## Requirements

Derived from `src/storage/backend.ts` and the PWA architecture, any backend needs:

1. **Cheap listing with per-file version tokens** — for `statAll()`.
2. **Compare-and-swap writes** — `write(path, content, expectedVersion)` must fail with
   `ConflictError` on version mismatch.
3. **Browser CORS support** — Meridian is a static PWA; the API must be callable
   directly from the browser. _This turns out to be the real filter._
4. **A workable auth story without a real server** — token paste, or OAuth PKCE
   (optionally via the existing stateless Cloudflare Worker for token exchange).

## Key reframe

"Protected by a token/password" and "easy for nontechnical people" pull in opposite
directions. For nontechnical users, _copying a token is the hard part_ and an OAuth
consent screen is the easy part. Meridian already has the infrastructure for OAuth
backends: `githubOAuth.ts` implements a GitHub App PKCE flow through a tiny stateless
worker. The "no server" constraint is already softened to "a stateless token-exchange
worker," which unlocks every OAuth backend below.

## The ideal exists as a protocol — twice

- **WebDAV** is literally "a password-protected cloud directory with an API," and maps
  1:1 onto the backend contract: `PROPFIND` + ETags = `statAll`, `If-Match` = CAS
  write, app-passwords = token. **Catch: CORS.** Most providers don't send CORS
  headers, so a browser PWA can't reach them. Koofr is the notable exception (why
  Obsidian's remotely-save recommends it); Nextcloud needs server-side config. Worth
  building eventually as the power-user escape hatch, with honest CORS caveats.
- **remoteStorage** (remotestorage.io) is _exactly_ the ideal — per-user cloud
  directory, designed for browser apps, CORS and ETags mandatory in the spec — but the
  provider ecosystem is essentially moribund. Validation of the idea, not a target.
  (Same for Solid pods, but more academic.)

## Candidate comparison

| Backend                           | Auth from static PWA                                      | CORS                    | Versioning / CAS                                         | Nontechnical setup                              |
| --------------------------------- | --------------------------------------------------------- | ----------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| **Dropbox (app folder)**          | OAuth PKCE, no secret, refresh tokens work                | ✅                      | `rev` per file                                           | ⭐ One consent click, zero tokens               |
| **OneDrive (MS Graph)**           | MSAL.js PKCE                                              | ✅                      | ETag + `If-Match`; delta API for cheap `statAll`         | Very good                                       |
| **Google Drive**                  | ~1h tokens in pure-browser flow; refresh needs the worker | ✅                      | version field; changes API                               | Good for users, most friction for the developer |
| **GitLab**                        | PAT paste (or OAuth PKCE)                                 | ✅ verified             | `last_commit_id` precondition; atomic multi-file commits | Same audience as GitHub — but see scoping below |
| **Codeberg / Forgejo / Gitea**    | PAT paste                                                 | ✅ verified             | contents API ≈ GitHub clone (`PUT` + `sha`)              | Same — but see scoping below                    |
| **S3-compatible (R2, B2, MinIO)** | Access key/secret                                         | Configurable per bucket | ETag; conditional `PUT`                                  | ❌ Bucket + CORS policy + keys                  |
| **CouchDB**                       | Password/token                                            | Configurable            | `_rev` is native CAS                                     | ❌ Self-hosted DB; not plain files              |

Not viable: **iCloud** (no browser API), **Syncthing** (no HTTP API), **Box** (works
technically, weak consumer traction).

The **Nontechnical setup** column rates what the *vault owner* goes through. For what
the person they share with goes through — a different question with a different
ranking — see "Sharing: what the second person needs" below.

## Folder scoping: server-enforced vs. "trust Meridian"

Both Microsoft and Google offer _server-enforced_ restriction — users never have to
rely on Meridian's good behavior — but the shape differs:

|                                                   | Server-enforced scope | Arbitrary folder?        | Out-of-band edits visible?                             |
| ------------------------------------------------- | --------------------- | ------------------------ | ------------------------------------------------------ |
| Dropbox app folder                                | ✅                    | ❌ fixed `Apps/Meridian` | ✅                                                     |
| OneDrive app folder (`Files.ReadWrite.AppFolder`) | ✅                    | ❌ fixed `Apps/Meridian` | ✅                                                     |
| Google `drive.file`                               | ✅                    | ✅ (picked via dialog)   | ❌ **new** files created outside the app are invisible |
| OneDrive `Files.ReadWrite` / Google `drive`       | ❌ whole drive        | ✅                       | ✅                                                     |

Notes:

- Google's `drive.file` gotcha breaks the README promise that hand-created files are
  picked up on next sync (edits to app-created files are fine; out-of-band _new_ files
  vanish). Full `drive` scope avoids this but is a restricted scope requiring an
  annual paid security assessment (CASA) on the developer side.
- The app-folder model is the right trade *for a single user*, and only for one: the
  restriction is real and legible ("Meridian physically cannot see your tax
  documents"), and the folder still behaves like a normal directory of Markdown
  files — including desktop sync via the Dropbox/OneDrive client, which delivers
  plain-files-on-disk even on iOS, where the File System Access API isn't available.
  It is also unshareable, which is what disqualifies it from the job that sent this
  survey looking past GitHub — see the next section.

## Sharing: what the second person needs

The comparison above rates **owner** setup. It says nothing about the second person,
and the two do not move together — a backend can be the easiest one to connect and the
hardest one to share.

Meridian's sharing promise has two halves, and only one of them is a storage question:

- **Being named on an entry.** `participants` is `string[]` (`src/types.ts`) — free
  text, resolved against nothing. Nobody named on an entry holds an account anywhere,
  on any backend. This half is backend-independent and already true, and it is the
  half that has no equivalent in Google Calendar or Todoist, where naming someone
  means inviting an account.
- **Reading and writing the vault from your own device.** This is the backend's
  problem, and every candidate surveyed answers it the same way: the second person
  needs their own account with that provider.

| Backend | What the second person needs | Shareable? |
| --- | --- | --- |
| **GitHub repo** | Free GitHub account, then a collaborator invite | ✅ — the only candidate here that shares a *folder* natively |
| **Dropbox / OneDrive app folder** | — | ❌ app folders cannot be shared at all (below) |
| Dropbox / OneDrive, full-drive scope | Their own Dropbox / Microsoft account | ✅, at the cost of the scoping the app-folder model was chosen for |
| Google Drive | Google account | ✅ |
| S3-compatible (R2, B2, MinIO) | Nothing, or a copy of the owner's key | ⚠️ no per-person identity exists — see the next section |
| Local folder | n/a | ❌ single device by construction |

**The Dropbox correction.** Recommendation #1 was written against the owner-setup column
alone. Dropbox app folders are incompatible with shared folders in both directions: an
app folder cannot be shared, a shared folder cannot be placed inside one, and two people
who both install the app cannot see each other's files. Sharing on Dropbox therefore
needs *full-Dropbox* scope — which discards the server-enforced isolation that made the
app folder the recommendation in the first place — and the second person still needs a
Dropbox account. **A Dropbox app-folder backend would be single-user by construction.**
It remains the best *single-user* backend on this list. It is not a sharing backend, and
the same holds for OneDrive's app folder.

**Reusing the owner's account is not the escape hatch.** It works technically: a second
device's sign-in gets its own token/refresh pair, GitHub invalidates only the refresh
token actually spent, and `githubOAuth.ts`'s per-vault turnstile already serialises each
chain, so two devices on one account do not fight over rotation. But GitHub's terms say
a login may be used by one person only and may not be shared, and name a paid
organisation account as the supported alternative. So it cannot go in the README, in
`inviteMessage()`, or into any claim the product makes.

## The shape that does cash "no account for the second person"

Not a backend on this list. What cashes it is a **capability link**: a share URL
carrying a credential scoped to the vault, which the invitee opens to get read/write
access — no signup, no provider account, no identity.

The distinction worth holding onto is that this is *not* "Meridian accounts". There is
no user table, no password reset, no recovery flow, and no personal data to hold. It is
one import path, plus whatever mints the scoped credential.

The S3-compatible row is where it lands cheapest, and it inverts that row's
"❌ Bucket + CORS policy + keys" rating: all of that friction is *owner* friction, and
the owner is a developer by assumption (that is the stated target group). A bucket the
owner already has, plus a link, gives dev-owner-sets-it-up-once →
non-technical-second-person-opens-a-URL, with no account for anyone but the owner and no
server for Meridian to run.

What is unresolved, and why this is a sketch rather than a plan:

- **Scoping the credential.** A plain S3 key in a link *is* the owner's key. Per-prefix
  scoping needs a bucket policy, which Meridian cannot mint from the browser; one
  bucket per vault is the crude answer.
- **Revocation.** A link is a bearer token, so revoking one means rotating the key and
  re-issuing every link cut from it.
- **The link is the secret.** It will be pasted into a chat app. That is the same threat
  model as the "anyone with the link can edit" share in every product this competes
  with — acceptable, but it should be stated rather than discovered.

**Not to be built before someone asks for it.** `VaultSettings.tsx`'s `inviteMessage()`
is the one point in the product where a sharing attempt is observable, and it is where a
"they don't have GitHub?" branch belongs once there is demand to point at.

## GitLab / Codeberg fine-grained tokens: worse than GitHub

Surprising result: **GitHub is the only forge where a free-tier user can paste a token
limited to a single repository's contents.**

- **GitLab:** `write_repository` scope is Git-over-HTTP only — it explicitly does not
  support API authentication. REST file writes (Repository Files API) require the
  `api` scope = **complete read/write access to the entire account**. The fix —
  project access tokens (per-project, role-limited) — is **paid-tier only on
  gitlab.com** (free on self-managed instances).
- **Codeberg (Forgejo):** scoped tokens are fine-grained by operation
  (`write:repository` does cover the REST API) but **not by repository** — a vault
  token can write every repo the user owns. Workaround (dedicated account owning only
  the vault) is too much setup for the target audience.
- Everything else checks out, verified live: both APIs send
  `access-control-allow-origin: *`; GitLab even exposes `X-Gitlab-Last-Commit-Id` /
  `ETag` to browser JS; Codeberg advertises 2000 req/10min. Forgejo's contents API is
  so close to GitHub's that `githubBackend.ts` would port almost mechanically.
- **Verdict:** self-hoster backends, not mainstream ones. The story flips on personal
  instances (self-managed GitLab gets project tokens free; a personal Forgejo's
  "all my repos" is usually just the vault). A Forgejo backend is probably the
  cheapest backend to ever add — a good community contribution to accept — but it
  doesn't advance the "nontechnical, safely scoped" goal.

## Recommendation

_Reordered 2026-09-14 (#1082). The original list ranked backends by owner setup alone;
with the sharing dimension added, its #1 turns out to serve a different user than the
one it was picked for._

1. **No second backend, until someone needs one.** GitHub satisfies every requirement
   above *including* sharing, and it is the only candidate here that does. Nothing on
   this list reaches a user GitHub fails — the alternatives buy optionality, not reach,
   and the audience is developers, who already have the account. Keeping
   `src/storage/backend.ts` an honest boundary is worth doing for its own sake (it is
   what makes the local-FS and iCal backends cheap), but backend pluralism is not a
   roadmap item with a person behind it.
2. **Dropbox app folder** — still the strongest *single-user* backend, for the same
   reasons as before: one-click OAuth (PKCE without a secret, possibly no worker
   needed), server-enforced folder isolation, `rev`-based CAS mapping cleanly onto
   `ConflictError`, and a desktop client that mirrors the vault to disk. It is no
   longer "strongest next backend": it cannot be shared, so it cannot serve the case
   that motivated looking past GitHub.
3. **OneDrive app folder** — same trade as Dropbox, same sharing ceiling; bigger install
   base, delta queries make `statAll` cheap, slightly more developer friction (Azure app
   registration, MSAL).
4. **WebDAV** — small implementation surface, serves the self-hosting crowd; ship with
   "your provider must allow CORS; Koofr works out of the box" caveats.
5. **Deprioritize Google Drive** — worst pure-browser token story of the majors, the
   `drive.file` invisible-files gotcha, and CASA verification friction for full scope.
6. **Forgejo/Gitea** — accept as a cheap contribution for self-hosters; don't position
   it as a mainstream option.

The thing that would actually extend reach is the capability link above, and it is
demand-gated, not cost-gated.

## Sources

- GitLab PAT scopes: https://docs.gitlab.com/user/profile/personal_access_tokens/
- GitLab project access tokens: https://docs.gitlab.com/user/project/settings/project_access_tokens/
- Project access tokens on free tier (declined): https://gitlab.com/gitlab-org/gitlab/-/issues/438820
- remoteStorage protocol: https://remotestorage.io
- CORS on gitlab.com / codeberg.org APIs: verified live via `curl` with `Origin`
  header, 2026-07-09

Added 2026-09-14 for the sharing dimension:

- Dropbox app folders cannot be shared: https://www.dropboxforum.com/t5/Dropbox-API-Support-Feedback/Sharing-of-folders-inside-the-Apps-folder/td-p/38534
- App-folder files are invisible between two users of the same app: https://www.dropboxforum.com/t5/Dropbox-API-Support-Feedback/Dropbox-scoped-app-folder-Visibility-of-uploaded-files-to-other/td-p/714008
- GitHub logins may not be shared between people: https://github.com/customer-terms/general-terms
- GitHub App refresh tokens are single-use and per-authorization (so per-device chains
  coexist): https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
