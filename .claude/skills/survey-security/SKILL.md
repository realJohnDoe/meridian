---
name: survey-security
description: Run the security survey: ways an attacker or malicious input can compromise the OAuth worker, the iCal proxy, stored GitHub tokens, rendered content, shared vaults or the dependency tree. Use when asked to run or edit the security survey.
label: security
scope: worker src/storage src/editor src/routes/auth.callback.tsx src/settings .github/workflows package.json pnpm-lock.yaml vite.config.ts
---

Read [the shared survey conventions](../_survey/conventions.md) before starting; they apply to every run.

# Security Survey

Survey this codebase for ways an **attacker, a malicious file, or a malicious
feed** can steal the user's credentials, read or write a vault they shouldn't,
run script in the app's origin, or turn Meridian's own infrastructure against a
third party. The goal: find the **top 6 security risks**, each with a **probe**
that demonstrates it, so the fix can be verified by re-running the probe.

This file states only what's specific to this survey. A finding that is ugly but
gives an attacker nothing belongs in the health survey; one that loses data
without an attacker belongs in the data-integrity survey.

## Threat model (state it, then check it)

Meridian is a static SPA on `https://realjohndoe.github.io/meridian/` with no
server of its own, plus one Cloudflare Worker (`worker/`). Re-derive this from
the code at the start of every run rather than trusting the summary below — a
new endpoint, a new storage location or a new renderer changes it.

- **Attackers:** any website the user visits (cross-origin requests, CSRF,
  `postMessage`); the author of a vault file the user opens — a shared repo, a
  hand-edited file, an `.ics` feed (stored XSS, link injection); any non-browser
  client hitting the Worker directly (SSRF, open proxy, abuse of the OAuth
  client secret); a compromised or typo-squatted npm package; any *other* page
  on `realjohndoe.github.io` — same origin, so it shares IndexedDB, CSP `'self'`
  and the Worker's CORS allowlist (#1343). This sandbox cannot reach that host
  or the Pages API, so which sibling sites exist stays unverified.
- **Assets:** the GitHub access and refresh tokens; the user's vault contents
  (including private repos); the Worker's GitHub App client secret; the Worker
  itself as a network vantage point.

## Target invariants

Findings must be anchored to one or more of these.

1. **Credentials stay in the app.** GitHub tokens are never readable by another
   origin, never logged, never put in a URL, and never outlive sign-out or vault
   removal.
2. **The Worker is not an open proxy.** `/ical` fetches only public HTTPS feeds —
   no private, loopback, link-local or metadata address, on the first hop *or*
   any redirect hop — and `/oauth/token` only ever exchanges codes for this app.
3. **Vault content is data, never code.** No markdown, frontmatter, wikilink,
   file name or feed field can execute script or navigate to a `javascript:`/
   `data:` URL, in the editor, the view-only renderer, or any card.
4. **Access follows GitHub's.** Sharing and invites grant exactly what the user
   intended; a view-only subscription can never write.
5. **The supply chain is pinned and audited.** What ships is what was reviewed.

## Process

