# "Could not reconnect GitHub vault — check your token": investigation and PR plan

Investigation of two field reports (2026-08-18):

- **Report A** (~1.5 months ago): the toast appeared; removing and re-adding the
  vault fixed it; GitHub did *not* ask for authorization again.
- **Report B** (yesterday, iPhone/LTE): the same toast appeared; nothing was
  re-added; sync worked again by itself.

**Status: PR 1 (`src/storage/failureKind.ts`), PR 2 (`mountVaultRef` in
`src/storage/vaultRegistry.ts`), PR 3, PR 4, PR 6, PR 7 and PR 8 have shipped —
hence the gaps in the numbering below. Everything still listed is
outstanding.** Every claim
marked _read_ comes from the code with the line cited; the investigation
sections below describe the code as it stood when the reports came in, so a
citation there may predate a shipped PR.

---

## The headline

The message is wrong in three independent ways, and only one of them is about
authentication:

1. **The classifier's default is backwards.** Anything that is not a
   *recognized network-error string* is treated as an auth failure. GitHub 5xx,
   an aborted request, and every iOS Safari network message except two all land
   on "check your token".
2. **The restore path has no recovery, and no memory.** The mount path is a
   second, poorer copy of the sync path: no forced token refresh, no backoff, no
   persistent state. A GitHub vault that fails to mount is left *unmounted for
   the rest of the session*, with a 5-second toast as its only trace — nothing
   retries it, and the sync popover shows it as merely "Not synced yet".
3. **There is no way to re-authenticate a vault.** Remove-and-re-add is the only
   cure — and it calls `cacheDeleteAll` (`src/storage/vaultRegistry.ts:697`), so
   it **destroys any local edit that had not been pushed yet**.

