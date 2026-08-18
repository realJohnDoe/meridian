# "Could not reconnect GitHub vault — check your token": investigation and plan

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

Six structural causes. The plan below is organized around removing them, not
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

## Plan

Six PRs, each shippable and independently testable. 1–3 fix the misleading
error; 4 adds re-authentication; 5 removes the cause of Report A; 6 is wording.

### PR 1 — One classifier, status-shaped, with a table-driven test

New `src/storage/failureKind.ts`, a **pure function** `classifyFailure(e: unknown):
Failure`:

```ts
export type FailureKind =
  | 'transient'   // never reached GitHub, or GitHub is unwell — retry, stay quiet
  | 'auth'        // credentials rejected — try a refresh, then ask for sign-in
  | 'access'      // the App/user has no access to this repo any more
  | 'config'      // repo or branch renamed/deleted — the vault's settings are wrong
  | 'conflict'    // unchanged: 409/422
export interface Failure { kind: FailureKind; status?: number; message: string }
```

The load-bearing rule, which is the actual fix for most of the table:

> **No HTTP status ⇒ `transient`.** A real auth failure always carries a
> response. An error that never reached GitHub cannot be about credentials.

That inversion retires the message-regex whack-a-mole (all the iOS wordings,
`AbortError`, DNS, captive portals) in one move. Then: 401 → `auth`; 403 with
rate-limit headers or a rate-limit/abuse message → `transient`; other 403 →
`access`; 404 → `config`; 408/429/5xx → `transient`; 409/422 → `conflict`.

`mapGitHubError` and `isTransientSyncError` become thin adapters over it, so the
existing `AuthSyncError`/`TransientSyncError` call sites keep working.

*Testability:* one table test enumerating every row of the failure table above,
including the verbatim iOS Safari strings and a status-less `TypeError`. This is
the artifact that stops the class of bug from coming back silently.

### PR 2 — Delete the mount-time probe for network backends

In `mountVaultRef`, stop calling `ensurePermission` for remote backends on the
restore path; mount optimistically and let the first `syncOnActivate` cycle *be*
the probe. It already has everything the mount path lacks: forced refresh and
retry on 401, transient/actionable split, backoff, persistent per-vault error,
deduped notification.

Keep `ensurePermission(interactive: true)` in `addGitHubVaultOAuth` — there a
human is waiting and "does the App have write access to this repo?" is a genuine
pre-flight check. Keep the local-FS path untouched: an FS handle really does need
a permission gate before use. The honest framing is that `ensurePermission` is a
*local-filesystem* concern that was generalized to backends which have no
permissions, only failures.

Payoffs: one code path instead of two; the restore path can no longer produce a
bogus credential accusation; a failed vault stays mounted, so `online`,
`visibilitychange` and `autoSyncTick` retry it automatically (Report B
self-heals in seconds instead of at next launch); and −2 GitHub round trips per
vault per cold start, off the launch path.

### PR 3 — A vault needing attention is *state*, not a toast

Replace `needsReconnect: boolean` in `VaultSyncStatus` with a discriminated field:

```ts
needsAttention: null | { kind: 'fs-permission' | 'reauth' | 'access' | 'config'; message: string }
```

`runSync` sets it from PR 1's `Failure` — `auth` only after a forced refresh has
already failed. `SyncButton` renders one row per kind with the matching action
(Reconnect / Sign in again / Open GitHub App settings / Fix branch in Settings),
and the red icon persists after the toast is gone.

Also fix `syncToBackend`'s "Add a local folder first." for the named-vault case.

*Testability:* assertions move from toast strings to a store field. Add to
`GLOSSARY.md` under "Vaults and backends" (and list `needsReconnect` as retired).

### PR 4 — Re-authenticate an existing vault, without re-adding it

- `startGitHubSignIn({ reconnectVaultId })` stashes the vault id in
  `sessionStorage` beside the verifier and state.
- `auth/callback` branches on it: verify the vault still exists and that
  `fetchInstalledRepos` still lists its `owner/repo`, then call a new
  `reauthGitHubVault(vaultId, tokens)` — save credentials, (re)mount, clear
  `needsAttention`, sync. No repo picker, no new vault.
- If the repo is gone from the installation, say so by name and link the App's
  install/configure page instead of blaming the credential.
- Entry points: the `needsAttention` row in `SyncButton`, and a "Sign in with
  GitHub again" button in `VaultSettings`' GitHub section.

The point beyond convenience: the vault id is unchanged, so Dexie rows,
favourites, prefs, URLs **and unpushed local edits all survive** — unlike the
remove-and-re-add workaround, which deletes them.

### PR 5 — Make token rotation survivable (the cause of Report A)

- **Atomic:** one `credentialsSave(vaultId, { accessToken, refreshToken, expiresAt })`
  writing all three keys in a single Dexie transaction (`meta.bulkPut`). No
  interruption can leave a new access token beside a dead refresh token.
- **Single-flight:** a per-vault in-flight promise map in `githubOAuth.ts`, so two
  callers can never spend the same one-use refresh token.
- **Typed refresh failure:** have the Worker pass GitHub's `error` through, and
  split `exchangeForTokens` into "GitHub rejected the refresh token"
  (`invalid_grant`/`bad_refresh_token` → definitive, set `needsAttention:
  'reauth'`, stop retrying) versus network/5xx/non-JSON (→ `TransientSyncError`,
  keep the existing token, retry later, say nothing about credentials).
- **Journal it:** add `auth-refresh` / `auth-failed` events to `syncJournal.ts`
  (kind + status only, never a token). It is already the flight recorder with a
  "Copy details" surface — this is the difference between diagnosing the next
  report from evidence and guessing from a screenshot.

### PR 6 — Vocabulary

No user-facing string says "token" any more. Each names something the user can
act on:

| Now | Proposed |
|---|---|
| `Could not reconnect GitHub vault "X" — check your token.` | *(gone — PR 2/3 replace it with a persistent row)* |
| `GitHub token is invalid or expired.` | `Meridian's access to GitHub expired — sign in again.` |
| `GitHub access denied. Check your token permissions.` | `Meridian no longer has write access to X — check the App's repository access on GitHub.` |
| `Repository not found or token lacks access.` | `X/Y (branch Z) isn't reachable — it may have been renamed, deleted, or removed from the App.` |
| `Vault "X" is missing its GitHub token — remove and re-add it.` | `Vault "X" isn't signed in to GitHub — sign in again.` |

## Sequencing and cost

PR 1 is a prerequisite for 2 and 3; 4 and 5 are independent of each other and of
1–3. Rough sizes: PR 1 small (one file plus a table test), PR 2 small (a deletion
plus test updates), PR 3 medium (store field + UI rows), PR 4 medium (the sign-in
round trip and its callback branch), PR 5 small-to-medium, PR 6 trivial.

Shipping only PR 1 + PR 2 already fixes Report B and removes the misleading
message. PR 5 alone removes the cause of Report A; PR 4 makes it recoverable in
one tap when it happens for any other reason.
