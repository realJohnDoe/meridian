# "Could not reconnect GitHub vault — check your token": investigation and PR plan

Investigation of two field reports (2026-08-18):

- **Report A** (~1.5 months ago): the toast appeared; removing and re-adding the
  vault fixed it; GitHub did *not* ask for authorization again.
- **Report B** (yesterday, iPhone/LTE): the same toast appeared; nothing was
  re-added; sync worked again by itself.

**Status: PR 6 and PR 7 have shipped — hence the gap in the numbering below.
Everything still listed is outstanding.** Every claim marked _read_ comes from
the code with the line cited.

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
| 1 | `classifyFailure` + table-driven test | Sonnet 5 | 0.5d | — |
| 2 | Drop the mount-time probe for network backends | Sonnet 5 | 0.5d | 1 |
| 3 | `needsAttention` replaces `needsReconnect` (state only) | Sonnet 5 | 0.5d | 1 |
| 4 | Attention rows + actions in `SyncButton`/`VaultSettings` | Sonnet 5 | 0.5d | 3 |
| 5 | Re-authenticate an existing vault | Sonnet 5 | 1d | 3 |
| 8 | Auth events in the sync journal | Sonnet 5 | 0.25d | 1 |
| 9 | Vocabulary pass | **Haiku 4.5** | 0.25d | 4 |

**Six of seven remaining PRs are Sonnet; the seventh is Haiku.** Total ≈ 3.5d
including per-PR tests and review.

### Ordering

```
PR1 ──┬─► PR2
      ├─► PR3 ──┬─► PR4 ──► PR9
      │         └─► PR5
      └─► PR8
```

**PR 1 + PR 2 alone fix Report B** and retire the misleading message. Report A
is already fixed — PR 6's atomic `credentialsSave` and PR 7's single-flight,
typed refresh failures have both shipped. PR 5 makes either recoverable in one
tap.

---

### PR 1 — `classifyFailure` + table-driven test

**Model: Sonnet 5** · 0.5d · new file + two adapters

New `src/storage/failureKind.ts`. One **pure** function, no octokit import, no
I/O:

```ts
export type FailureKind =
  | 'transient'   // never reached GitHub, or GitHub is unwell — retry, stay quiet
  | 'auth'        // credentials rejected — refresh, then ask for sign-in
  | 'access'      // the App/user has no access to this repo any more
  | 'config'      // repo or branch renamed/deleted — the vault's settings are wrong
  | 'conflict'    // 409/422 — unchanged, still handled by ConflictError

export interface Failure { kind: FailureKind; status?: number; message: string }

export function classifyFailure(e: unknown): Failure
```

The decision table, in order. **Row 1 is the fix** — everything below it only
matters once an error has actually reached GitHub:

| # | Condition | Kind |
|---|---|---|
| 1 | no numeric `status` on the error | `transient` |
| 2 | `status === 401` | `auth` |
| 3 | `status === 403` and (`x-ratelimit-remaining === '0'` or `retry-after` present or `/rate limit\|secondary\|abuse/i` on the message) | `transient` |
| 4 | `status === 403` | `access` |
| 5 | `status === 404` | `config` |
| 6 | `status === 408 \|\| 429 \|\| status >= 500` | `transient` |
| 7 | `status === 409 \|\| 422` | `conflict` |
| 8 | anything else | `transient` |

> **Rule 1 is load-bearing and must be stated in the file's doc comment:** a
> real auth failure always carries a response. An error that never reached
> GitHub cannot be about credentials. This is what retires the message-regex
> whack-a-mole — every iOS wording, `AbortError`, DNS and captive portals are
> covered by the *absence* of a status rather than by matching their prose.

Adapters, so no other call site changes shape:

- `mapGitHubError` keeps its `path` parameter and its `ConflictError`
  construction, but chooses the error class from `classifyFailure(e).kind`.
- `isTransientSyncError` keeps the `navigator.onLine === false` check and the
  `TransientSyncError` instance check, then delegates to
  `classifyFailure(e).kind === 'transient'`. **Keep the existing regex as a
  fallback** — `sync.test.ts` constructs bare `TransientSyncError('Failed to
  fetch')` values (`sync.test.ts:429`) and a status-less real error must stay
  transient anyway under rule 1.

