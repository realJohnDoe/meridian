# Meridian — Codebase Health Report

_Survey date: 2026-07-10 · Branch: `claude/codebase-health-survey-e3130d` · 311 tests passing_

## Health verdict

This is one of the healthiest codebases of its size I've surveyed: strict type-checked
linting with machine-enforced architecture invariants (all three CLAUDE.md invariants are
genuinely present in `eslint.config.js` and the lint run is clean), knip and `pnpm audit`
gated in CI, a pure domain core with 311 passing tests, a documented CSP, and no security
findings against its actual threat model. The worst area is **the effectful half of
`storage/`** — the sync/push orchestration (`sync.ts`, `vaultRegistry.ts`, `cache.ts`,
`githubOAuth.ts`) sits at 2–12% test coverage and contains the repo's one real correctness
defect: the delete path lacks the conflict handling the write path implements so carefully,
allowing silent loss of remote edits. The single biggest structural theme is **verification
asymmetry**: the pure core (`model/`, `planReconcile`, `taskLines`) is superbly tested and
lint-guarded, while the imperative I/O shell around it runs on the honor system — and two
toolchain blind spots (coverage only measuring imported files, knip exempting all of
`components/ui/**`) make the dashboards report better health than actually exists.

## Coverage statement

- **Read closely (~35% of source lines):** all root cross-cutting files (`store.ts`,
  `storeBridge.ts`, `storeCommit.ts`, `persistencePort.ts`, `occurrenceActions.ts`,
  `occView.ts`, `fileOccurrence.ts`, `format.ts`, `fileIO.ts`, `wikilinks.ts`); `storage/`
  (`sync.ts`, `vaultRegistry.ts`, `githubBackend.ts`, `githubOAuth.ts`, `githubApi.ts`,
  parts of `fs.ts`); `editor/save.ts`, `useEntryEditor.ts`, `cm/markdownFormatting.ts`;
  `calendar/AgendaView.tsx`, parts of `DayView.tsx` / `MonthView.tsx`; the entire toolchain
  (`package.json`, `eslint.config.js`, `knip.json`, all tsconfigs, `vitest.config.ts`,
  `vite.config.ts`, all four CI workflows); `worker/src/index.ts` + `cors.ts`; `hooks/`,
  `search/`, `model/dateUtils.ts`, `model/repeat.ts`.
- **Sampled:** `model/` internals (structure of `expansion.ts`/`collapse.ts`/`storeOps.ts`),
  `components/`, `onboarding/`, `exampleBackend.ts`, `debug/` (imports only), storage tests,
  routes.
- **Skipped:** shadcn `components/ui/*` bodies (vendored-style; checked only for dead code),
  `routeTree.gen.ts` (generated), `dist/`, `plans/`, `worker/src/oauthToken.ts` body (tested
  in CI).
- **Basis:** roughly two-thirds of the codebase read or sampled; toolchain 100%.
- **Unverified suspicions:** `set-state-in-effect` hits in `MonthView.tsx:212/216` and
  `EntryBody.tsx:134`; uncleaned `setTimeout`s in `DayView.tsx:139` / `OccurrenceRow.tsx:124`;
  `EntryEditor.tsx`, `ItemsList.tsx`, `RepeatDialog.tsx` internals not read line-by-line.
- **Known suspects:** none were listed in the brief.

## Findings

### 1. Sync delete path has no conflict handling — remote edits can be silently destroyed

| Category                         | Impact | Breadth | Fix effort |
| -------------------------------- | ------ | ------- | ---------- |
| `error-handling`, data integrity | 7/10   | 3 files | S          |

**Evidence:** `src/storage/sync.ts:253` — the tombstone loop, unlike the dirty-write loop
above it, has no `ConflictError` catch:

```ts
await backend.delete(f.path, f.version);
```

and `src/storage/githubBackend.ts:141` prefers the in-memory SHA cache over the caller's
CAS version:

```ts
const sha = this._shas.get(path) ?? expectedVersion;
```

— the exact opposite of `write()`'s documented policy ("Avoid falling back to `_shas` here —
that cache may be stale", `githubBackend.ts:120`).

