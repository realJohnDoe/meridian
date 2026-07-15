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
