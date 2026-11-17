# Survey overlay

Read by the workshop's `surveys` skill and `survey-retro`.

## Gates

`pnpm run check` runs every CI step (build, lint, `test:coverage` with its coverage-floor ratchet, knip; e2e excluded). The configuration lives in `package.json` scripts, `.github/workflows/build.yml`, `eslint.config.js`, `.dependency-cruiser.mjs` and `.github/pull_request_template.md`.

## Environment limits

- **Generate the gitignored types before trusting lint.** On a fresh worktree run `pnpm install`, then `pnpm run build` (generates `src/routeTree.gen.ts` and the worker types). Without them the type-aware rules report ~150 spurious errors that are not a finding. See `CLAUDE.md`'s linting section.
- **Only the example (Tutorial) backend is reachable.** The automated browser can't grant File System Access permissions or complete the GitHub OAuth flow, so the local-FS and GitHub backends can only be traced statically or through their unit tests.
- **A large vault already exists, so don't write a generator.** It is `src/storage/devFixtures/testVaultGen.ts`: run `localStorage.setItem('meridian_bigvault', '300')` in the console, reload the Tutorial vault, and note the size in the coverage statement. It is dev-only (`import.meta.env.DEV`) and absent from production builds.
- `CLAUDE.md`'s rule against driving the dev server unprompted doesn't apply to a survey that needs a measurement or screenshot pass.
