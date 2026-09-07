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
and all eight quality gates pass in both workspaces.

The single biggest structural theme is **not** overengineering — I looked hard
for it and did not find it. Every port and abstraction I tested has a real
second consumer or a documented cycle-breaking reason (`persistencePort`,
`autoSaveFlushPort`, `ViewChrome`, the four storage backends), and the
meta-infrastructure is proportionate to the product it guards (1,256 lines of
toolchain config against 39,056 lines of non-test source, ~3%). The theme is
instead **intent that the toolchain doesn't hold up**: a `CLAUDE.md` paragraph
still warning about a gap that has since been closed (#8). This is small on
its own; it is one instance of a pattern — decisions recorded but not wired to
anything that re-checks them.

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
| 4 | Security | **clean** |
| 5 | Testing & Error Handling | **clean** |
| 6 | Code Health & DRY | **clean** |
| 7 | Toolchain & Developer Feedback Loops | **findings: #8** |
| 8 | Dependencies & Library Fit | **clean** (plus three keep-verdicts, below) |
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
| 1 | **#8** | `CLAUDE.md`'s "Route shells" warning describes a gap that is now closed | `toolchain` | 2 | 1 | **Haiku 4.5** | 2.0 |

**Sequencing note.** No sequencing is needed among what's left — #2, #3, #4,
#5, #6, #7 and #9 have already landed, each in its own file
(`worker/tsconfig.json`, the 20 `strict-type-checked` rules enabled in
`eslint.config.js`, `vitest.config.ts`'s `thresholds`, the `/ical` Worker
endpoint, `vitest.config.ts`'s `thresholds` respectively — #4 and #6 both
touch the thresholds block, at different entries — `components.json`'s
`utils` alias, and `startGitHubSignIn`'s catch-and-notify wrapper) with
nothing left to coordinate. #8 is independent of everything else.

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
  `vitest.config.ts`. Verdict: its own PR — the per-file floors it asserts
  against are already the corrected ones (#4 has landed).
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
