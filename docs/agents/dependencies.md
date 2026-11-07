# Dependency notes

## TypeScript pinned to 6.0.x

`typescript` is intentionally pinned below the TS 7 major in both `package.json` (root) and `worker/package.json`. `typescript-eslint` hard-refuses to run against TS 7: `eslint` exits with `typescript-eslint does not support TS 7.0`. `vite build`/`tsc -b` themselves are fine under TS 7 — only the lint step breaks. Tracked upstream: https://github.com/typescript-eslint/typescript-eslint/issues/10940 (support for TS ≥7.1).

**Re-check with a fact, not a version number.** This paragraph used to say "even at latest, 8.65.0", which stopped being true the moment 8.66 shipped and made the whole rationale look stale. The durable check is the peer range typescript-eslint declares:

```bash
npm view @typescript-eslint/typescript-estree@latest peerDependencies.typescript
```

Last checked 2026-10-29: `>=4.8.4 <6.1.0` at both 8.65.0 and 8.72.1 (npm latest), against TypeScript 7.0.2. While that upper bound stays below 7, the pin stands — don't attempt the bump.
