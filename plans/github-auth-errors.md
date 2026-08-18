# "Could not reconnect GitHub vault — check your token": investigation and PR plan

Investigation of two field reports (2026-08-18):

- **Report A** (~1.5 months ago): the toast appeared; removing and re-adding the
  vault fixed it; GitHub did *not* ask for authorization again.
- **Report B** (yesterday, iPhone/LTE): the same toast appeared; nothing was
  re-added; sync worked again by itself.

**Status: investigation + plan. Nothing here is implemented yet.** Every claim
marked _read_ comes from the code with the line cited.

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
| Worker/Cloudflare hiccup *during the refresh POST* | — | silent, then 401 → **denied** | transient; never blame the credential |

Both field reports sit in this table:

- **Report B** is the mobile row(s). At launch on LTE, one dropped request →
  `'denied'` → the vault is never mounted → the session is dead for that vault
  → next launch works. The screenshot is a phone on LTE, mid-launch. It matches
  exactly, and no credential was ever involved.
- **Report A** is the "refresh token dead" row. GitHub App user tokens last 8h
  and the refresh token **rotates on every use**; the app then writes the new
  pair as *three separate Dexie puts* (`src/storage/githubOAuth.ts:143-145`).
  A tab killed between put #1 and put #2 — routine on iOS — stores a new access
  token beside a *dead* refresh token. From then on every refresh fails
  silently (`console.warn`, `githubOAuth.ts:147`), the stale token 401s, and the
  vault is permanently "check your token" until re-added. Re-adding re-runs
  sign-in, which GitHub approves without a prompt because the App is still
  authorized — precisely what was observed.

### Two further confirmed defects found on the way

- **A denied vault is unreachable by every retry path.** `autoSyncTick`,
  the `online` handler and `visibilitychange` (`src/routes/__root.tsx:156-182`)
  all iterate `getMountedBackends()`. A vault that failed to mount is not in it.
- **"Sync now" on such a vault says the wrong thing entirely.** `syncToBackend`
  finds no backend, so it reports *"No writable vault connected. Add a local
  folder first."* (`src/storage/sync.ts:996`) for a GitHub vault.

---

## Why this is hard to fix and harder to test (the architectural part)

Six structural causes. The PRs below are organized around removing them, not
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

**E. Credential rotation is neither atomic nor single-flight.** Three sequential
`meta.put`s, no transaction (`cache/credentials.ts:28-77`), and no in-flight
dedupe around a **single-use** refresh token.

**F. The Worker flattens every failure into one message.** `exchangeForTokens`
throws `OAuthCallbackError('Token exchange failed.')` (`githubOAuth.ts:68`) both
for "GitHub rejected this refresh token" (definitive — re-auth needed) and for
"the Worker 502'd" (transient). The client cannot tell them apart, so it cannot
react differently.

---

## How the model recommendation was made

**Opus 5** where the PR decides *semantics with a silent, durable failure mode*
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
that was not honestly possible — PR 7 — the PR is kept small and left with Opus
rather than being papered over with a spec that reads more certain than it is.

The same instinct also drove the PR boundaries: **PRs are split along the
judgment/mechanical seam**, not along file boundaries. PR 3 and PR 4 are one
feature cut into "the state" and "the UI that renders it"; PR 6 and PR 7 are one
credential fix cut into "write it atomically" and "decide when it's dead".

## The PRs

**PR 1 (`classifyFailure` + table-driven test) is implemented — see
`src/storage/failureKind.ts`. PR 2 (drop the mount-time probe for network
backends) is implemented — see `mountVaultRef` in `src/storage/vaultRegistry.ts`.**

| # | Title | Model | Est. | Blocked by |
|---|---|---|---|---|
| 3 | `needsAttention` replaces `needsReconnect` (state only) | Sonnet 5 | 0.5d | — |
| 4 | Attention rows + actions in `SyncButton`/`VaultSettings` | Sonnet 5 | 0.5d | 3 |
| 5 | Re-authenticate an existing vault | Sonnet 5 | 1d | 3 |
| 7 | Single-flight refresh + typed refresh failures | **Opus 5** | 1d | — |
| 8 | Auth events in the sync journal | Sonnet 5 | 0.25d | — |
| 9 | Vocabulary pass | **Haiku 4.5** | 0.25d | 4 |

Total ≈ 3.5d remaining, including per-PR tests and review.

### Ordering

```
PR3 ──┬─► PR4 ──► PR9
      └─► PR5
PR8
PR7                     (independent of everything above)
```

**PR 7 finishes fixing Report A** (PR 6's atomic `credentialsSave` already
shipped). PR 5 makes it recoverable in one tap. (Report B was fixed by PR 2.)

---

### PR 3 — `needsAttention` replaces `needsReconnect` (state only, no UI)

**Model: Sonnet 5** · 0.5d

In `store.ts`, replace `needsReconnect: boolean` with:

```ts
export type AttentionKind = 'fs-permission' | 'reauth' | 'access' | 'config'
export interface VaultAttention { kind: AttentionKind; message: string }
// on VaultSyncStatus:
needsAttention: VaultAttention | null   // default null
```

Who writes it — the complete list, no other writers:

| Site | Condition | Value |
|---|---|---|
| `mountVaultRef` | local `'prompt'`, non-interactive | `{ kind: 'fs-permission', … }` |
| `mountVaultRef` | mounted successfully | `null` |
| `runSync` catch | `classifyFailure` → `auth`, **and** the forced-refresh retry already failed | `{ kind: 'reauth', … }` |
| `runSync` catch | → `access` | `{ kind: 'access', … }` |
| `runSync` catch | → `config` | `{ kind: 'config', … }` |
| `runSync` success | always | `null` |
| `runSync` catch | → `transient` | **unchanged** — sets `offline`, never `needsAttention` |

