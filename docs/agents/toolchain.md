# Toolchain gotchas

## Lint needs generated types

The type-aware lint rules (`no-unsafe-*`, etc.) resolve types from
**gitignored generated files**. On a fresh worktree these don't exist yet, so
`pnpm run lint` reports a flood of spurious "type that cannot be resolved" /
"error typed value" errors. The code is fine; the types just haven't been
generated. Don't hand-fix these or add `eslint-disable`s. Run
`pnpm run build` first, which regenerates both:

- `src/routeTree.gen.ts` (TanStack Router). Without it, `Route.useSearch()` /
  `useParams()` resolve to `any` and `src/` lint fails.
- `worker/worker-configuration.d.ts` (wrangler types, via the worker's
  `pretypecheck`). Without it, `Request`/`Response`/`HeadersInit`/`Env`
  resolve to `any` and **all** of `worker/src` lint fails (~150 errors).

CI does exactly this before linting (`.github/workflows/build.yml`).

## `worker/` is its own workspace

`worker/` is a separate pnpm workspace package with its own `tsconfig.json`
and `vitest.config.ts`. It is **not** covered by the root `tsc -b` project
references or the root `vitest` config. Root `pnpm run build` and
`pnpm run test` fan out to it explicitly
(`pnpm --filter meridian-oauth-worker run typecheck` / `run test`), so both
gates cover `worker/` too. Don't widen the root `vitest.config.ts` `include`
glob or `tsconfig.json` references to reach it instead: worker tests would then
incorrectly inherit the root's `setupFiles` and `@` alias.

## TypeScript is pinned to 6.0.x

`typescript` is intentionally pinned below the TS 7 major in both the root
`package.json` and `worker/package.json`. `typescript-eslint` refuses to run
against TS 7 (`eslint` exits with `typescript-eslint does not support TS
7.0`). `vite build`/`tsc -b` are fine under TS 7; only the lint step breaks.
Tracked upstream: https://github.com/typescript-eslint/typescript-eslint/issues/10940
(support for TS ≥7.1).

Re-check with a fact, not a version number. The durable check is the peer
range typescript-eslint declares:

```bash
npm view @typescript-eslint/typescript-estree@latest peerDependencies.typescript
```

Last checked 2026-10-29: `>=4.8.4 <6.1.0` at both 8.65.0 and 8.72.1 (npm
latest), against TypeScript 7.0.2. While that upper bound stays below 7, the
pin stands; don't attempt the bump.
