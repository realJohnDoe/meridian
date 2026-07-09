# Storage backend survey

_Findings from a survey of candidate storage backends (July 2026). The question: what
backends fit the Meridian mindset — a directory in the cloud, protected by a
token/password, accessible via API from a static PWA, easy to set up for nontechnical
people?_

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
- The app-folder model is the right trade: the restriction is real and legible
  ("Meridian physically cannot see your tax documents"), and the folder still behaves
  like a normal directory of Markdown files — including desktop sync via the
  Dropbox/OneDrive client, which delivers plain-files-on-disk even on iOS, where the
  File System Access API isn't available.

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

1. **Dropbox app folder** — strongest next backend. One-click OAuth (PKCE without a
   secret, possibly no worker needed), server-enforced folder isolation, `rev`-based
   CAS maps cleanly onto `ConflictError`, and the desktop client mirrors the vault to
   disk as a bonus.
2. **OneDrive app folder** — bigger install base; delta queries make `statAll` cheap;
   slightly more developer friction (Azure app registration, MSAL).
3. **WebDAV** — small implementation surface, serves the self-hosting crowd; ship with
   "your provider must allow CORS; Koofr works out of the box" caveats.
4. **Deprioritize Google Drive** — worst pure-browser token story of the majors, the
   `drive.file` invisible-files gotcha, and CASA verification friction for full scope.
5. **Forgejo/Gitea** — accept as a cheap contribution for self-hosters; don't position
   it as a mainstream option.

## Sources

- GitLab PAT scopes: https://docs.gitlab.com/user/profile/personal_access_tokens/
- GitLab project access tokens: https://docs.gitlab.com/user/project/settings/project_access_tokens/
- Project access tokens on free tier (declined): https://gitlab.com/gitlab-org/gitlab/-/issues/438820
- remoteStorage protocol: https://remotestorage.io
- CORS on gitlab.com / codeberg.org APIs: verified live via `curl` with `Origin`
  header, 2026-07-09
