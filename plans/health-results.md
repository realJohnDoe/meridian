# Codebase Health Survey — results (run 2026-09-06)

Run of [`plans/surveys/health.md`](./surveys/health.md). Conventions:
[`plans/surveys/README.md`](./surveys/README.md).

> The survey file itself was updated in a separate commit on this branch —
> three process learnings from this run (a bundle-composition budget item, a
> "verify the doc, not just the code" note, and a caveat about squashed
> history defeating the churn measurement). See that diff for the details.

---

## 1. Health verdict

This is a **healthy, unusually well-maintained codebase** — the kind where the
interesting findings are in the seams rather than the code. Type discipline is
close to perfect (zero hand-written `any`, zero `@ts-ignore`, four non-null
assertions, every `eslint-disable` carrying a written justification), the
module boundaries documented in `CLAUDE.md` are genuinely machine-enforced and
genuinely hold (I searched for cross-module deep imports and found **none**),
and all eight quality gates pass in both workspaces. The weakest areas are
**`src/settings/`** (55.98% statements — the add-vault wizard, the only path to
connecting a GitHub, local or iCal vault, has effectively no tests).

The single biggest structural theme is **not** overengineering — I looked hard
for it and did not find it. Every port and abstraction I tested has a real
second consumer or a documented cycle-breaking reason (`persistencePort`,
`autoSaveFlushPort`, `ViewChrome`, the four storage backends), and the
meta-infrastructure is proportionate to the product it guards (1,256 lines of
toolchain config against 39,056 lines of non-test source, ~3%). The theme is
instead **intent that the toolchain doesn't hold up**: a lint tier evaluated, written up,
and then not switched on (#3); coverage floors set honestly and then left to
drift 10–26 points below reality (#4); a `shadcn` alias pointing at a module
that does not exist (#7); and a `CLAUDE.md` paragraph still warning about a gap
that has since been closed (#8). Each is small on its own; together they are one
pattern — decisions recorded but not wired to anything that re-checks them.

---

## 2. Coverage statement

### Environment notes (per the shared README)

- Generated types were produced before linting (`pnpm install`, `pnpm run build`
  for `src/routeTree.gen.ts`, and the worker's `pretypecheck` hook for
  `worker-configuration.d.ts`). No spurious type-aware-lint flood was observed.
- **Only the example (Tutorial) backend is reachable** in this environment. The
  local-FS and GitHub backends were traced statically and through their unit
  tests only.
- **No browser measurement pass was run.** `health.md` does not require one
  (unlike `performance.md` / `health-ui.md` / `product-niche.md`), so this is by
  the survey's own scope, not budget exhaustion. The one exception: I ran
  `test:layout`, which drives a real Chromium, as a gate.
- **The large-vault fixture was not used** — no finding in this run needed it.

### Examined closely

- **Entry points:** `src/main.tsx`, `src/routes/__root.tsx`, `src/debug/main.tsx`,
  `worker/src/index.ts`, `index.html`, `debug.html`.
- **Most-imported modules (measured, not guessed** — `grep` over all `from '@/…'`
  specifiers): `@/types` (164), `@/model` (97), `@/fileIO` (85), `@/store` (74),
  `@/lib/cn` (69 by symbol), `@/hooks` (46), `@/vaultRef` (39).
- **The 15 largest non-generated, non-test sources by line count** — the ranking
  the Budget asks be stated: `model/expansion.ts` (1209), `model/storeOps.ts`
  (1162), `storage/sync.ts` (982), `debug/NodeInheritanceDebugger.tsx` (836),
  `calendar/agendaSections.ts` (782), `storage/vaultRegistry.ts` (775),
  `store.ts` (726), `storage/ical/rruleToRepeat.ts` (641), `calendar/WeekPane.tsx`
  (517), `scripts/perf/stress.mjs` (510), `settings/VaultSettings.tsx` (482),
  `storage/githubBackend.ts` (470), `model/fieldRegistry.ts` (454),
  `components/ui/sidebar.tsx` (453), `editor/save.ts` (448). Of these I read
  `expansion.ts`, `storeOps.ts`, `sync.ts`, `agendaSections.ts`,
  `vaultRegistry.ts`, `store.ts` and `VaultSettings.tsx` structurally (section
  banners + every exported signature) and the rest in excerpt.
- **Full toolchain:** both `package.json`s, `eslint.config.js` (all 700 lines),
  `vitest.config.ts`, `worker/vitest.config.ts`, `vite.config.ts`,
  `.dependency-cruiser.mjs`, `knip.json`, `components.json`, all five root
  `tsconfig*.json` plus `worker/tsconfig.json`, `.npmrc`, `pnpm-workspace.yaml`,
  `worker/wrangler.toml`, and all four CI workflows.
- **Security surface end to end:** `worker/src/icalFetch.ts` (SSRF guard, read in
  full), `worker/src/oauthToken.ts`, `worker/src/cors.ts`,
  `storage/githubOAuth.ts`, `storage/cache/credentials.ts`, `editor/urlSafety.ts`,
  the CSP plugin, and every `href=` / `window.open` / `innerHTML` site in `src/`.
- **2–3 representative files from every feature directory**, plus the whole of
  `src/` root (26 files).

### Sampled

`calendar/` (read 8 of 60 files closely, skimmed the rest), `model/` internals
beyond the two largest, `storage/ical/` (read `icsParse`/`rruleToRepeat`
partially), `components/ui/` (inventoried and usage-checked all 22, read 2),
`scripts/` (read `layout-smoke.mjs` in full, `perf/` skimmed), `blog/`, `assets/`,
`public/`.

### Skipped, with reason

- `src/routeTree.gen.ts` — generated, and `eslint.config.js` ignores it.
- `worker/worker-configuration.d.ts` — generated by `wrangler types` (13k lines).
- `pnpm-lock.yaml` — machine-managed; audited via `pnpm audit` instead.
- `src/index.css` (50KB) — read only its theme-token structure; a styling deep
  dive belongs to `health-ui.md`.
- `src/debug/NodeInheritanceDebugger.tsx` (836 lines, 0% coverage) — verified
  **dev-only and absent from the production build** (`vite.config.ts`'s
  `rollupOptions.input` is `index.html` alone; the debug page is served by a
  `configureServer` hook only) and then deliberately not reviewed further.

### Gate × workspace matrix

Every gate was run once, in this environment, on the unmodified tree.

| Gate | root (`meridian`) | `worker/` (`meridian-oauth-worker`) | Result |
|---|---|---|---|
| `build` / typecheck | ✅ `vite build` + `tsc -b` + `tsc -p tsconfig.test.json` | ✅ **fans out** — `pnpm --filter … run typecheck` | **PASS** both |
| `lint` (ESLint) | ✅ `eslint src` | ✅ `eslint worker/src`, own type-aware block | **PASS** both |
| `lint:deps` (dep-cruiser) | ✅ `depcruise src` — 457 modules, 1763 deps, 0 violations | ❌ **not covered** (`src` only) | **PASS** (root) |
| `test` | ✅ 164 files / 3581 tests | ✅ **fans out** — 3 files / 41 tests | **PASS** both |
| `test:coverage` | ✅ 79.82 / 73.97 / 73.87 / 82.27 vs floor 68/62/59/70 | ✅ **fans out**, and worker has **its own** `thresholds` block: measured 90.49 / 77.95 / 85.71 / 95.88 vs floor 87/74/82/92 | **PASS** both |
| `knip` | ✅ workspace `"."` | ✅ workspace `"worker"` | **PASS** both |
| `audit` | ✅ run at `--audit-level low` (CI gates at `high`) | ✅ run separately from `worker/` | **PASS** both, 0 advisories |
| `test:layout` | ✅ real Chromium over built `dist/` | n/a (no UI) | **PASS** |

Two observations the matrix makes visible, neither promoted to a finding:

- **`lint:deps` is the one gate that stops at the root workspace.** `depcruise src`
  never looks at `worker/src`. With four source files and a linear
  `index → {oauthToken, icalFetch} → cors` graph, the cycle risk is
  approximately nil, so this is recorded rather than filed.
- **The survey's hypothesised "coverage measured in one package only" gap does
  not exist here.** Both `test` and `test:coverage` fan out, and the worker
  carries its own threshold block. This is the good case; noting it so a future
  run doesn't re-derive it.

### Fraction of the codebase this report is based on

Roughly **45–50%** of non-generated source read closely or structurally, and
**100%** of the toolchain, CI, and security-relevant surface. All 39,056
non-test source lines were at least enumerated by directory and line count.

### Unverified

- **`storage/sync.ts`'s collision-resolution paths** (`resolveCollision`,
  `writeConflictCopy`, `settleMove`/`releaseMove`/`abandonMove`). Read for shape,
  not reasoned through for correctness. This is the highest-consequence logic in
  the repo (a lost write) and the place I'd look next; `data-integrity.md` is the
  survey that owns it.
- **`model/inheritance.ts`** — 66.66/53.94/78.57/74.57, the lowest-covered file
  in `model/` and the only one with no per-file floor. Flagged as unverified: I
  did not determine whether the uncovered branches are reachable.
- **The GitHub and local-FS backends under real I/O** — unreachable here (see
  environment notes).

---

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Architecture & Domain Separation | **clean** |
| 2 | Simplicity & Overengineering | **clean** |
| 3 | Directory & File Layout | **clean** |
| 4 | Security | **findings: #5** |
| 5 | Testing & Error Handling | **findings: #4, #9** |
| 6 | Code Health & DRY | **clean** |
| 7 | Toolchain & Developer Feedback Loops | **findings: #3, #4, #7, #8** |
| 8 | Dependencies & Library Fit | **findings: #7** (plus three keep-verdicts, below) |
| 9 | Styling & UX | **partially assessed** |
| 10 | Performance | **clean** |

**Why category 2 is clean, not unscanned.** I held every abstraction to the
"does a second real caller exist today?" test by grep, not by reading names:
`persistencePort` (2 registrants — `storage/index.ts` and `test-utils`, and it
exists because `components/` may not import `@/storage` at all), `autoSaveFlushPort`
(exists to control listener *ordering*, documented, and the alternative genuinely
doesn't work), `StorageBackend` (4 implementations: local, GitHub, example, iCal),
`ViewChrome` (5 adapters), `CalendarFetcher`/`GitHubTokenExchanger` (test seams
with real doubles). I also measured the meta-infrastructure against the product
(3% of source) to test the "process outpacing the code" hypothesis, and it does
not hold. Nothing here is speculative generality.

**Why category 6 is clean.** Zero hand-written `any` (all 21 grep hits are
`routeTree.gen.ts` or the word "any" in prose), zero `@ts-ignore`/`@ts-expect-error`,
4 non-null assertions, every `eslint-disable` justified inline. I checked for dead
files in `components/ui/` and found **none** — my first quote-sensitive grep
suggested six unused components, but shadcn's generated files use double quotes;
re-running quote-agnostically showed every one has at least one importer, and
`knip` was right to stay green. The one duplication I found is
`expansion.ts`'s `sameCalendarDay` re-implementing date-fns's `isSameDay`, which
is a single function and belongs in a lint rule, not this report.

**Why category 9 is *partially assessed*.** `jsx-a11y/recommended` is enabled and
green, and the config teaches it about `Badge`/`Card`/`Checkbox`/`Input`
indirection, so the mechanical half is covered. I verified no shadcn component is
shadowed by a custom re-implementation (`components/primitives/button.tsx` and
`separator.tsx` sit *alongside* the registry versions and compose them, rather
than replacing them). What I did **not** do is any visual or interaction pass —
no browser, no theme sweep, no keyboard walkthrough. That belongs to
`health-ui.md`, and this verdict should not be read as covering it.

---

## 4. Findings

### Summary

| Rank | # | Title | Category | Impact | Breadth | Recommended model | Score |
|---|---|---|---|---|---|---|---|
| 1 | **#4** | Five coverage floors have drifted 10–26 points below measured | `testing` `toolchain` | 4 | 5 | **Haiku 4.5** | 20.0 |
| 2 | **#3** | 20 evaluated `strict-type-checked` rules were written up but never enabled | `toolchain` `types` | 4 | 7 | **Sonnet 5** | 14.0 |
| 3 | **#9** | `startGitHubSignIn` is the one vault action that skips the catch-and-notify convention | `error-handling` | 3 | 4 | **Sonnet 5** | 6.0 |
| 4 | **#5** | `/ical` Worker endpoint is an unauthenticated open fetch proxy | `security` | 5 | 2 | **Opus 5** | 3.3 |
| 5 | **#7** | `components.json` `utils` alias points at a module that doesn't exist | `toolchain` `library-fit` | 2 | 1 | **Haiku 4.5** | 2.0 |
| 6 | **#8** | `CLAUDE.md`'s "Route shells" warning describes a gap that is now closed | `toolchain` | 2 | 1 | **Haiku 4.5** | 2.0 |

- **#5 (security, impact 5) falls to 4th purely on the effort divisor**, because
  it is the one finding here that needs a product decision rather than an edit.
  It is not less important than the two impact-2 config fixes below it. If you
  are triaging by consequence rather than by cost, #5 belongs in the top three.

**Sequencing note.** No sequencing is needed among what's left — #2 and #6
have already landed (each touched its own file, `worker/tsconfig.json` and
`vitest.config.ts`'s `thresholds` respectively, with nothing left to
coordinate). #3, #4, #5, #7 and #8 are independent of
everything else and of each other.

---

### #4 — Five per-file coverage floors have drifted 10–26 points below measured, including the one guarding silent write loss

- **Category:** `testing` `toolchain`
- **Impact:** 4
- **Breadth:** 5 threshold entries in `vitest.config.ts`. Established by parsing
  every per-file threshold out of the config and diffing it against
  `coverage-summary.json` from a real `--coverage` run.
- **Recommended model:** **Haiku 4.5**
- **Evidence:**
  - `vitest.config.ts` — `        'src/storage/entityWrites.ts': { statements: 72, branches: 62, functions: 75, lines: 72 },`
  - …sitting directly under a comment that claims it is guarded. That comment is
    hard-wrapped; its verbatim single-line fragment is
    ``        // two `catch` arms (a Dexie write failing outright) visible as their``
  - The config's own standing instruction: `      // storeCommit.ts sat at 30/95/45/35 against a measured 100/100/100/100`
- **Problem:** `entityWrites.ts` — the module whose comment calls a silently
  vanishing save "the worst bug this codebase can have" — carries a floor 18/27/25/18
  points below its measured coverage, so a quarter of its functions could go
  entirely unexecuted with CI green, which is precisely the failure the config
  documents having already been burned by on `storeCommit.ts`.
- **Fix:** Raise the five drifted floors to a few points under measured, per the
  config's own stated convention. Afterwards `pnpm run test:coverage` should still
  pass with no other change.

**Task context**

- **Measured 2026-09-06 via `pnpm run test:coverage`. The enumerated work — five
  entries, with the values they should take** (floor set ~5 points under measured,
  the convention the surrounding entries already use):

  | Threshold key | Current floor | **Measured** | Gap (s/b/f/l) | Suggested new floor |
  |---|---|---|---|---|
  | `src/storage/entityWrites.ts` | 72/62/75/72 | **90.38/88.46/100/89.74** | +18.4/+26.5/+25.0/+17.7 | `85/83/95/85` |
  | `src/editor/dialogs/RepeatDialog.tsx` | 75/60/65/75 | **86.9/83.05/83.33/90** | +11.9/+23.0/+18.3/+15.0 | `82/78/78/85` |
  | `src/editor/useEntryEditor.ts` | 68/55/55/70 | **81.57/59.55/78.12/86.77** | +13.6/+4.5/+23.1/+16.8 | `77/55/73/82` |
  | `src/occurrenceActions.ts` | 85/75/80/88 | **94.5/81.57/100/98.55** | +9.5/+6.6/+20.0/+10.5 | `90/77/95/94` |
  | `src/model/fieldRegistry.ts` | 90/80/85/90 | **98.48/95.36/100/100** | +8.5/+15.4/+15.0/+10.0 | `94/90/95/95` |

- **What stays untouched — this is the important half.** The other ~45 per-file
  floors are within the intended 5–10 point headroom and must **not** be raised.
  A large cluster sits at exactly `92/90/95/92` against a measured `100/100/100/100`;
  that is a deliberate uniform convention for fully-covered small files, not drift.
  `src/editor/urlSafety.ts` is at `100/100/100/100` against measured 100 and is
  correct as-is. Do not touch the global floor (`68/62/59/70` against a measured
  `79.82/73.97/73.87/82.27`) — headroom there is intentional so ordinary UI work
  doesn't trip CI.
- **The `exclude` list is clean — checked in the other direction too.** Every
  `src/routes/` exclusion resolves to a file under 100 lines (largest:
  `_app.week.$date.tsx` at 76), and `src/coverageConfig.test.ts` already asserts
  both halves — that threshold keys resolve, and that excluded route files stay
  small. No action needed there.
- **The trap, located.** `useEntryEditor.ts`'s **branches** measure 59.55 against a
  floor of 55 — only 4.5 points of headroom, unlike its other three metrics. Raise
  that one to 55 (i.e. leave it) or at most 55–56; pushing it to ~72 in line with
  the other three columns would make the gate brittle for a file that is actively
  churning (`editor/` is the repo's third-hottest directory). The suggested value
  above reflects this.
- **Confirming the fix:** `pnpm run test:coverage` from the repo root — it fans
  out to the worker too, so one command covers both workspaces.

---

### #3 — 20 `strict-type-checked` rules were evaluated, written up in the config, and then never enabled

- **Category:** `toolchain` `types`
- **Impact:** 4
- **Breadth:** 7 files carry the 11 violations. Established by dry-run.
- **Recommended model:** **Sonnet 5**
- **Evidence:**
  - `eslint.config.js` — `      // Not enabled yet only because fixing 11 real findings is its own change,`
  - `eslint.config.js` — `      //   2  no-dynamic-delete            1  no-unnecessary-type-conversion`
- **Problem:** The config carries a complete, honest evaluation of the 20
  unassessed `strict-type-checked` rules — including a reproduction recipe — and
  concludes they are worth having, but none is switched on, so the analysis sits
  in a comment where nothing acts on it and the 11 real defects stay in the tree.
- **Fix:** Fix the 11 violations and enable the 20 rules in both the `src/` and
  `worker/src/` blocks. Afterwards `pnpm run lint` should pass with them on.

**Task context**

- **I re-ran the config's own recipe on 2026-09-06 and it reproduces exactly.**
  The delta is **25 rules** (matching the comment), 3 enabled, 2 rejected, 20
  unassessed. Dry-running those 20 over `src` + `worker/src` gives **11 findings
  across 7 rules**, at these precise locations:

  | Rule | Count | Sites |
  |---|---|---|
  | `no-dynamic-delete` | 2 | `src/calendar/AgendaView.test.tsx:171`, `src/calendar/MonthStrip.test.tsx:184` |
  | `no-unnecessary-type-arguments` | 2 | `src/fileIO.ts:120`, `src/fileIO.ts:190` |
  | `no-unnecessary-boolean-literal-compare` | 2 | `src/model/retention.ts:36`, `src/storage/conflictError.ts:57` |
  | `return-await` | 2 | `src/storage/fs.ts:244`, `src/storage/__tests__/moveEntry.test.ts:131` |
  | `no-unnecessary-type-conversion` | 1 | `src/model/expansion.ts:697` |
  | `no-unnecessary-type-parameters` | 1 | `src/routes/-viewChrome.test.tsx:73` |
  | `no-misused-spread` | 1 | `src/settings/VaultSettings.test.tsx:186` |

  13 of the 20 rules are clean. Re-run before starting — the counts move with the
  code.
- **The trap, located.** `src/storage/fs.ts:244` is `  return await contentHash(content)`.
  `return-await`'s default (`in-try-catch`) will want the `await` **removed** if
  that line is *not* inside a `try` — but removing an `await` from a return
  changes when a rejection surfaces relative to any enclosing `finally`. Read the
  enclosing block before applying the autofix; this is the one of the eleven
  where a mechanical fix can change runtime error semantics. The other ten are
  safe autofixes.
- **Both blocks, not one.** `eslint.config.js` has two rule blocks — `src/**`
  (line 68) and `worker/src/**` (line 284) — and the worker block's comment
  explicitly points at the src block for this decision. Enabling in only one
  leaves the other silently unguarded.
- **Reproduce with** the recipe already in the config at the foot of the
  `strict-type-checked` comment block; it works as written.
- **Confirming the fix:** `pnpm run lint` from the repo root (it covers both
  `src` and `worker/src`, then chains `lint:deps`).

---

### #9 — `startGitHubSignIn` is the one vault action that skips the codebase's catch-and-notify convention

- **Category:** `error-handling`
- **Impact:** 3
- **Breadth:** 4 files (1 to fix, 3 calling sites that inherit the fix).
  Established by grepping every caller.
- **Recommended model:** **Sonnet 5**
- **Evidence:**
  - `src/settings/AddVaultWizard.tsx:86` — `    await startGitHubSignIn() // full-page redirect — component unmounts`
  - `src/components/SyncButton.tsx:83` — `          onClick={() => void startGitHubSignIn({ reconnectVaultId: vault.id })}`
  - `src/settings/VaultSettings.tsx:304` — the identical `void` call
  - The convention it breaks, from `src/storage/vaultRegistry.ts`: `    console.error('[vault] addIcalVault failed:', e)`
- **Problem:** Every other vault entry point in `vaultRegistry.ts` —
  `addLocalVault`, `addExampleVault`, `addIcalVault`, `addGitHubVaultOAuth`,
  `reconnectVault`, `removeVault` — wraps its body in `try/catch` and calls
  `notifyError`, but `startGitHubSignIn` does not, so if `crypto.subtle.digest`
  or `sessionStorage.setItem` throws, all three call sites drop the rejection on
  the floor and "Sign in with GitHub" silently does nothing — with
  `AddVaultWizard`'s button stuck reading "Redirecting to GitHub…" permanently.
- **Fix:** Wrap `startGitHubSignIn`'s body in the same `try/catch` +
  `notifyError` shape the sibling actions use, so all three call sites are fixed
  at once.

**Task context**

- **Where to put the catch:** inside `startGitHubSignIn`
  (`src/storage/githubOAuth.ts:45`), **not** at the three call sites. That is what makes it one edit instead of three and what
  matches the sibling precedent.
- **The precedent to copy, exactly:** `addIcalVault` in
  `src/storage/vaultRegistry.ts:708-726` — its catch body is
  `console.error('[vault] addIcalVault failed:', e)` (line 723) followed by
  `notifyError('Could not add calendar subscription', e)` (line 724). Use the
  same two lines with a message naming GitHub sign-in.
- **The trap, located.** The function's last statement is
  `window.location.href = url.toString()` (line 65). A `catch` must not wrap that
  assignment in anything that suppresses the navigation, and — more subtly —
  `AddVaultWizard.tsx:84-87` sets `setSigningIn(true)` *before* the call and never
  resets it, because the successful path unmounts via full-page redirect. Adding
  the catch inside `startGitHubSignIn` alone leaves that button disabled forever
  on the failure path, so `handleSignIn` **also** needs the flag cleared when the
  call returns without navigating.
- **Why lint does not catch this.** `eslint.config.js` sets
  `'@typescript-eslint/no-misused-promises'` with `{ checksVoidReturn: { attributes: false } }`,
  which is a deliberate and correct exemption for idiomatic async JSX handlers —
  but it is also why an async handler with an unhandled rejection passes cleanly.
  Do not change that config option to fix this; fix the function.
- **Scope check, already done.** I traced the other five async JSX handlers in
  `src/settings/` and they are all safe: `handleSyncNow` reaches `runSync`, which
  has a top-level `try/catch/finally`; `handleRemoveClick` uses
  `.catch(() => 0)`; `handleNext`/`handleAddFeed` reach `add*Vault`, which catch
  internally. `startGitHubSignIn` is genuinely the only gap — do not widen the
  change.

---

### #5 — The `/ical` Worker endpoint is an unauthenticated open fetch proxy sharing a quota with sign-in

- **Category:** `security`
- **Impact:** 5
- **Breadth:** 2 files (`worker/src/index.ts`, `worker/src/icalFetch.ts`), plus
  `worker/wrangler.toml` if a rate-limit binding is added. Exposure is a
  condition: **anyone on the internet, no credential required.** Established by
  grepping the whole `worker/` tree for `rate.?limit|throttl|quota` — the only
  hits are in the generated `worker-configuration.d.ts`, i.e. Cloudflare's
  `RateLimit` binding is available in the runtime and **unused**.
- **Recommended model:** **Opus 5**
- **Evidence:**
  - `worker/src/index.ts:28` — `    if (url.pathname === '/ical' && request.method === 'GET') {` — reached with no auth check of any kind
  - `worker/src/cors.ts` — `// ambient session/cookie to protect — callers must already possess a real`
  - `worker/src/icalFetch.ts` — `// URL the caller chooses, which is the classic SSRF shape — hence the host`
- **Problem:** The CORS module's reasoning for letting disallowed-origin requests
  execute — that a caller "must already possess a real `code`/`code_verifier`/`refresh_token`"
  — is sound for `/oauth/token` but does not transfer to `/ical`, which requires
  no secret at all, so any non-browser client can use the Worker as an
  origin-masking proxy for arbitrary public HTTPS GETs (5 MB, 10 s each) and can
  exhaust the free-tier request budget that GitHub sign-in shares.
- **Fix:** Add a rate limit to `/ical` — Cloudflare's `RateLimit` binding is
  already in the generated types and needs only a `wrangler.toml` entry — keyed
  per client IP. Afterwards a burst above the chosen threshold should return 429
  while a normal 15-minute poll is unaffected.

**Task context**

- **What is already correct, and must not be undone.** The SSRF guard in
  `icalFetch.ts` is thorough and should be left alone: it blocks loopback,
  RFC1918, CGNAT, link-local (including `169.254.169.254`), multicast and
  reserved IPv4; handles compressed and IPv4-embedded IPv6; rejects non-`https`,
  embedded credentials and non-443 ports; re-validates **every redirect hop**
  with `redirect: 'manual'`; caps the body at 5 MB by streaming count rather than
  trusting `Content-Length`; and documents its own residual risk (DNS rebinding)
  honestly. **This finding is not about SSRF** — the private-network door is
  shut. It is about unmetered *public* fetches.
- **Why this stays Opus 5, honestly.** The remaining questions are product
  decisions that the code cannot answer and that I should not make: what request
  rate a legitimate user generates (the iCal backend polls every 15 minutes, but
  one user may hold several subscriptions across several devices); whether to
  key the limit on IP, on the requested feed host, or both; and whether to
  additionally reject non-browser callers by `Origin`, which would harden the
  endpoint but breaks any future non-web client. Adding more context to this
  finding would not make those calls for the fixer — that is what makes it a
  genuine Opus-tier item rather than an under-specified one.
- **The specified half, if you want to split it.** Wiring a `[[ratelimit]]`
  binding in `worker/wrangler.toml` and calling `env.RATE_LIMITER.limit({ key })`
  at the top of `handleIcalFetch`, returning 429 on `success: false`, is
  mechanical once the threshold and key are chosen — that part is **Sonnet 5**
  with the numbers supplied.
- **Confirming the fix:** `pnpm --filter meridian-oauth-worker run test` and
  `… run typecheck`. `worker/src/icalFetch.test.ts` already injects a
  `CalendarFetcher` double, so a rate-limit test can follow the same seam without
  touching the network.

---

### #7 — `components.json`'s `utils` alias points at a module that does not exist

- **Category:** `toolchain` `library-fit`
- **Impact:** 2
- **Breadth:** 1 file; affects every future `shadcn add` and every `shadcn diff`.
  Established by `ls src/lib/utils.*` (no such file) and by checking what the 9
  registry components actually import.
- **Recommended model:** **Haiku 4.5**
- **Evidence:**
  - `components.json:17` — `    "utils": "@/lib/utils",`
  - `ls src/lib/utils.*` → `No such file or directory`
  - All 9 `src/components/ui/*.tsx` files that need it import
    `import { cn } from '@/lib/cn'` (9/9, no exceptions)
- **Problem:** The shadcn CLI resolves `aliases.utils` when it writes a component,
  so the next `shadcn add` will emit `import { cn } from "@/lib/utils"` and fail
  to build — and `shadcn diff`, which `CLAUDE.md` names as the reason
  `components/ui/` must stay a faithful mirror, currently reports a spurious
  difference on the import line of all nine files, which is exactly the noise that
  trains a reader to stop trusting it.
- **Fix:** Change `components.json:17` to `"utils": "@/lib/cn"`. Afterwards
  `shadcn diff` should show no import-line differences.

**Task context**

- **The one-line change:** `"utils": "@/lib/utils"` → `"utils": "@/lib/cn"`.
  Nothing else in `components.json` is wrong — `"tailwind.config": ""` is correct
  for Tailwind v4, and `"lib": "@/lib"`, `"ui": "@/components/ui"` and
  `"hooks": "@/hooks"` all resolve.
- **What stays.** Do **not** create a `src/lib/utils.ts` re-export to satisfy the
  stale alias. `@/lib/cn` is the established name (69 importers), it is what all
  nine registry files already use, and adding a second path to the same helper
  would be the worse fix.
- **No source changes.** The nine registry files are already correct; only the
  CLI's config is out of step with them.
- **Why Haiku 4.5:** single known-value edit in a JSON file, no behaviour change,
  and it cannot fail silently — the next `shadcn add` either emits the right
  import or it doesn't.

---

### #8 — `CLAUDE.md`'s "Route shells" section warns about a gap that `layout-smoke.mjs` now closes

- **Category:** `toolchain`
- **Impact:** 2
- **Breadth:** 1 file (`CLAUDE.md`, lines 175–181).
- **Recommended model:** **Haiku 4.5**
- **Evidence:**
  - `CLAUDE.md:179` — ``\`APP_ROUTES\`/\`FLOW_ROUTES\`. A new route is covered by neither until someone``
  - `scripts/layout-smoke.mjs` — `function assertRouteCoverage() {` … which walks
    every leaf route file and exits 1 on any not exercised
  - `scripts/layout-smoke.mjs` — `const ROUTE_COVERAGE_EXEMPTIONS = {`
- **Problem:** `CLAUDE.md` tells every agent that a newly added route silently
  escapes the layout checks until someone remembers to list it, but
  `assertRouteCoverage()` has since made that a hard build failure — so the
  contract agents read is more pessimistic than the tooling, which invites
  redundant hand-rolled guards and, worse, teaches readers that this class of rot
  is unmonitored when it is not.
- **Fix:** Update the paragraph to say the route *coverage* gap is now enforced by
  `assertRouteCoverage()` (with `ROUTE_COVERAGE_EXEMPTIONS` as the documented
  escape hatch), while keeping the still-true warning that nothing verifies a
  route is in the *right* shell list.

**Task context**

- **Precisely what changed and what did not** — this distinction is the whole
  edit, and getting it backwards would make the doc wrong in the other direction:
  - **No longer true:** "A new route is covered by neither until someone adds it."
    `assertRouteCoverage()` runs at the top of `layout-smoke.mjs`, walks every
    leaf file in `src/routes/`, extracts each `createFileRoute(...)` path,
    normalizes away `/_app` `/_entry` prefixes and `$params`, and `process.exit(1)`s
    on any route no URL in `APP_ROUTES`/`FLOW_ROUTES`/`ROUTE_COVERAGE_EXEMPTIONS`
    exercises. CI runs this on every PR.
  - **Still true, keep it:** "Nothing enforces the placement — the filename is the
    whole declaration." A text-input route wrongly filed under `_app` would be
    added to `APP_ROUTES`, pass the app-shell geometry assertions, and its
    keyboard-avoidance failure would still go uncaught. The doc's core warning
    survives; only the "silently uncovered" clause is stale.
- **The one legitimate exemption** currently recorded is `/auth/callback`, with
  its reason written inline — worth naming in the doc so the escape hatch is
  discoverable rather than rediscovered.
- **Verified by reading**, not assumed: I read `assertRouteCoverage()` in full
  and confirmed `layout-smoke.mjs` calls it unconditionally at module scope
  before any browser work, and that `pnpm run test:layout` passes on this tree.
- **Why Haiku 4.5:** a prose edit to one paragraph, with the true and false halves
  enumerated above. No code changes.

---

## Dependencies & Library Fit — verdicts

Measured against the registry on 2026-09-06 with `pnpm outdated` in **both**
workspaces (the worker's must be run from inside `worker/`; `pnpm outdated` at
the root reports the root's list even when a `cd` appears to have happened).

**Read every "outdated" line through `.npmrc`'s `resolution-mode=lowest-direct`.**
The repo deliberately resolves to the *floor* of each caret range, so almost
everything shows as outdated by construction. That is a working policy, not
drift, and a "safe minors" sweep here means bumping the declared ranges, not
just relocking.

- **`typescript` pinned to `~6.0.3` — hold. The documented rationale still
  holds, verified rather than assumed.** `CLAUDE.md` says to re-check with a fact,
  and its stated check —
  `npm view @typescript-eslint/typescript-estree@latest peerDependencies.typescript`
  — returns **`>=4.8.4 <6.1.0` at 8.69.0 (npm latest)**, against a TypeScript
  latest of **7.0.2**. The upper bound is still below 7, so the pin stands and the
  bump should not be attempted. No action.
- **`@types/node` at `^22.20.1` against a registry latest of `26.4.1` — hold, and
  this is the correct call.** Both CI workflows pin `node-version: 22`, so the
  types track the deployed runtime rather than latest, which is exactly the
  alignment the survey asks for. Chasing 26 here would be a regression. No action.
- **`wrangler` exact-pinned at `4.113.0`** (no caret, unlike every other dep) —
  registry latest `4.129.0`. The pin carries no comment explaining itself, which
  makes it the one standing decision in the repo with no recorded rationale.
  Worth either documenting or relaxing to `^4.113.0`; not filed as a finding
  because nothing is currently broken by it.
- **Safe minor/patch sweep, one PR:** the Radix family (12 packages, all ~3 patch
  versions behind), `@codemirror/*`, `@octokit/*`, `@tanstack/*`, `dexie`,
  `sonner`, `zustand`, `@testing-library/*`, `eslint` 10.7→10.10,
  `@typescript-eslint/*` 8.65→8.69, `vite` 8.1→8.2, `knip` 6.29→6.34. Verdict:
  **upgrade now**, batched. Green run that counts: `pnpm run build && pnpm run lint && pnpm run test`.
- **`lucide-react` 1.25.0 → 1.41.0 — try on a branch.** Sixteen minor versions is
  the largest non-major gap in the tree, and icon packages do move glyphs between
  minors. Gating risk: `src/components/vaultIcon.tsx` and `KindIcon.tsx` name
  specific glyphs. Verdict: own PR, visually spot-checked.
- **`vitest` / `@vitest/coverage-v8` 4 → 5 — try on a branch, both workspaces
  together.** A major across a 164-file suite with per-file coverage thresholds
  in two separate configs; the two packages must move in lockstep. Gating risk:
  the `thresholds` schema and the `coverageConfigDefaults` import in
  `vitest.config.ts`. Verdict: its own PR, after #4 (so the floors being asserted
  are the corrected ones).
- **Custom-vs-library, checked in both directions.** `date-fns` v4 is used
  properly and broadly (23 modules) including inside `model/`, with no
  raw-millisecond date math beside it — the one exception is `expansion.ts`'s
  `sameCalendarDay`, a three-line re-implementation of date-fns's `isSameDay`,
  which is a lint-rule-sized nit rather than a finding. The **keep-custom
  verdicts** worth stating: the hand-rolled iCal RRULE↔`Repeat` translation
  (`storage/ical/`) is correctly custom, because it maps onto this app's own
  `Repeat` domain type that no RRULE library can express; and
  `monthGridCells.ts` is correctly custom and correctly *shared* between
  `MonthGrid` and `MiniMonth` rather than pulling a calendar library.

---

## Suggested improvements to `plans/surveys/health.md`

Committed separately on this branch, as the shared conventions require, so they
arrive as a reviewable diff rather than prose. Three changes, all learned from
this run:

1. **A bundle-composition item in the Budget.** This run's highest-impact
   finding (the root route's barrel import defeating the editor's own
   `lazy()`, now fixed) was invisible to every listed budget item — it needed
   building the app and grepping the emitted chunks for library markers.
   Nothing in the survey asks for that, so it was found by accident.
2. **"Verify the docs against the tooling, not just the code."** The Process
   section says to treat `CLAUDE.md` claims as hypotheses about the *code*; two
   findings here (#8, and the framing of #3 and #4) came from checking doc and
   config comments against the *tooling*, in both directions — a claim that a gap
   exists can be as stale as a claim that it doesn't.
3. **A caveat on the churn measurement.** The Budget asks for a 60-day
   `git log` sample to weight findings by activity. This repo's history is
   squashed — 144 commits spanning three days — so the window returned the entire
   log and the weighting carried far less signal than intended. Worth saying that
   a repo whose history is shorter than the window should record that rather than
   report churn numbers as if they were comparative.

**Directory churn measured this run** (whole available history, per the caveat):
`calendar` 274, `model` 250, `editor` 215, `storage` 205, `components` 177,
`routes` 146, `settings` 61. #4's drifted floors are concentrated in `editor/`
and `storage/` — two of the four hottest areas — so fixing them now is cheaper
than after more code accretes.