**Problem:** if a file is edited remotely and then deleted locally, the DELETE either 409s
(→ `ConflictError` escapes `pushDirty`, sync wedges in an error loop for the session because
reconcile never runs to refresh SHAs), or — after a reload, when `reconcileWithBackend`'s
`statAll()` refreshes `_shas` but `planReconcile` skips the tombstoned path — the delete
retries with the _fresh_ SHA and destroys the remote edits with no conflict copy, defeating
the data-preservation guarantee the write path implements via `resolveCollision`.

**Fix:** catch `ConflictError` in the tombstone loop and route it through
`resolveCollision`-style handling (pull the remote copy, surface it, drop the tombstone),
and make `delete()` use `expectedVersion ?? this._shas.get(path)` to match `write()`'s CAS
policy.

### 2. The effectful persistence/sync layer is almost entirely untested

| Category  | Impact | Breadth  | Fix effort |
| --------- | ------ | -------- | ---------- |
| `testing` | 6/10   | 10 files | M          |

**Evidence:** `pnpm run test:coverage` output:
`sync.ts | 11.85 | 15.38 | 8.33 | 11.37 | ...53-190,208-380`. Also: `cache.ts` 2.0%,
`githubOAuth.ts` 9.0%, `notifications.ts` 0%, `storeCommit.ts` 0%, `persistencePort.ts`
14.3%, `lib/vaultStorage.ts` 0%, `store.ts` 31.5%; `vaultRegistry.ts` and
`occurrenceActions.ts` never even loaded by a test. The existing storage tests deliberately
stop at the pure edges — `reconcile.test.ts` tests only `planReconcile`, and
`sync-collision.test.ts` tests a `FakeBackend`'s CAS semantics, never
`pushDirty`/`resolveCollision`/`runSync` themselves.

**Problem:** the code paths that can lose user data — collision copy-out, tombstone push,
auth-retry-after-401, backoff state — have zero automated verification (which is exactly
how finding 1 survives), while trivially pure helpers like `types.ts` are at 93%.

**Fix:** the existing `FakeBackend` plus a fake `cache` module make
`pushDirty`/`resolveCollision`/`runSync` unit-testable today; add a suite covering
write-conflict, delete-conflict, auth-retry, and backoff transitions, and extend the
`vitest.config.ts` per-file thresholds to `sync.ts` once green.

### 3. Coverage measurement is blind to files no test imports

| Category               | Impact | Breadth    | Fix effort |
| ---------------------- | ------ | ---------- | ---------- |
| `toolchain`, `testing` | 4/10   | ~120 files | S          |

**Evidence:** `vitest.config.ts` configures `coverage: { provider: 'v8', reporter: ['text',
'html'] }` with thresholds but no `include`; the report's headline
`Statements : 59.82% ( 1151/1924 )` counts only ~1.9k of the ~20.5k source lines — 157
non-test source files exist but only ~35 appear in the report (no `.tsx` file at all, nor
`occurrenceActions.ts`, `localBackend.ts`, `fs.ts`, `occView.ts`).

**Problem:** the "60% covered" summary overstates health and hides that entire modules have
never been executed under test, undermining the very signal `test:coverage` exists to give.

**Fix:** add `coverage.include: ['src/**/*.{ts,tsx}']` (optionally excluding
`components/ui/**` and routes) so unimported files count as 0% and the report reflects
reality.

### 4. knip's `components/ui/**` entry exemption masks real dead code

| Category                 | Impact | Breadth  | Fix effort |
| ------------------------ | ------ | -------- | ---------- |
| `toolchain`, `dead-code` | 3/10   | 13 files | S          |

**Evidence:** `knip.json` lists `"src/components/ui/**/*.{ts,tsx}"` under `entry`.
Re-running knip with that line removed reports:
`Unused files (1): src/components/ui/ScrollColumn.tsx` (120 lines of _custom_, non-shadcn
code with zero importers) and `Unused exports (46)`, including ~14 `Sidebar*` exports — the
bulk of the 773-line `sidebar.tsx`, of which only `SidebarProvider` and `useSidebar` are
imported (`routes/_app.tsx:14`).

