# Import cycles

Plan for eliminating the module-boundary import cycles found by auditing the
codebase, prompted by a placement smell noticed while reviewing PR 3 of
`plans/archived-entries.md`. Written 2026-09-04.

Per `plans/CLAUDE.md`: delete each fix's section from this file in the commit
that implements it, so what remains is only outstanding work.

---

## How this was found, and why `import-x/no-cycle` isn't the tool

The obvious first move — enable `eslint-plugin-import-x`'s `import-x/no-cycle`
rule (the plugin is already a dependency, used for `no-restricted-paths`) —
doesn't work in this project. Verified, not assumed: a synthetic two-file
cycle (`A` imports `B` imports `A`, both real value imports) went undetected
under this repo's actual `eslint.config.js`. Bisected by ablation:

| Setup | Detects a real cycle? |
|---|---|
| Plain files, default resolver, no custom parser | yes |
| `.ts` files, `@typescript-eslint/parser`, no custom resolver | no |
| `.ts` files, TS parser, TS path-alias resolver (`resolver` **or** `resolver-next`) | no |

The resolver itself isn't broken — `import-x/no-unresolved` confirms both
files resolve fine under the same config. `no-cycle` specifically stops
closing the loop once a custom resolver is involved: it closes a cycle by a
strict string match between ESLint's `context.physicalFilename` and the
resolved path the resolver hands back for the same file, and a custom
resolver's path normalisation is enough to break that match. Since nearly
every internal import in this codebase goes through the `@/` alias — which
*requires* the TS resolver to resolve at all — enabling `no-cycle` here would
pass cleanly while remaining blind to nearly everything, which is worse than
not having it: false confidence instead of an honest gap. Not pursued further
in this plan; getting `no-cycle` trustworthy here (a resolver-version bump,
or an upstream report) is a separate, lower-priority yak-shave from the
actual cleanup.

Used `madge --circular --ts-config tsconfig.app.json` instead — a standalone
whole-graph tool, not an ESLint rule, so it doesn't share this failure mode.

## The raw findings, collapsed

`madge` reported 41 circular-dependency chains. That number is misleading on
its own: madge reports every distinct path that re-enters a cycle, not one
row per structurally-distinct cycle, so a single tangled cluster produces
dozens of near-duplicate rows. Collapsing the 41 chains to their cross-module
edges (script: build a directed edge for every adjacent pair in every chain,
keep only edges that cross a top-level `src/` directory) gives the real
picture — four independent things, not 41:

1. **The big one — `routes ↔ editor`, `routes ↔ hooks`, which pulls
   `calendar` and `components` into the same strongly-connected cluster.**
   Root cause: `src/routes/-entryRoute.ts` holds three pure URL-shape
   builders (`newEntryRoute`, `entryRoute`, `keyRoute`) that live inside the
   `routes/` module only because that's where TanStack Router's file-based
   convention put the route *components* — but the three functions
   themselves touch no React, no live router state, nothing that needs to be
   there. `editor/` (3 files), `hooks/useOpenEntry.ts`, and
   `components/SearchBar.tsx` + `Sidebar.tsx` all need them, and importing
   `@/routes` for that is what creates the back-edges — `routes/` legitimately
   imports every one of those four modules to compose its pages, so the
   moment any of them imports back, the two are mutually reachable.
   **This is the fix below.**

2. **`components ↔ search`** — `components/SearchBar.tsx` lazy-loads
   `search/SearchOverlay.tsx` via `import()`; `search/FileResultsList.tsx`
   statically imports `OccurrenceCard` back from `@/components`. Real, but
   not a placement mistake: one leg is a dynamic import (no load-time
   hazard — this is exactly the shape `no-cycle`'s own
   `allowUnsafeDynamicCyclicDependency` option exists to wave through), and
   it's the same feature-mesh shape invariant 4 in `CLAUDE.md` already
   accepts. **Left alone** — see that invariant, updated below to name this
   cycle as its example instead of the stale one fix 1 removes.

3. **`calendar/agendaSections.ts ↔ overduePool.ts`,
   `storage/cache/db.ts ↔ pendingMoves.ts`** — not actually cycles. Both are
   `import type` in one direction, which TypeScript erases; there's no
   runtime circularity, just two files whose *types* reference each other.
   Same-module in both cases. **Not a target** — `no-cycle` itself would
   skip these (it explicitly ignores type-only imports), and correctly so.

4. **`storage/sync.ts ↔ storage/syncScheduler.ts`** — genuine runtime
   cycle: `sync.ts` calls `scheduleAutoPush` from `syncScheduler.ts`;
   `syncScheduler.ts` calls `runSync` back from `sync.ts`. Same module, so
   not a boundary violation, but real. **Deferred — see below.**

---

## Fix: `storage/sync.ts ↔ storage/syncScheduler.ts`

Not yet investigated beyond confirming the two call sites
(`sync.ts:33` calls `scheduleAutoPush`; `syncScheduler.ts:20` calls
`runSync`). Likely shape: have whichever side is the "driver" take the
other's function as a parameter/callback rather than importing it back, but
this needs reading both files' actual responsibilities first — don't assume
that shape is right before checking which direction the dependency should
conceptually run. Same-module, so lower priority than fix 1 (no lint rule
flags it, and `no-cycle`'s existing "don't restructure a whole SCC on a
hunch" caution applies even more to a 2-file same-module case): pick this up
after fix 1, as its own commit.

---

## Reference: what stays as-is

For anyone re-running this audit later and wondering why these don't have
sections above:

- **`components ↔ search`** (finding 2) — accepted, see invariant 4.
- **`agendaSections.ts ↔ overduePool.ts`, `cache/db.ts ↔ pendingMoves.ts`**
  (finding 3) — type-only, not runtime cycles, nothing to fix.
