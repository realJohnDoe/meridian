# Codebase Health Survey — Results

Run date: 2026-08-17 · Commit: `f7955cd` · Branch: `claude/health-survey-485a0p`

## 1. Health verdict

Meridian is in unusually good health for its size (~20k source LOC across 326
TS/TSX files). All four quality gates pass, the documented architecture
invariants are genuinely machine-enforced rather than merely written down —
zero cross-module deep imports, `model/` provably framework-free, the
persistence port never bypassed — and there is no dead code, no `any`, and no
XSS or injection surface. The weakest area is not a source directory at all
but the **worker/ package's position in the toolchain**: the app's most
security-sensitive code (the GitHub client secret, the SSRF-guarded calendar
proxy) sits outside both `pnpm run build` and `pnpm run test`, so 39 of its
tests only ever execute in a separate CI job. The second weakest is
**`format.ts`'s duration inverse**, which hand-rolls modulo arithmetic beside
the calendar-correct `date-fns` math its own forward function uses.

The single biggest structural theme is **enforcement asymmetry, not
over- or under-engineering**: everything expressed as a lint rule or a CI step
is airtight, and everything expressed as prose has quietly drifted. I looked
hard for overengineering — holding every port, optional prop, and config knob
to the "does a second real caller exist today?" test — and found none worth
reporting: `StorageBackend` has four real implementations, `refreshAuth?`/
`onProgress?`/`hasRemote` each have genuine variance across those four, and
`persistencePort` earns its indirection by breaking a store↔storage cycle. The
findings below are correspondingly concentrated in the unenforced seams:
config comments that contradict their values, a coverage floor that drifted 14
points below reality, a dependency pin whose own stated expiry condition has
been met, and a module architecture doc naming files that no longer exist.

## 2. Coverage statement

**Examined closely:** `package.json`, `eslint.config.js` (452 lines, read in
full), `vitest.config.ts`, `vite.config.ts`, `knip.json`, `.npmrc`,
`pnpm-workspace.yaml`, all tsconfigs, both CI workflows; `src/store.ts`,
`src/persistencePort.ts`, `src/occView.ts`, `src/format.ts`,
`src/storage/{index,backend,backends,cache/credentials}.ts`,
`src/calendar/{agendaSections,AgendaRow}.tsx`,
`src/editor/dialogs/DatePickerDialog.tsx`, `src/model/AGENTS.md`,
`src/model/index.ts`, and the entire `worker/src/` (`index.ts`, `cors.ts`,
`icalFetch.ts`, `oauthToken.ts`).

**Sampled:** `src/model/` (barrel + AGENTS.md verified against actual exports;
`expansion.ts`/`storeOps.ts` read only in outline), `src/storage/sync.ts` and
`vaultRegistry.ts` (catch-block survey + call-graph greps, not full reads),
`src/routes/`, `src/hooks/`, `src/search/`, `src/components/`,
`src/editor/cm/`, `src/onboarding/`. Structural properties (import graph,
memoization density, `any`/cast census, a11y, inline styles, churn) were
measured across **all** of `src/` by grep rather than read.

**Skipped:** `src/routeTree.gen.ts` (generated), `src/components/ui/**` (shadcn
registry mirror, excluded by policy), `coverage/` and `dist/` (build output,
inspected as artifacts only), `blog/` and `plans/` (prose, not shipped code),
`public/` (inspected as assets). No source directory was skipped entirely.

**Quality gates — all four green** (single run each, this commit):