**Tests** — `src/storage/__tests__/failureKind.test.ts`, one `it.each` over a
literal table with **one row per row of the failure table above**, including
verbatim:

```
'Failed to fetch' · 'Load failed' · 'The network connection was lost.'
'The Internet connection appears to be offline.' · 'NetworkError when attempting to fetch resource.'
DOMException('…', 'AbortError') · a bare TypeError · { status: 502 } · { status: 429 }
{ status: 403, headers: { 'retry-after': '60' } } · { status: 403 } (no headers)
```

**Hazard to name in review:** `isRateLimitError` (`githubApi.ts:54`) reads
`e.response.headers`; octokit's `RequestError` also exposes `e.status` at the top
level. Row 3 must read headers through the same accessor the existing helper
uses, not invent a second one — move `isRateLimitError` into the new file and
have `githubApi.ts` import it, rather than leaving two copies.

**Not in scope:** changing any user-facing string (PR 9) or any caller's
behaviour (PR 2, PR 3). This PR should be behaviour-preserving except for the
newly-transient rows.

---

### PR 2 — Drop the mount-time probe for network backends

**Model: Sonnet 5** · 0.5d · depends on PR 1

The architectural point: `ensurePermission` is a *local-filesystem* concern that
was generalized to backends which have no permissions, only failures. Remote
backends get their probe for free — the first sync is one.

**The decision table for `mountVaultRef(ref, interactive, prePainted)`** —
implement exactly this; there is nothing left to decide:

| Vault kind | `interactive` | Behaviour |
|---|---|---|
| `local` | either | unchanged — `ensurePermission` still gates the mount |
| `github` / `ical` | `false` (restore) | **skip the probe**; mount, `setVaultSync(needsAttention: null)`, `loadVaultContent` |
| `github` / `ical` | `true` (add-vault, reconnect click) | unchanged — the probe stays; a human is waiting on the answer |
| any | — | `buildBackend` returning `null` still yields `'no-credential'` |

Leave `ensurePermission` on the `StorageBackend` interface and leave both
implementations alone — `addGitHubVaultOAuth` and `addIcalVault` still call it,
and "does the App have write access to this repo?" is a genuine pre-flight there.

Then delete the `'denied' && ref.kind === 'github'` branch at
`vaultRegistry.ts:465` — after this change the restore path cannot produce it.

**Tests to update** (they encode the old behaviour and will fail loudly, which is
the point): `vaultRegistry.test.ts:372` and `:412`. The github case flips from
"does not mount, notifies" to "mounts, syncs, no notification". Add one new test:
*a GitHub vault whose `ensurePermission` would answer `'denied'` is still mounted
on restore, and `syncOnActivate` is called for it.*

**Payoffs to state in the PR description:** one code path instead of two; a
failed vault stays mounted, so `online`, `visibilitychange` and `autoSyncTick`
retry it automatically (Report B self-heals in seconds instead of at next
launch); and two fewer GitHub round trips per vault per cold start, off the
launch critical path described in `restoreVaultsInner`'s phase comments.

**Hazard:** phase 2 of `restoreVaultsInner` is `await`ed per vault in a loop. It
must stay that way — do not parallelize as a drive-by; the serial walk is
deliberate (see `autoSyncTick`'s doc comment on secondary rate limits).

---

### PR 3 — `needsAttention` replaces `needsReconnect` (state only, no UI)

**Model: Sonnet 5** · 0.5d · depends on PR 1

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

### PR 8 — Auth events in the sync journal

**Model: Sonnet 5** · 0.25d · depends on PR 1

`syncJournal.ts` is already the bounded in-memory flight recorder with a "Copy
details" surface, built for exactly this: a failure on a phone with no devtools
attached. It currently records nothing about auth.

Add three `SyncEventKind`s — `auth-refresh`, `auth-refreshed`, `auth-failed` —
and record `{ kind: FailureKind, status }` from PR 1's classifier plus the vault
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
