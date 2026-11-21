# Survey overlay

Read by the workshop's `surveys` skill and `survey-retro`.

## Gates

`pnpm run check` runs every CI step (build, lint, `test:coverage` with its coverage-floor ratchet, knip; e2e excluded). The configuration lives in `package.json` scripts, `.github/workflows/build.yml`, `eslint.config.js`, `.dependency-cruiser.mjs` and `.github/pull_request_template.md`.

## Environment limits

- **Generate the gitignored types before trusting lint.** On a fresh worktree run `pnpm install`, then `pnpm run build` (generates `src/routeTree.gen.ts` and the worker types). Without them the type-aware rules report ~150 spurious errors that are not a finding. See `CLAUDE.md`'s linting section.
- **Only the example (Tutorial) backend is reachable.** The automated browser can't grant File System Access permissions or complete the GitHub OAuth flow, so the local-FS and GitHub backends can only be traced statically or through their unit tests.
- **A large vault already exists, so don't write a generator.** It is `src/storage/devFixtures/testVaultGen.ts`: run `localStorage.setItem('meridian_bigvault', '300')` in the console, reload the Tutorial vault, and note the size in the coverage statement. It is dev-only (`import.meta.env.DEV`) and absent from production builds.
- **Browser setup** for the workshop `surveys` skill's Playwright fallback: start the server with `pnpm exec vite --port <unique> --strictPort` (served at `/`, see `docs/agents/dev-server.md`), and in an init script set `meridian_theme` to reach each palette and `meridian.tourDone`, or the tour's controls pollute every measurement.
- `CLAUDE.md`'s rule against driving the dev server unprompted doesn't apply to a survey that needs a measurement or screenshot pass.

## Health scope

src ":!src/**/*.test.*" ":!src/test-utils"

## Health corpora

Alternate between runs; the run names its corpus in the first line of its coverage statement.

- **src:** `src ":!src/**/*.test.*" ":!src/test-utils"`. "Largest file" ranks non-test, non-generated sources.
- **tests:** `"src/**/*.test.*" src/test-utils e2e`. "Largest file" ranks test files; the toolchain is the test config, helpers and fixtures, and production modules are context, not the thing surveyed.

## Health budget

Meridian specifics for the shared Budget and Process.

- **Coverage floors are machine-checked.** `src/coverageConfig.test.ts` (run by `pnpm run test:coverage`) fails when a per-file or global floor sits more than 10 points under measured coverage, when a threshold key names a missing file, or when a `src/routes/` coverage exclusion exceeds 100 lines. Report its pass/fail in the gate matrix and spend the budget on what it can't see:
  - a file with no threshold key at all (an unguarded integrity-critical file such as `src/storeCommit.ts`);
  - an `exclude` glob outside `src/routes/`, which isn't size-checked (`src/components/ui/**` is excluded on authorship, deliberately);
  - whether the guard's own constants (10-point tolerance, 100-line bound) still fit.
- **Chunk markers** for the built-chunk check: `cm-content` (CodeMirror), `rdp-` (react-day-picker), `Dexie`, `embla`.
- **Layout coverage:** `e2e/layout-smoke.spec.ts`'s `findUncoveredRoutes()` already fails CI for an unlisted route, so a `CLAUDE.md` claim that nothing enforces route listing is stale. Verify the name before citing it.
- **Flaky tests:** `vitest.config.ts` pins a non-UTC `TZ` (#1429); check it is still non-UTC.
- **Finding categories:** `architecture`, `overengineering`, `srp` and `types` have no repo label and an agent cannot create one, so name those tags in the body, as applying a missing label fails the whole issue create.
