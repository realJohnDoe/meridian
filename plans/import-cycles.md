# Import cycles

Plan for eliminating the module-boundary import cycles found by auditing the
codebase, prompted by a placement smell noticed while reviewing PR 3 of
`plans/archived-entries.md`. Written 2026-09-04.

Per `plans/CLAUDE.md`: delete each fix's section from this file in the commit
that implements it, so what remains is only outstanding work.

**The `routes ↔ editor ↔ hooks` fix has shipped** — `newEntryRoute`/
`entryRoute`/`keyRoute` moved from `routes/-entryRoute.ts` to the new root
file `src/entryRoute.ts` (see `CLAUDE.md`'s root-residents list and
invariant 4). `routes/index.ts` is gone too: those three functions were its
entire public surface, so once they moved, nothing needed a `routes/`
barrel at all — confirmed by checking every consumer of `@/routes` first.
Re-running the audit after the fix (41 → 6 raw chains) surfaced a cycle that
had been sitting inside that tangle all along, invisible while a bigger SCC
subsumed it: **`calendar ↔ components`** (`AgendaRow.tsx`/
`AgendaOverdueGroupRow.tsx` use `OccurrenceCard`; `SearchBar.tsx` uses
`useCurrentDate`). Real, but the same accepted feature-mesh shape invariant 4
already named an example of — now the example, since the one it used to cite
(`calendar → components → editor → routes → calendar`) doesn't exist as a
cycle anymore.

What's left: `storage/sync.ts ↔ storage/syncScheduler.ts`, below.

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
whole-graph tool, not an ESLint rule, so it doesn't share that failure mode.
It has its own gap to know about, hit while building the fix above: **it
does not skip `import type`.** `entryRoute.ts`'s first draft imported
`type { NewEntrySeed } from '@/editor'` — erased at runtime, so not a real
cycle — and madge counted it as one anyway, because it builds the *file*
graph, not the *runtime* one. Fixed by giving `entryRoute.ts` its own local,
structural type for the handful of fields it reads, rather than importing
editor's. Point of this note: don't take a madge cycle at face value when
one leg is `import type` — check whether it's erased before spending time on
it, the way findings 3/5 below turned out to be.

## The raw findings, collapsed

`madge` reported 41 circular-dependency chains before the fix. That number
was misleading on its own: madge reports every distinct path that re-enters
a cycle, not one row per structurally-distinct cycle, so a single tangled
cluster produces dozens of near-duplicate rows. Collapsing the 41 chains to
their cross-module edges (build a directed edge for every adjacent pair in
every chain, keep only edges that cross a top-level `src/` directory) gave
the real picture — four independent things, not 41 (a fifth,
`calendar ↔ components`, was hiding inside finding 1 and only became visible
after fixing it — see the top of this file):

1. **`routes ↔ editor`, `routes ↔ hooks`, pulling `calendar` and
   `components` into the same strongly-connected cluster. Fixed**, see
   above.

2. **`components ↔ search`** — `components/SearchBar.tsx` lazy-loads
   `search/SearchOverlay.tsx` via `import()`; `search/FileResultsList.tsx`
   statically imports `OccurrenceCard` back from `@/components`. Real, but
   not a placement mistake: one leg is a dynamic import (no load-time
   hazard — this is exactly the shape `no-cycle`'s own
   `allowUnsafeDynamicCyclicDependency` option exists to wave through), and
   it's the same feature-mesh shape invariant 4 in `CLAUDE.md` accepts.
   **Left alone.**

3. **`calendar/agendaSections.ts ↔ overduePool.ts`,
   `storage/cache/db.ts ↔ pendingMoves.ts`** — not actually cycles. Both are
   `import type` in one direction, which TypeScript erases; there's no
   runtime circularity, just two files whose *types* reference each other
   (the same class of madge false-positive `entryRoute.ts` hit while
   building the fix — see above). Same-module in both cases. **Not a
   target** — a correctly-working `no-cycle` would skip these too, since it
   explicitly ignores type-only imports.

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
conceptually run. Same-module, so lower priority than the fix above (no lint
rule flags it, and a 2-file same-module cycle is a smaller, more contained
thing to get wrong than a cross-module one): its own commit, separate from
everything above.

---

## Reference: what stays as-is

For anyone re-running this audit later and wondering why these don't have
sections above:

- **`calendar ↔ components`** — accepted, now invariant 4's own example.
- **`components ↔ search`** (finding 2) — accepted, see invariant 4.
- **`agendaSections.ts ↔ overduePool.ts`, `cache/db.ts ↔ pendingMoves.ts`**
  (finding 3) — type-only, not runtime cycles, nothing to fix.