**Problem:** declaring the whole ui directory an entry point tells knip "everything here is
used by definition," so dead custom components accumulate invisibly despite knip running in
CI.

**Fix:** drop the `ui/**` entry, delete `ScrollColumn.tsx`, and either trim `sidebar.tsx`
to the two used exports or add targeted `ignoreExports` for the shadcn files whose unused
subcomponents you want to keep as vendored surface.

### 5. The worker workspace is type-checked and tested but never linted

| Category    | Impact | Breadth | Fix effort |
| ----------- | ------ | ------- | ---------- |
| `toolchain` | 2/10   | 5 files | S          |

**Evidence:** `eslint.config.js:35` scopes everything to `files: ['src/**/*.{ts,tsx}'],`,
the root script is `"lint": "eslint src"`, and `worker/package.json` has only `"typecheck"`
and `"test"` scripts; CI's `worker-checks` job runs just those two.

**Problem:** the security-most-sensitive code in the repo (the OAuth token exchange holding
the client secret) is exempt from the type-aware rule set (`no-floating-promises`,
`no-misused-promises`, …) that guards everything else.

**Fix:** add a config block for `worker/src/**` (parser project `worker/tsconfig.json`,
TS rules only — no React) and change the script to cover it.

### 6. 12-hour time formatting duplicated across `model/dateUtils.ts` and `format.ts`

| Category | Impact | Breadth           | Fix effort |
| -------- | ------ | ----------------- | ---------- |
| `dry`    | 2/10   | 2 files (3 sites) | S          |

**Evidence:** `model/dateUtils.ts:36` and `format.ts:71` both contain
`return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })`,
each preceded by the same synthetic-`Date` construction from an `HH:mm` string.

**Problem:** `fmtEndTime` in `format.ts` re-implements the hour12 branch of `fmtT` in
`model/dateUtils.ts`, so a locale-formatting fix must be made twice or the two drift.

**Fix:** export one `formatHHMM(hhmm, hour12)` helper from `model` and have `fmtEndTime`
delegate to it.

### 7. Root view-model helper `occView.ts` depends on the UI-variants layer

| Category                 | Impact | Breadth               | Fix effort |
| ------------------------ | ------ | --------------------- | ---------- |
| `architecture`, `layout` | 2/10   | 1 file (10 importers) | S          |

**Evidence:** `occView.ts:4`:

```ts
import type { OccState } from "@/components/ui/occurrence-variants";
```

**Problem:** a root-level, framework-free helper (documented in CLAUDE.md as a cross-cutting
view-model module) reaches _down into_ a feature directory for its return type — type-only,
so no runtime cycle, but `occState()`'s domain vocabulary is defined by a cva styling file.

**Fix:** move the `OccState` union into `types.ts` (or `occView.ts` itself) and have
`occurrence-variants.ts` import it.

## Verdicts on remaining categories (no findings — status quo is correct)

- **Security:** threat model is a client-only SPA on GitHub Pages parsing the user's own
  Markdown/YAML vaults, with OAuth tokens in IndexedDB and a Cloudflare worker holding the
  client secret. No XSS vectors found: CM6 widgets render via `textContent`, link opening is
  scheme-gated (`/^(https?|mailto):/i`), YAML uses the safe core schema, `titleToSlug`
  strips to `[a-z0-9-]`, PKCE + `state` are both verified, worker CORS is locked to the app
  origin with a written rationale, and the build injects a strict CSP whose one relaxation
  (`style-src 'unsafe-inline'`) is correctly argued in `vite.config.ts`.
- **Library fit:** the custom recurrence engine (`model/repeat.ts` + `expansion.ts`) is the
  right call over `rrule` — it owns after-completion repeat semantics, deterministic
  occurrence IDs, and YAML round-tripping no RRULE library expresses; `date-fns` is used
  properly; dexie/zustand/octokit all earn their place; knip + CI confirm no unused deps.