| Gate | Command | Result |
|---|---|---|
| Build | `pnpm run build` | **pass** (exit 0) |
| Lint | `pnpm run lint` | **pass** — 0 errors, 12 warnings, exactly at the `--max-warnings=12` ceiling |
| Test | `pnpm run test:coverage` | **pass** — 1,462 tests, 0 failures |
| Coverage | thresholds in `vitest.config.ts` | **pass** — 71.05% stmts / 65.72% br / 62.69% fn / 73.45% lines |
| Dead code | `pnpm run knip` | **pass** — no unused files, exports, or deps |
| Audit | `pnpm audit --audit-level=high` | **pass** (1 moderate advisory below the gate — see #7) |

Fraction of the codebase this report rests on: roughly **40% read line-by-line**,
with structural checks (imports, types, a11y, churn, dependency currency) run
across **100%**.

**Unverified — suspected but not investigated for budget:**
`src/storage/sync.ts` (1,085 lines, the largest source file, 17 commits in 60
days) was surveyed for error handling but its reconcile/conflict state machine
was not traced end to end; `src/model/expansion.ts` and `storeOps.ts` (715 and
858 lines) were read only at the barrel/doc level. If a tenth finding exists,
it is most likely in the sync state machine.

**Development concentration** (`git log --since="60 days ago"`, 157 commits):
`src/calendar` 423 file-touches, `src/editor` 199, `src/routes` 176, root `src`
160, `src/storage` 142. Hottest single files: `storage/vaultRegistry.ts` (22),
`storage/sync.ts` (17), `calendar/AgendaRow.tsx` (17). `worker/` saw 34 —
low-churn, which is part of why finding #1 has gone unnoticed.

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Architecture & Domain Separation | **clean** — full import-graph scan; zero cross-module deep imports, `model/` purity and the persistence port both hold |
| 2 | Simplicity & Overengineering | **clean** — every port, optional prop, and config knob checked for a second real caller; all passed |
| 3 | Directory & File Layout | **clean** — barrels consistent, `lib/` residents each have 2+ consumers, no co-change/distance mismatch in the 60-day sample |
| 4 | Security | **clean** — SSRF guards, CSP, CORS, and token storage all reviewed; no XSS/injection surface (see #7 for the dependency-side note) |
| 5 | Testing & Error Handling | findings: **#1**, **#3**, **#4** |
| 6 | Code Health & DRY | findings: **#3**, **#5** |
| 7 | Toolchain & Developer Feedback Loops | findings: **#1**, **#2**, **#4**, **#8** |
| 8 | Dependencies & Library Fit | findings: **#3**, **#6**, **#7** |
| 9 | Styling & UX | **clean** — no bypassed shadcn components, no `onClick` on non-interactive elements, inline styles confined to virtualizer/positioning transforms |
| 10 | Performance | findings: **#9** |

## 4. Findings

### Summary table

| # | Finding | Impact | Breadth | Recommended model | Score |
|---|---|---|---|---|---|
| 1 | worker/ escapes `pnpm build` and `pnpm test` | 7 | 7 | Sonnet 5 | 24.5 |
| 2 | `--max-warnings=12` budget is 2/3 permanent noise | 4 | 8 | Sonnet 5 | 16.0 |
| 3 | `endDateToDuration` inverts calendar units with 365/30 modulo | 6 | 3 | Sonnet 5 | 9.0 |
| 4 | Global coverage floor drifted 14 points below actual | 6 | 3 | Sonnet 5 | 9.0 |
| 5 | `model/AGENTS.md` names files and functions that no longer exist | 5 | 1 | Haiku 4.5 | 5.0 |
| 6 | undici pin's own revisit condition has been met | 5 | 2 | Sonnet 5 | 5.0 |
| 7 | postcss advisory missing from the overrides block | 4 | 1 | Haiku 4.5 | 4.0 |
| 8 | `.npmrc` comment contradicts its own setting | 2 | 1 | Haiku 4.5 | 2.0 |
| 9 | 639 KB `public/icon.png` ships as a dead asset | 2 | 1 | Haiku 4.5 | 2.0 |

Findings are numbered and listed in `(impact × breadth) ÷ effort` order. Two
notes for re-sorting: #2 ranks second on breadth alone and is the cheapest
item here to land, while #3 is the only finding that is a **user-visible
correctness bug** — sort by raw impact if that is what you care about.

**Sequencing note:** #6 and #7 both edit `pnpm-workspace.yaml`'s `overrides`
block — do #6 (jsdom 30 + drop the undici cap) first, then #7 (add postcss) in
the same file, so the lockfile regenerates once. #1 and #4 both touch test
configuration but different files (`package.json` vs `vitest.config.ts`) and
do not conflict. #2 edits `eslint.config.js` and `package.json`; only the
latter overlaps #1, so land #1 first. Everything else is independent.

---

### #1 — worker/ escapes both `pnpm run build` and `pnpm run test`

- **Category:** `toolchain` `testing` `security`
- **Impact:** 7
- **Breadth:** 7 files (`find worker/src -name '*.ts'` → 7, of which 3 are test files carrying 39 tests)
- **Recommended model:** **Sonnet 5** — hazard: the obvious fix (widening the root `vitest.config.ts` `include` glob to `worker/**`) is wrong and fails *loudly but confusingly*, because worker tests would then inherit the root's `setupFiles: ['src/test-utils/setup.ts']` and `@` alias, which the worker package neither has nor needs. The fix must compose `pnpm --filter meridian-oauth-worker` scripts into root `build`/`test` scripts so each package keeps its own vitest config. With that constraint stated in the task, Sonnet 5 is sufficient; without it, Opus 5.
- **Evidence:**

  `vitest.config.ts` scopes the root suite to `src/` only:
  ```
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  ```
  `tsconfig.json` references only the app and node projects — `worker/tsconfig.json` is not among them:
  ```json
    "references": [
      { "path": "./tsconfig.app.json" },
      { "path": "./tsconfig.node.json" }
    ]
  ```
  and `package.json`'s gates are correspondingly root-only:
  ```
      "build": "vite build && tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
      "test": "vitest run",
  ```
  Measured: `pnpm exec vitest list` at the root returns 1,462 tests, **0** of them from `worker/`; `cd worker && pnpm exec vitest list` returns **39**. Only `pnpm run lint` (`eslint src worker/src`) covers the package. CI compensates via a separate `worker-checks` job in `ci.yml`, so this is invisible from CI green.

- **Problem:** The package `eslint.config.js` itself calls "the most security-sensitive code in the repo, since it handles the GitHub client secret" is the one package whose tests and typecheck a developer or agent following CLAUDE.md's own instruction — *"Always use `pnpm run build` … to verify the full project build"* — never runs, so a broken OAuth exchange or a regressed SSRF guard reaches CI unnoticed locally.
- **Fix:** Add root scripts that fan out to the worker (`"test": "vitest run && pnpm --filter meridian-oauth-worker run test"`, and likewise append `pnpm --filter meridian-oauth-worker run typecheck` to `build`), and correct CLAUDE.md's "Build verification" section to match.

---

### #2 — the `--max-warnings=12` budget is two-thirds permanent noise

- **Category:** `toolchain`
- **Impact:** 4
- **Breadth:** 8 files (`package.json` plus the 7 warning-source files, from `pnpm exec eslint src worker/src -f json` tallied by rule and file: `calendar/AgendaView.tsx`, `calendar/OccurrenceList.tsx`, `calendar/useAgendaScrollRestore.ts`, `calendar/useVirtualFlip.ts`, `components/FlipList.tsx`, `components/primitives/responsive-modal.tsx`, `search/FileResultsList.tsx`)
- **Recommended model:** **Sonnet 5** — hazard: the tempting fix is lowering the number, which turns CI red immediately. The correct fix is disabling the two stylistic rules *first*, then lowering the cap to what remains. A wrong-but-plausible change here fails loudly (red CI), which is why this stays below Opus.
- **Evidence:**

  `package.json`:
  ```
      "lint": "eslint src worker/src --max-warnings=12",
  ```
  A full `pnpm run lint` run on this commit ends with `✖ 12 problems (0 errors, 12 warnings)` — exactly at the ceiling. The distribution:

  | Rule | Count | Actionable? |
  |---|---|---|
  | `@eslint-react/naming-convention-ref-name` | 7 | no — deliberate naming |
  | `@eslint-react/naming-convention-context-name` | 1 | no — deliberate naming |
  | `react-hooks/incompatible-library` | 3 | yes — real memoization hazard |
  | `@eslint-react/no-unnecessary-use-prefix` | 1 | borderline |
  | **total** | **12** | 8 of 12 permanently unactionable |

- **Problem:** Eight of twelve budget slots are consumed by naming-convention warnings nobody intends to satisfy, so the ratchet that is supposed to gate genuinely meaningful warnings (`react-hooks/incompatible-library`, which flags an API React Compiler cannot memoize safely, and already accounts for 3) has only one slot of headroom left, and the budget number no longer communicates anything about code health.
- **Fix:** Turn off `@eslint-react/naming-convention-ref-name` and `naming-convention-context-name` in `eslint.config.js` (they are style, and the repo has deliberately chosen otherwise), then lower `--max-warnings` to the remaining count so the budget tracks only actionable signal.

---

### #3 — `endDateToDuration` inverts calendar durations with fixed 365/30-day modulo

- **Category:** `dry` `library-fit` `testing`
- **Impact:** 6
- **Breadth:** 3 files (`grep -rn "endDateToDuration" src` → `src/format.ts`, `src/editor/dialogs/DurationDialog.tsx` (3 call sites), and `src/format.test.ts` which never mentions it)
- **Recommended model:** **Sonnet 5** if the task states that the inverse must mirror `durationToEndDate` — i.e. re-derive the candidate end date with `addMonths`/`addYears` + the existing `inclusiveCalendarEnd` clamp and compare, rather than dividing a day count; else **Opus 5**. This is the archetypal silent failure: a plausible fix reaching for `differenceInCalendarMonths` alone still mishandles the Jan-31 → Feb-28 clamp that `durationToEndDate` deliberately implements, and no test would catch it.
- **Evidence:**

  `src/format.ts:91-100` — the inverse hand-rolls modulo arithmetic:
  ```ts
  export function endDateToDuration(startStr: string, endDateStr: string): string | null {
    const start = parseDateString(startStr) ?? new Date()
    const end   = parseDateString(endDateStr) ?? new Date()
    const days  = differenceInDays(end, start) + 1  // end date is inclusive
    if (days <= 0) return null
    if (days % 365 === 0) { const y = days / 365; return pluralize(y, 'year') }
    if (days % 30  === 0) { const m = days / 30;  return pluralize(m, 'month') }
    if (days % 7   === 0) { const w = days / 7;   return pluralize(w, 'week') }
    return pluralize(days, 'day')
  }
  ```
  while the forward direction in the same file uses calendar-correct `date-fns`:
  ```ts
    if (p.unit === 'months')  return fmtISO(inclusiveCalendarEnd(start, addMonths(start, p.n)))
  ```
  Measured by round-tripping both functions in a temporary vitest file (since removed) — **5 of 9 cases break**:
  ```
  BAD 2026-01-31 + "1 month"  -> 2026-02-28 -> "29 days"
  BAD 2026-02-01 + "1 month"  -> 2026-02-28 -> "4 weeks"
  BAD 2024-01-01 + "1 year"   -> 2024-12-31 -> "366 days"    (leap year)
  BAD 2026-06-01 + "3 months" -> 2026-08-31 -> "92 days"
  BAD 2026-06-01 + "2 years"  -> 2028-05-31 -> "731 days"
  ```
  `src/format.test.ts` tests `durationToEndDate` across seven cases including the Jan-31 clamp, but contains **zero** references to `endDateToDuration`.

- **Problem:** `DurationDialog`'s end-date picker silently rewrites a user's "3 months" as "92 days" on the next open, because the only calendar-aware duration inverse in the codebase assumes every month is 30 days and every year 365 — the exact assumption its own forward counterpart was written with `date-fns` to avoid.
- **Fix:** Re-implement `endDateToDuration` to try candidate calendar units against `durationToEndDate` (or `differenceInCalendarMonths`/`Years` plus the `inclusiveCalendarEnd` clamp) and return the first that reproduces the given end date, and add the round-trip cases above to `format.test.ts`.

---

### #4 — the global coverage floor has drifted 14 points below actual, and a shipped module already slipped through

- **Category:** `testing` `toolchain`
- **Impact:** 6
- **Breadth:** 3 files (`vitest.config.ts` plus the two `src/onboarding/` files at 0%; the floor itself governs all 326 source files)
- **Recommended model:** **Sonnet 5** — hazard: raise the global floor to a few points under measured (≈68/62/59/70), **not** to the measured value, or ordinary UI work trips the gate on every PR; and do not touch the ~30 per-file thresholds in the same pass, since several are deliberately set below measured for documented reasons (`rruleToRepeat.ts`, `db.ts`). Fails loudly (red CI) if overshot.
- **Evidence:**

  `vitest.config.ts` states the floor's purpose explicitly:
  ```
          // Global floor. Per-file thresholds only guard the files they name, so
          // a brand-new untested logic module used to slip through the gate
          // entirely. This catches that: adding a sizeable unexercised module
          // drags the project total below the floor and fails CI. Kept a few
          // points under the measured total so ordinary UI work doesn't trip it.
          statements: 57,
          branches: 54,
          functions: 48,
          lines: 59,
  ```
  Measured this run: `Statements : 71.05% ( 5689/8007 )`. The gap is 14 points, not "a few". Solving `5689 / (8007 + x) = 0.57` gives **x ≈ 1,974** — nearly 2,000 fully-uncovered statements, **24.6% of the current codebase**, can land before the floor fires.

  The mechanism has already failed once. `src/onboarding/` is at 0% across the board:
  ```
   src/onboarding    |       0 |        0 |       0 |       0 |
    CoachTour.tsx    |       0 |        0 |       0 |       0 | 7-107
    tourState.ts     |       0 |      100 |       0 |       0 | 1-8
  ```
  and it is not dead code — `src/routes/_app.tsx:13` does `import { CoachTour } from '@/onboarding'` and mounts it at line 236. A 162-line first-run onboarding flow ships to every new user with no test at all, and the gate the config says exists to catch exactly this stayed green.

- **Problem:** The global coverage floor no longer performs the function its own comment claims, so whole untested feature modules reach production without the gate noticing — as `src/onboarding/` demonstrates today.
- **Fix:** Raise the global thresholds to a few points under measured (≈68/62/59/70) so the floor tracks reality again, and add tests for `tourState.ts`'s localStorage guards and `CoachTour`'s step advance/dismiss paths.

---

### #5 — `model/AGENTS.md` names files and functions that no longer exist

- **Category:** `naming` `architecture` `dead-code`
- **Impact:** 5
- **Breadth:** 1 file (`src/model/AGENTS.md`, 324 lines, describing the 13-file `model/` module)
- **Recommended model:** **Haiku 4.5** if the task supplies the specific corrections (the four renames and the two dead paths, listed below); else **Sonnet 5**. A doc edit fails completely silently — nothing type-checks prose — so the tier is set by whether the diff is spelled out rather than by the editing itself.
- **Evidence:**

  The "Layering rules" table at the end of `AGENTS.md` routes two whole concerns to files that do not exist:
  ```
  | Persistence / Dexie cache | `src/meridian.ts` |
  | React state / store mutations | `src/App.tsx`, `src/store.ts` |
  ```
  `test -f` on both: **missing**. Persistence actually lives in `src/storage/cache/`; React state lives in `src/routes/` plus `src/store.ts`.

  The `storeOps.ts` section documents four functions under pre-`EntryKey`-migration names. Verified by grepping `src/model/` for each definition:

  | Documented name | Definitions found | Actual name today |
  |---|---|---|
  | `deleteByFileSlug` | 0 | `deleteByEntryKey` |
  | `fileSlugItems` | 0 | `entryKeyItems` |
  | `newEntrySlug` | 0 | `newEntryKey` |
  | `parseYamlToStoreItems` | 0 | removed |

  For example the doc still says:
  ```
  - `toggleDone`, `excludeOccurrence`, `deleteByFileSlug`, `deleteFollowing`
  ```
  whereas `src/model/index.ts` exports `deleteByEntryKey`. The remaining eight documented functions all check out, so the drift is specifically the `fileSlug` → `EntryKey` rename sweep not reaching this file.

- **Problem:** In a repo where CLAUDE.md and AGENTS.md are the primary onboarding surface for the agents doing the work, `model/`'s architecture doc sends a reader to two nonexistent files and four nonexistent function names, which is worse than no doc because it is confidently wrong.
- **Fix:** Apply the four renames, replace the two dead paths in the layering table with `src/storage/cache/` and `src/routes/` + `src/store.ts`, and drop the `parseYamlToStoreItems` bullet.

---

### #6 — the undici pin's own stated revisit condition has now been met

- **Category:** `dependencies` `security`
- **Impact:** 5
- **Breadth:** 2 files (`pnpm-workspace.yaml`, `package.json`)
- **Recommended model:** **Sonnet 5** — hazard: jsdom 30 is a major bump and the vitest `jsdom` environment must still boot, so the verdict is a green `pnpm run test:coverage` (which exercises every `// @vitest-environment jsdom` file), not merely a successful install. Fails loudly.
- **Evidence:**

  `pnpm-workspace.yaml` states the cap and its expiry condition in the same breath:
  ```
  # undici <7.29.0 has GHSA-4cwx-7wf7-3272 (cross-user info disclosure and
  # parse-time crash via degenerate private cache-control directives). Pulled
  # in transitively (dev-only) via jsdom (vitest/coverage-v8's DOM env), which
  # `require()`s undici's internal lib/handler/{wrap,unwrap}-handler.js paths —
  # those moved in undici 8, so the floor is capped below 8.0.0 to avoid a
  # MODULE_NOT_FOUND at jsdom import time; revisit once jsdom ships a release
  # built against undici 8.
  ```
  ```
    undici: ">=7.29.0 <8.0.0"
  ```
  Verified against the registry (not memory): `pnpm outdated` reports `jsdom 29.1.1 → 30.0.1`, and `npm view jsdom@30 dependencies.undici` returns:
  ```
  jsdom@30.0.0 dependencies.undici = '^8.7.0'
  jsdom@30.0.1 dependencies.undici = '^8.9.0'
  ```
  jsdom has shipped exactly the release the comment was waiting for.

- **Problem:** A `<8.0.0` cap written as a temporary workaround now holds the entire dev tree on the undici 7 line for a reason that has expired, and because the rationale is recorded only in a comment nothing will ever re-check it.
- **Fix:** Bump `jsdom` to `^30.0.1` in `package.json`, drop the `<8.0.0` half of the override to `undici: ">=8.9.0"`, and confirm with a green `pnpm run test:coverage`.

---

### #7 — the postcss advisory is missing from the overrides block that already pins its own sibling

- **Category:** `dependencies` `security`
- **Impact:** 4
- **Breadth:** 1 file (`pnpm-workspace.yaml`)
- **Recommended model:** **Haiku 4.5** — one line in an established block; an unsatisfiable floor fails loudly at install.
- **Evidence:**

  `pnpm audit --audit-level=moderate` on this commit:
  ```
  │ moderate            │ PostCSS: incomplete fix of GHSA-6g55-p6wh-862q —       │
  │                     │ attacker-controlled sourceMappingURL reads arbitrary   │
  │                     │ .map files when `from` is unset                        │
  │ Package             │ postcss                                                │
  │ Vulnerable versions │ <=8.5.22                                               │
  │ Patched versions    │ >=8.5.23                                               │
  │ Paths               │ .>@rolldown/plugin-babel>vite>postcss   (14 paths)      │
  ```
  CI gates at `pnpm audit --audit-level=high`, so this never fires there. The repo already pins six dev-only transitive advisories in exactly this shape — and the `nanoid` entry is pinned *because of* postcss:
  ```
  # nanoid <3.3.17 has GHSA-2v37-7h3g-55p8 (custom generators loop indefinitely
  # when size is zero). Pulled in transitively (dev-only) via postcss, itself a
  # dependency of vite.
  ```
  So postcss is already a known node in this dependency path; only its own advisory is unpinned.

- **Problem:** An established, deliberate supply-chain practice — pin every dev-only transitive advisory with a comment explaining it — has one gap, and the CI gate's `high` threshold guarantees nothing will surface it.
- **Fix:** Add `postcss: ">=8.5.23"` to the `overrides` block with the customary comment; optionally lower the CI audit gate to `--audit-level=moderate` so the pattern is enforced rather than remembered.

---

### #8 — `.npmrc` comment contradicts the value directly beneath it

- **Category:** `toolchain`
- **Impact:** 2
- **Breadth:** 1 file (`.npmrc`)
- **Recommended model:** **Haiku 4.5** — hazard: the judgment is *which* half is wrong. Flipping the value to `true` risks breaking `pnpm install` on React 19 peer ranges across the Radix/CodeMirror tree, so the safe fix is correcting the comment to match the value, not the reverse. State that in the task.
- **Evidence:**

  `.npmrc`:
  ```
  # Raise an error (not just a warning) when a peer-dep requirement can't be satisfied.
  strict-peer-dependencies=false
  ```
  Every other setting in this file has a comment that accurately describes it; this one asserts the exact opposite of what it configures.

- **Problem:** A reader (human or agent) trusting the comment believes unsatisfiable peer dependencies fail the install, when in fact they are silently downgraded to warnings — the kind of false assurance that gets acted on during a dependency bump.
- **Fix:** Rewrite the comment to state that peer-dep conflicts warn rather than error, and why that is deliberate here.

---

### #9 — a 639 KB `public/icon.png` ships in every deploy as a dead asset

- **Category:** `performance` `dead-code`
- **Impact:** 2
- **Breadth:** 1 file (`public/icon.png`)
- **Recommended model:** **Haiku 4.5** — hazard: it must be **moved**, not deleted. `scripts/process-icon.mjs` reads it as its build-time source, and deleting it silently breaks icon regeneration with no test or gate to notice. Name the script in the task.
- **Evidence:**

  Its only reference in the repo is as a build-time input — `scripts/process-icon.mjs:14`:
  ```js
  const { data, info } = await sharp('public/icon.png')
  ```
  Nothing consumes it at runtime. `index.html` references only `icon-512.png`, `icon-192.png`, and `icon-180.png`; the PWA manifest lists only 192 and 512; and the generated `dist/sw.js` precache manifest contains exactly two icon entries:
  ```
  "icon-192.png"
  "icon-512.png"
  ```
  But because it lives in `public/`, Vite copies it verbatim into the deploy artifact — `ls -la dist/` shows `639342` bytes, **21% of the 3.0 MB `dist/`**.

- **Problem:** A build-time source asset sits in the runtime-assets directory, so every deploy uploads and every GitHub Pages artifact carries 639 KB that no user, service worker, or manifest ever requests. (User-facing load time is unaffected — it is never fetched — which is why the impact is 2 rather than higher.)
- **Fix:** Move `icon.png` out of `public/` (e.g. to `assets/icon.png` or `scripts/icon.png`) and update the `sharp()` path in `scripts/process-icon.mjs` to match.

---

## Survey file updated

`plans/surveys/health.md` was edited in a separate commit with process
improvements from this run — chiefly that the Budget section should require
running the package manager's **audit** alongside the other gates (the postcss
finding surfaced only because I ran it at a lower threshold than CI does), that
"quality gates" should name **which workspace** each gate covers (finding #1 is
exactly the failure mode of assuming a root gate covers a monorepo), and that
the Output structure should ask for the **gate-vs-workspace matrix** explicitly.
See that commit's diff for the exact wording.