Three phases, in order, per [Running a survey](../_survey/conventions.md#running-a-survey):

1. **Threat plan.** For each invariant, name the code that upholds it (file and
   function) and the input that would break it.
2. **Probe pass.** Try to break each invariant against the real code. The
   cheapest probe is a failing test: `worker/` has its own Vitest
   (`pnpm --filter meridian-oauth-worker run test`), and `src/editor/urlSafety.test.ts`
   is the precedent for renderer input. Quote the failing test verbatim in the
   finding. Scratch tests are temporary; leave the tree clean.
3. **Report.** Only after both passes.

A suspicion without a probe is an "unverified" note in the coverage statement,
not a finding. Treat every security comment in the code — `icalFetch.ts`'s
header, `cors.ts`'s, the CSP plugin's in `vite.config.ts` — as a claim to break,
not a description to cite.

## Budget

- **Read closely, end to end:** `worker/src/` (all of it: `index.ts`,
  `cors.ts`, `oauthToken.ts`, `icalFetch.ts`, `env.ts`, and `worker/wrangler.*`);
  `src/storage/githubOAuth.ts`, `src/routes/auth.callback.tsx`,
  `src/storage/cache/credentials.ts`, `src/storage/githubApi.ts`;
  `src/editor/urlSafety.ts` and every caller of it, `src/editor/EntryViewOnly.tsx`,
  `src/editor/cm/markdownFormatting.ts`; `src/storage/ical/icsToEntries.ts`;
  `src/settings/VaultInviteRow.tsx` and the sharing flow it belongs to; the
  `cspPlugin` in `vite.config.ts`.
- **Grep the whole tree, and name the grep:** `dangerouslySetInnerHTML`,
  `innerHTML`, `href=`, `src=`, `window.open`, `postMessage`, `addEventListener('message'`,
  `localStorage`, `console.` near a token, `eval`/`new Function`. A zero-hit grep
  is evidence too.
- **Probe the Worker as a non-browser client.** Origin checks are spoofable
  outside a browser; for every check, ask what a `curl` with a forged `Origin`
  gets.
- **SSRF corpus:** decimal/octal/hex IPv4, IPv4-mapped IPv6, `[::1]`,
  `169.254.169.254`, a hostname resolving to a private address, userinfo
  (`https://a@b`), and a public URL that 302s to each of those.
- **Supply chain:** run `pnpm audit` in both workspaces and the registry check
  in the health survey's Budget; read `.github/workflows/` for unpinned actions,
  `pull_request_target`, and secrets reachable from forked PRs.
- Out of scope unless it creates an attack: availability of GitHub/Cloudflare,
  code style, and anything the data-integrity survey owns.

## Output structure

File the run per the [shared reporting conventions](../_survey/conventions.md#reporting),
with `security` as the survey-type label.

1. **Security verdict** (~5 sentences): can an attacker get the user's token or
   vault, and how? Name the worst invariant and the headline probe.
2. **Coverage statement:** which invariants were probed versus reasoned about,
   gate status, and anything unverified with what would settle it.
3. **Category verdicts:** one line per category below, per the
   [shared convention](../_survey/conventions.md#category-verdicts).
4. **Findings — top 6.** The [shared finding fields](../_survey/conventions.md#finding-fields),
   plus:
   - **Invariant violated** — which numbered invariant, under what conditions.
   - **Category** — one of the category tags below. These are not repo labels;
     state the tag in the body and label only `security` + the tier.
   - **Attacker** — who can trigger it, and what they need (a link click, a
     shared repo, nothing).
   - **Impact** — 1–10, where 10 = token theft or arbitrary vault write by an
     unauthenticated attacker; 5 = needs the user to open attacker content and
     leaks something non-credential; 1 = defence-in-depth gap with no path.
   - **Probe** — the input, the request or test, observed versus expected.

**Fails silently here** is the default: a security fix that is wrong still
passes every test that doesn't attack it. A denylist that misses one encoding, a
CORS check that only a browser honours, a sanitizer applied at one of three
render sites. Example hazard note: "Sonnet 5 if every render site is listed in
the task; else Opus 5." Reserve plan mode for a change of trust model (e.g.
moving token storage out of IndexedDB).

## Categories — ranked by priority

### 1. Credentials (`token-storage`)
Where GitHub tokens live, who can read them, when they're cleared, and whether
the refresh path can be replayed or leaks them into logs, URLs or errors.

### 2. OAuth worker (`oauth`)
Code exchange, `state`/PKCE, the client secret, CORS on `/oauth/token`, and
whether the endpoint does anything for a request that isn't this app's.

### 3. iCal fetch proxy (`ssrf`)
`validateFeedUrl` and the manual redirect loop: address forms, DNS, ports,
response size and type, and what the proxy forwards back.

### 4. Rendering (`xss`)
Every path from vault or feed text to the DOM — markdown links, wikilinks,
frontmatter URLs, `.ics` fields, file names — and the CSP as the backstop.

### 5. Sharing & invites (`sharing`)
Invite links, collaborator flows, subscriptions and view-only vaults: can
anything grant or write more than the user chose?

### 6. Supply chain (`supply-chain`)
Dependencies with known advisories, install scripts, unpinned CI actions,
secrets exposure in workflows, and the Worker's deploy path.

---

**Scoring guidance:** unauthenticated beats authenticated, credential beats
content, silent beats visible. A probe that works with only a link click
outranks one that needs the victim to open a malicious repo.