The word "token" is stale on top of that: the fine-grained-PAT flow is gone (no
UI anywhere reads a token — `AddVaultWizard.tsx` only offers "Sign in with
GitHub"), so "check your token" names something the user cannot see, cannot
check, and never typed in.

## What actually produces the toast

`src/storage/vaultRegistry.ts:465` fires it when `mountVaultRef` returns
`'denied'`. That comes from exactly one place — `GitHubBackend.ensurePermission`
(`src/storage/githubBackend.ts:301-323`):

```ts
return isTransientSyncError(mapGitHubError(e)) ? 'unreachable' : 'denied'
```

So `denied` means "not classified as transient". Two collaborators decide that:

- `mapGitHubError` (`src/storage/githubApi.ts:64-90`) — keys off the HTTP status.
  Handles 401, 403, 404, 409, 422. **Everything else falls through unclassified.**
- `isTransientSyncError` (`src/storage/conflictError.ts:41-51`) — `navigator.onLine
  === false`, or the message matching
  `/failed to fetch|networkerror|load failed|network request failed/i`.

### The failure table

| Real cause | HTTP status | Classified today | Should be |
|---|---|---|---|
| Offline, Chrome ("Failed to fetch") | — | transient ✓ | transient |
| iOS Safari "The network connection was lost." | — | **denied → "check your token"** | transient |
| iOS Safari "The Internet connection appears to be offline." | — | **denied** | transient |
| Request killed by backgrounding (`AbortError`, "cancelled") | — | **denied** | transient |
| DNS / captive portal / proxy failure | — | **denied** | transient |
| GitHub 500 / 502 / 503, Cloudflare 52x | 5xx | **denied** | transient |
| 408 / 429 | 4xx | **denied** | transient |
| Secondary rate limit *with* `retry-after` | 403 | transient ✓ | transient |
| Secondary rate limit *without* headers | 403 | **denied** | transient |
| Access token expired or revoked early | 401 | denied — **no refresh retry on this path** | refresh, then retry |
| Refresh token dead (rotated away, App reinstalled, 6-month expiry) | 401 after a failed refresh | denied, "check your token" | **needs re-auth** — offer sign-in |
| App uninstalled, or repo dropped from the installation | 403 / 404 | denied, "check your token" | needs install/permission change |
| Configured branch renamed or deleted | 404 | denied, "check your token" | vault config is wrong |

Both field reports sit in this table:

- **Report B** is the mobile row(s). At launch on LTE, one dropped request →
  `'denied'` → the vault is never mounted → the session is dead for that vault
  → next launch works. The screenshot is a phone on LTE, mid-launch. It matches
  exactly, and no credential was ever involved.
- **Report A** is the "refresh token dead" row, and **its cause is now fixed**.
  GitHub App user tokens last 8h and the refresh token **rotates on every
  use**; the app used to write the new pair as three separate Dexie puts, so a
  tab killed mid-write — routine on iOS — stored a new access token beside a
  *dead* refresh token, after which every refresh failed silently and the vault
  was permanently "check your token" until re-added. PR 6 made that write
  atomic and PR 7 made rotation single-flight and its failures typed. What is
  still missing is the *recovery*: the row's "should be" column — offer
  sign-in — is PR 3 + PR 4 + PR 5.

### Two further confirmed defects found on the way

- **A denied vault is unreachable by every retry path.** `autoSyncTick`,
  the `online` handler and `visibilitychange` (`src/routes/__root.tsx:156-182`)
  all iterate `getMountedBackends()`. A vault that failed to mount is not in it.
- **"Sync now" on such a vault says the wrong thing entirely.** `syncToBackend`
  finds no backend, so it reports *"No writable vault connected. Add a local
  folder first."* (`src/storage/sync.ts:996`) for a GitHub vault.

---

## Why this is hard to fix and harder to test (the architectural part)

Four structural causes. The PRs below are organized around removing them, not
around patching the strings.

**A. Two parallel classification paths, and the worse one greets the user.**
The sync path (`runSync`, `sync.ts:768-825`) is good: it force-refreshes once on
`AuthSyncError` and retries, splits transient from actionable, backs off
exponentially, writes a persistent per-vault `error`, and dedupes its toast. The
mount path (`ensurePermission` → `PermissionOutcome`) re-implements a fraction of
that and has none of the recovery. Every fix has to be made twice today, and the
mount path has nowhere to *record* what it learned.

**B. `PermissionOutcome` is a lossy type borrowed from the wrong domain.**
`PermissionState | 'unreachable'` (`storage/backend.ts:19`) comes from the DOM
File System API, where "permission" really is a browser-level gate. GitHub has no
such gate — it has *failures*. "Re-auth me", "the App lost the repo", "the branch
is gone" and "GitHub is down" all collapse into `'denied'`. Because the type
cannot carry a reason, the message is composed at the call site from the vault
*kind* alone — which is literally why it says "check your token".

**C. Classification is spread across three files and partly keyed on English
message strings.** There is no single table, so there is nothing to test as a
unit, and every new device/browser wording is a new silent misclassification.

**D. A failed mount has no representation in the store.** `syncByVault` only
exists for mounted vaults, and `needsReconnect` is set solely for the local-FS
`'prompt'` outcome (`vaultRegistry.ts:338`) — a value `GitHubBackend` can never
return. So the tests assert on toast *strings* (`notifyFns.notify`), which is
both brittle and the wrong layer.

---

## How the model recommendation was made

**Opus 5** where a PR decides *semantics with a silent, durable failure mode*
— concurrency around a single-use credential, or a rule about when a credential
is declared dead. Getting these wrong doesn't fail loudly in CI; it bricks one
user's vault weeks later, which is exactly the bug this plan exists to fix.

**Sonnet 5** where the decision is already made — pinned by a table, a type
signature, or a copy deck written out below — and the work is a mechanical edit
plus the listed tests.

**Haiku 4.5** for purely additive or find-and-replace work against an explicit
list.

**This split was engineered, not observed.** The judgment calls were pulled
*forward into this document* — the classification table (PR 1), the mount
decision table (PR 2), the state type and its transitions (PR 3), the copy deck
(PR 4, PR 9), and the security invariants of the re-auth round trip (PR 5) are
all decided here, so the PRs that carry them are transcription plus tests. Where
that was not honestly possible, the PR was kept small and left with Opus rather
than being papered over with a spec that reads more certain than it is — which
is how the now-shipped PR 7 was scoped.

The same instinct also drove the PR boundaries: **PRs are split along the
judgment/mechanical seam**, not along file boundaries. PR 3 and PR 4 are one
feature cut into "the state" and "the UI that renders it"; PR 6 and PR 7 were one
credential fix cut into "write it atomically" and "decide when it's dead".

## The PRs

| # | Title | Model | Est. | Blocked by |
|---|---|---|---|---|
| 5 | Re-authenticate an existing vault | Sonnet 5 | 1d | — |
| 9 | Vocabulary pass | **Haiku 4.5** | 0.25d | — |

Total ≈ 1.25d remaining, including per-PR tests and review.

### Ordering

```
PR9
PR5
```

Report A is already fixed — PR 6's atomic `credentialsSave` and PR 7's
single-flight, typed refresh failures have both shipped. PR 5 makes it
recoverable in one tap. (Report B was fixed by PR 2.)

---

### PR 5 — Re-authenticate an existing vault

**Model: Sonnet 5** · 1d

The flow, end to end:

1. `startGitHubSignIn(opts?: { reconnectVaultId?: string })` stashes the id in
   `sessionStorage` under `meridian_oauth_reconnect`, beside the existing
   verifier and state keys, and clears it on the same path they are cleared.
2. `auth/callback` reads it **after** `completeGitHubSignIn` has validated state
   and verifier — never before, and never as a substitute for either.
3. Reconnect branch: look the vault up in `getVaults()`; call
   `fetchInstalledRepos(tokens.accessToken)`; **require the vault's own
   `owner/repo` to be in that list**; then call a new
   `reauthGitHubVault(vaultId, tokens)` in `vaultRegistry.ts` — save credentials
   (via PR 6's `credentialsSave`), unmount any existing backend, mount a fresh
   `GitHubBackend`, clear `needsAttention`, sync. No repo picker, no new vault,
   no `newVaultId`.
4. Failure branches: vault no longer registered → fall through to today's normal
   add flow. Repo not in the installation → the `no-installations` screen's
   sibling, naming the repo and linking the App's configure page.

**Security invariants — call these out in the PR description and check them in
review:**

- The reconnect id **never** short-circuits PKCE state/verifier validation.
- Credentials are saved **only** after the repo-membership check above passes.
  This is what stops a sign-in as a *different GitHub account* from writing that
  account's tokens onto this vault.
- The id lives in `sessionStorage`, not the URL — it must not be reachable from a
  crafted callback link.

**Why this matters beyond convenience:** the vault id is unchanged, so Dexie
rows, favourites, prefs, URLs **and unpushed local edits survive** — unlike
remove-and-re-add, which calls `cacheDeleteAll` and destroys them.

**Tests:** extend `auth.callback.test.tsx` (it already mocks the three OAuth
entry points) with: reconnect id present + repo still installed → `reauth` called,
`addGitHubVaultOAuth` **not** called; reconnect id present + repo missing → neither
called, install screen shown; no reconnect id → today's behaviour unchanged.

---

### PR 9 — Vocabulary pass

**Model: Haiku 4.5** · 0.25d

Find-and-replace against this exact list. No user-facing string says "token";
each names something the user can act on.

| Now | Replace with |
|---|---|
| `Could not reconnect GitHub vault "X" — check your token.` (`vaultRegistry.ts:466`) | *deleted in PR 2* |
| `Could not connect to GitHub vault "X" — check your token.` (`:515`) | `Could not connect to "X" — sign in to GitHub again.` |
| `Vault "X" is missing its GitHub token — remove and re-add it.` (`:464`) | `Vault "X" isn't signed in to GitHub — sign in again.` |
| `GitHub token not found — try removing and re-adding this vault.` (`:503`) | `"X" isn't signed in to GitHub — sign in again.` |
| `GitHub token is invalid or expired.` (`githubApi.ts:69`) | `Meridian's access to GitHub expired — sign in again.` |
| `GitHub access denied. Check your token permissions.` (`:75`) | `Meridian no longer has write access — check the App's repository access on GitHub.` |
| `Repository not found or token lacks access.` (`:77`) | `That repository or branch isn't reachable — it may have been renamed, deleted, or removed from the App.` |

Leave `addGitHubVaultOAuth`'s "check the App has write access to it" alone — it
is already correct.

**Check after replacing:** `rg -i "your token" src/` returns nothing.
