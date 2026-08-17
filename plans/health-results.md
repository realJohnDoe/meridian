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
tests only ever execute in a separate CI job.

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
| Audit | `pnpm audit --audit-level=high` | **pass** (1 moderate advisory below the gate at run time, since fixed) |

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
low-churn, which is part of why its toolchain gap had gone unnoticed.

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Architecture & Domain Separation | **clean** — full import-graph scan; zero cross-module deep imports, `model/` purity and the persistence port both hold |
| 2 | Simplicity & Overengineering | **clean** — every port, optional prop, and config knob checked for a second real caller; all passed |
| 3 | Directory & File Layout | **clean** — barrels consistent, `lib/` residents each have 2+ consumers, no co-change/distance mismatch in the 60-day sample |
| 4 | Security | **clean** — SSRF guards, CSP, CORS, and token storage all reviewed; no XSS/injection surface |
| 5 | Testing & Error Handling | **clean** |
| 6 | Code Health & DRY | **clean** |
| 7 | Toolchain & Developer Feedback Loops | findings: **#8** |
| 8 | Dependencies & Library Fit | **clean** — the one dependency finding from this run has been fixed |
| 9 | Styling & UX | **clean** — no bypassed shadcn components, no `onClick` on non-interactive elements, inline styles confined to virtualizer/positioning transforms |
| 10 | Performance | findings: **#9** |

## 4. Findings

### Summary table

| # | Finding | Impact | Breadth | Recommended model | Score |
|---|---|---|---|---|---|
| 8 | `.npmrc` comment contradicts its own setting | 2 | 1 | Haiku 4.5 | 2.0 |
| 9 | 639 KB `public/icon.png` ships as a dead asset | 2 | 1 | Haiku 4.5 | 2.0 |

Findings are numbered and listed in `(impact × breadth) ÷ effort` order.

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
"quality gates" should name **which workspace** each gate covers (the `worker/`
toolchain gap found in this run is exactly the failure mode of assuming a root
gate covers a monorepo), and that
the Output structure should ask for the **gate-vs-workspace matrix** explicitly.
See that commit's diff for the exact wording.