- **Enabling the full `@eslint-react` preset: anti-recommendation.** Dry-run: 118 problems,
  67 of which are `no-forward-ref` React-19 modernization (almost all vendored shadcn
  files), most of the rest naming/style preferences; only ~5 hits are even candidate bugs,
  and the one traced (`useFlipReorder`'s `{ once: true }` listener) is a false alarm. The
  current hand-curated rules are the better trade. Worth cherry-picking at most
  `set-state-in-effect` and `web-api-no-leaked-timeout`.
- **Formatter:** none installed; given the single-author, visibly deliberate aligned style,
  adopting Prettier would churn every file for negative value — correctly absent.

---

# Dependency Review

_From `pnpm outdated` in both workspaces, 2026-07-10._

Everything user-facing is on its latest major (React 19, Tailwind 4, date-fns 4, zustand 5,
dexie 4, eslint 10, vitest 4). The real decisions are three dev-toolchain majors.

## Worth acting on

1. **TypeScript 5.8.3 → 7.0.2** (pinned `~5.8.0`, both workspaces) — the biggest win
   available. TS 7 is the native (Go) compiler rewrite; the `build` script runs `tsc -b`
   twice plus type-aware ESLint over the whole project, so this is where CI minutes go.
   Gate: check `@typescript-eslint` (8.63) support for TS 7 first; if it doesn't fly yet,
   at least loosen the `~5.8.0` pin to pick up 5.9/6.x. Try on a branch —
   `pnpm run build && pnpm run lint && pnpm test` is a complete verdict.
2. **Vite 6.4.3 → 8.1.4** plus `@vitejs/plugin-react` 4.7 → 6.0.3 (they go together). Two
   majors behind is the one place the repo drifts from the ecosystem. Risk is concentrated
   in the plugin stack — `vite-plugin-pwa`, the TanStack router plugin, and the three custom
   plugins in `vite.config.ts` (those use stable hooks and should survive). Own PR; verify
   with the build plus a manual `pnpm preview` pass on PWA/debug-page behavior.
3. **Worker: `@cloudflare/workers-types` 4 → 5, wrangler 4.105 → 4.107.** Better: switch to
   the successor pattern — `wrangler types` generates runtime types matching the exact
   `compatibility_date`, replacing the package entirely.
4. **Patch/minor sweep** — ~25 packages, all safe (`@codemirror/*`, Radix, TanStack,
   react 19.2.6→.7, `@eslint-react` 5.11→5.13, `date-fns` 4.3→4.4, `lucide-react`
   1.17→1.23, `sharp`). One `pnpm update` commit; CI gates it.
5. **`@types/node` 22 → 26:** don't chase latest — track the Node CI runs
   (`node-version: 22`). Either stay on 22 types, or bump CI to Node 24 LTS and take
   `@types/node@24` with it.

## Newer features of things already installed

- **React 19 idioms in the shadcn layer:** vendored `components/ui/*` still use
  `forwardRef` (67 occurrences) and `<Context.Provider>`. Re-syncing from the current
  shadcn registry drops `forwardRef` for ref-as-prop. Zero user-visible value — only do it
  while touching those files anyway (e.g. when trimming the dead `sidebar.tsx` exports).
- **TS lib bump can delete a cast:** `store.ts:11` does
  `(locale as unknown as { getWeekInfo?: ... }).getWeekInfo?.()` because `lib: ["ES2020"]`
  predates the `Intl.Locale.prototype.getWeekInfo` typings. Raising `target`/`lib` to
  ES2024 (the runtime floor is already es2022-era browsers) likely makes the cast
  unnecessary — verify first.

## Explicitly fine as-is

No abandoned or superseded dependencies: `vaul`, `cmdk`, `sonner`, `next-themes`,
`class-variance-authority` are maintained and current-major; `@octokit/core` 7,
`react-day-picker` 10, `yaml` 2, and `knip` 6 didn't appear in the outdated list at all.

**Suggested order:** (4) minor sweep → (3) worker → (2) Vite → (1) TypeScript, each as its
own PR so CI isolates any breakage.