`severityOf` in `SyncButton.tsx:21` swaps `status.needsReconnect` for
`status.needsAttention !== null`; the existing "Permission needed — reconnect"
row keeps working for `kind === 'fs-permission'`. **No other UI change in this
PR** — that is PR 4.

Also in this PR, because it is the same one-line class of bug: `syncToBackend`
with a `vaultId` that resolves to no mounted backend must not say *"Add a local
folder first."* (`sync.ts:996`). Split the message — the no-argument case keeps
today's text, the named-vault case says the vault isn't connected and names it.

**Tests:** assertions move from `notifyFns.notify` strings to the store field —
that is the durable win here. Update `vaultRegistry.test.ts:694` and the
`sync.test.ts` auth cases (`:774`, `:793`, `:811`, `:1468`) to assert
`syncByVault.get(id).needsAttention`.

**Glossary:** `GLOSSARY.md` §"Vaults and backends" gets a `needsAttention` entry
(one sentence + the `store.ts` pointer), and `needsReconnect` goes in the retired
-names table. `src/glossary.test.ts` enforces this — a rename that skips it fails
the suite, which is the intended tripwire.

---

### PR 4 — Attention rows and their actions

**Model: Sonnet 5** · 0.5d · depends on PR 3

Render `needsAttention` as one row per kind in `SyncButton`'s popover, and mirror
the two actionable ones into `VaultSettings`' GitHub section. The copy deck —
implement verbatim, no rewording:

| Kind | Row text | Action |
|---|---|---|
| `fs-permission` | Permission needed — reconnect | `reconnectVault(id)` *(existing)* |
| `reauth` | Signed out of GitHub — sign in again | `startGitHubSignIn({ reconnectVaultId: id })` *(PR 5; until then, disabled)* |
| `access` | Meridian no longer has access to `{owner}/{repo}` | link to `GITHUB_APP_INSTALL_URL` |
| `config` | `{owner}/{repo}` (`{branch}`) isn't reachable — it may have been renamed or deleted | opens this vault's Settings |

Row styling follows the existing `needsReconnect` row (`SyncButton.tsx:67-76`):
`text-2xs`, `AlertCircle`, `text-note`. The red icon now persists after the toast
is gone, which is the actual user-visible fix.

**Ship PR 4 before PR 5 if you want** — the `reauth` row renders disabled with
the same text, and PR 5 just wires its `onClick`.

---

### PR 5 — Re-authenticate an existing vault

**Model: Sonnet 5** · 1d · depends on PR 3

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

### PR 7 — Single-flight refresh + typed refresh failures

**Model: Opus 5** · 1d · independent

**The one PR left with Opus, deliberately.** Three coupled decisions, each with a
failure mode that is silent, durable, and invisible to CI — a wrong call here
brings back exactly the bug this plan is closing.

1. **Single-flight.** A per-vault `Map<string, Promise<string | null>>` in
   `githubOAuth.ts`, so two callers can never spend the same one-use refresh
   token. The judgment: a `force: true` call must **not** join an in-flight
   *non-forced* one whose result may be the stale token — but it must also not
   start a second refresh on top of one that is already rotating. Getting the
   join rule wrong burns the refresh token, which is unrecoverable.
2. **`invalid_grant` vs. everything else.** Have the Worker pass GitHub's `error`
   field through, and split `exchangeForTokens` into "GitHub rejected the refresh
   token" (`invalid_grant` / `bad_refresh_token` → definitive: set
   `needsAttention: 'reauth'`, stop retrying) versus network/5xx/non-JSON (→
   `TransientSyncError`: keep the existing token, retry later, and say nothing
   about credentials). The judgment is which GitHub error codes are genuinely
   terminal — treating a recoverable one as terminal nags the user to re-auth for
   nothing; the reverse hides a dead credential behind an infinite retry.
3. **Clock skew.** `ensureFreshAccessToken` trusts the local clock
   (`githubOAuth.ts:137-138`). A phone hours out of sync either refreshes constantly
   (harmless) or skips a refresh it needed (a 401 the mount path used to
   mishandle). Decide whether the server's 401 becomes the only authority on
   expiry, or the local expiry stays a hint.

Worker side: `worker/src/oauthToken.ts` already forwards GitHub's JSON body and
status verbatim, so (2) may need no Worker change at all — verify before
touching it, and if it does, `worker/src/oauthToken.test.ts` is the seam.

---

### PR 8 — Auth events in the sync journal

**Model: Sonnet 5** · 0.25d

`syncJournal.ts` is already the bounded in-memory flight recorder with a "Copy
details" surface, built for exactly this: a failure on a phone with no devtools
attached. It currently records nothing about auth.

Add three `SyncEventKind`s — `auth-refresh`, `auth-refreshed`, `auth-failed` —
and record `{ kind: FailureKind, status }` from `classifyFailure`
(`src/storage/failureKind.ts`) plus the vault
id. **Never a token, never a token prefix, never a refresh token length** — the
file's own doc comment sets that bar ("No file content, ever") and it applies
doubly here.

This is what turns the next report from a screenshot into evidence.

---

### PR 9 — Vocabulary pass

**Model: Haiku 4.5** · 0.25d · depends on PR 4

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
