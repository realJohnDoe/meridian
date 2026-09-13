# Agent guidelines for Meridian

## Before implementing

Before starting work on an issue, feature or bug fix, check whether
architectural issues are making the implementation harder than it needs to be
(a misplaced file, a missing abstraction, a boundary violation). Fix those
first, then implement the requested change on top.

## Implementation decisions

When a decision isn't covered by this doc or explicitly discussed with the user,
default to industry standards rather than inventing a bespoke approach.

## Package manager

This project uses **pnpm**. Always `pnpm` — never `npm` or `yarn`; `npm install`
creates a `package-lock.json` that must not be committed.

```bash
pnpm install           # in a new worktree
pnpm add <package>
pnpm run build
```

## Git workflow

Once the first changeset of a session has been applied and verified (build/lint
passing), commit and push it to a feature branch right away — don't wait for an
explicit "commit and push" each time, and keep doing the same for subsequent
changesets.

After changing any files, check whether an open PR already covers the current
branch; if not, open one. Once a PR is open, watch it for CI failures and fix
them.

## Dev server base path

The app is served under `/meridian/`, not `/`. When using preview tools or
navigating programmatically, always use that base path:

```
http://localhost:5173/meridian/
http://localhost:5173/meridian/entry/<vaultId>/<fileSlug>
```

`pnpm dev` defaults to port 5173 but may bind elsewhere if that's taken.

An entry lives at its own route, not a search param on the agenda: the URL
carries the two halves of its `EntryKey` as separate path segments, so the
Tutorial vault (id `example`) has its first note at
`/meridian/entry/example/01-start-here`. Search params: `date` (YYYY-MM-DD,
pins which occurrence of a series), `id` (the occurrence's stable id, breaking
ties when two occurrences of one file land on the same date), and `scope`
(`single`/`future`/`all`/`add`). `/meridian/entry/<fileSlug>` still redirects to
the loaded vault. New entries are `/meridian/entry/new`, with `title`, `date`,
`time`, `duration`, `itemType` and `vault` search params — `vault` overrides
`defaultVaultId` for that entry, and is what the editor's vault chip sets.

## Build verification

Always use `pnpm run build` (which runs `tsc -b`) to verify the full build —
**not** `tsc --noEmit` alone. `--noEmit` runs in single-file mode and misses
unused-import errors and stricter checks the composite project build enforces.
CI runs `pnpm run build`, so failures show up there even when `--noEmit` is
clean.

`worker/` is a separate pnpm workspace with its own `tsconfig.json` and
`vitest.config.ts` — **not** covered by the root `tsc -b` project references or
the root `vitest` config. Root `build` and `test` fan out to it explicitly
(`pnpm --filter meridian-oauth-worker run typecheck` / `run test`), so both
gates cover it; don't widen the root `vitest.config.ts` `include` glob or
`tsconfig.json` references to reach it instead, since worker tests would then
inherit the root's `setupFiles` and `@` alias.

## Linting (generated types must exist first)

The type-aware lint rules (`no-unsafe-*`, etc.) resolve types from **gitignored
generated files**. On a fresh worktree these don't exist, so `pnpm run lint`
reports a flood of spurious "type that cannot be resolved" / "error typed value"
errors — the code is fine, the types just aren't generated. **Don't hand-fix
these or add `eslint-disable`s.** Generate them first:

```bash
pnpm run build                                          # src/routeTree.gen.ts (TanStack Router)
pnpm --filter meridian-oauth-worker run cf-typegen      # worker/worker-configuration.d.ts
```

CI does exactly this before linting (`.github/workflows/build.yml`), which is
why it stays green. The two known offenders: without `src/routeTree.gen.ts`,
`Route.useSearch()`/`useParams()` resolve to `any` and `src/` lint fails;
without `worker/worker-configuration.d.ts`, `Request`/`Response`/`HeadersInit`/
`Env` resolve to `any` and **all** of `worker/src` fails (~150 errors).

### Two gates, not one

`pnpm run lint` is `eslint … && pnpm run lint:deps`. ESLint is per-file: it
enforces the module boundaries (invariants 1–3, 5) by asking of each import in
isolation "is this file allowed to import that one". `lint:deps` is
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser), which
builds the whole `src/` module graph first and then asks the question no single
file can answer — today just invariant 4's "is there a cycle". `import type`
counts as an edge, so type-only loops fail too. Config and reasoning:
`.dependency-cruiser.mjs`. It reads the same `tsconfig.app.json` path aliases as
vite and tsc, so it needs `src/routeTree.gen.ts` for the same reason the
type-aware rules do. Run it alone with `pnpm run lint:deps`;
`pnpm exec depcruise src --output-type dot | dot -Tsvg > graph.svg` draws the
graph.

## TypeScript pinned to 6.0.x

`typescript` is intentionally pinned below the TS 7 major in both `package.json`
and `worker/package.json`. `typescript-eslint` hard-refuses to run against TS 7
(`eslint` exits with `typescript-eslint does not support TS 7.0`).
`vite build`/`tsc -b` are fine under TS 7 — only the lint step breaks. Tracked
upstream: https://github.com/typescript-eslint/typescript-eslint/issues/10940.

**Re-check with a fact, not a version number.** This paragraph used to say "even
at latest, 8.65.0", which stopped being true the moment 8.66 shipped and made
the whole rationale look stale. The durable check is the peer range
typescript-eslint declares:

```bash
npm view @typescript-eslint/typescript-estree@latest peerDependencies.typescript
```

Last checked 2026-09-13: `>=4.8.4 <6.1.0` at 8.70.0 (npm latest), against
installed TypeScript 6.0.3. While that upper bound stays below 7, the pin
stands — don't attempt the bump.

## Domain vocabulary

`GLOSSARY.md` (repo root) is the ubiquitous language: which word to reach for
when two are close enough to confuse (`hasRemote` vs `readOnly`, `view-only` vs
`sandbox`, the two meanings of `items`, which of the three occurrence renderers
a context wants), plus a table of retired names so a stale doc or old commit
message can be translated forward. Read it before naming anything new.

It is an **index, not an encyclopedia** — each entry is one sentence plus a
pointer at the authoritative definition in code, which stays where it lives
(`src/types.ts` doc comments, `src/model/AGENTS.md`). Do not restate behaviour
there. `src/glossary.test.ts` enforces this: every referenced file must exist,
every referenced symbol must still be declared, and no retired name may come
back. **A rename therefore has to update `GLOSSARY.md` or the test suite
fails** — that is the point, and it is why entries name symbols rather than
describe them.

## Directory structure

**Placement rule:** a file moves into a subdirectory only when every caller
already lives in that subdirectory (or a layer that naturally depends on it). Do
not propose moving a file because it "feels" like it belongs somewhere — check
the actual import graph first.

| Directory | Scope |
|---|---|
| `model/` | Temporal/occurrence domain logic and YAML round-trip (expansion, collapse, inheritance, repeat, store ops). **Not** general file I/O or markup parsing. |
| `storage/` | Backend abstraction (local FS, GitHub, example), IndexedDB cache, sync, vault registry, toast notifications. |
| `editor/` | CodeMirror editor, entry UI, dialogs, save logic. |
| `calendar/` | Day/month/agenda views and occurrence rendering. |
| `settings/` | The settings screens — general preferences, theme picker, vault list, each vault's own screen, the add-vault wizard. Reached by route (`/settings/…`), not as a modal. |
| `components/` | Shared React components. See the two primitive layers and the leaf rule below. |
| `hooks/` | Shared React hooks. |
| `routes/` | TanStack Router route definitions, plus the `-`-prefixed files (excluded from route generation) a route composes: the topbars, and the `_app` shell's `-appSidebar.tsx`/`-searchBar.tsx`. This is the top of the graph — nothing imports `routes/` — so it is where a composite reaching across several feature modules belongs. |

**Inside `components/`.** Two primitive layers sit below it: `components/ui/` is
a faithful mirror of the **shadcn registry** — only files the shadcn CLI wrote,
never hand-written ones — and `components/primitives/` holds **our own** shared
primitives (`IconButton`, `ResponsiveModal`, `SurfaceButton`, …). This split is
load-bearing: `vitest.config.ts` excludes `components/ui/**` from coverage as
boilerplate, `knip.json` ignores its unused exports/types, and `shadcn diff`
compares that directory against upstream. `components/primitives/` is
deliberately covered by none of those exemptions — do not add it to them. A
first-party primitive used by only one feature dir belongs in that feature dir.
**Leaf layer:** the feature dirs import `components/`, so nothing here may
import a feature module back (`@/calendar`, `@/editor`, …) — that is a cycle
(invariant 4). A component needing one is a shell composite, and belongs beside
whatever mounts it.

**Root-level files are intentionally cross-cutting** — imported by three or more
unrelated layers, with no single owning directory. The deliberate residents:

- `types.ts` — pure domain type declarations, plus the four `isX`
  discriminated-union guards that belong beside their unions (`isSeries`,
  `isStandaloneOcc`, `isTracked`, `isEditScope`). No runtime registries or
  logic; the YAML field-parse registry that used to live here is
  `model/fieldRegistry.ts`, private to `model/` since every consumer is there.
- `vaultRef.ts` — the `VaultRef`/`VaultKind`/`GitHubVaultRef` family; a root
  leaf rather than `storage/` because `components/` is barred from importing
  `@/storage` at all (invariant 2), and `@/vaultActions` re-exports `VaultRef`
  for it.
- `store.ts` + `storeBridge.ts` — Zustand store for durable, cross-cutting state
  (vault data, sync status, favorites, prefs); `storeBridge` is imported by
  `storage/`, `editor/`, `occurrenceActions.ts` and `storeCommit.ts`.
  View-local ephemeral state does not belong here — invariant 5.
- `fileIO.ts` — YAML/frontmatter parse+serialize, the path↔slug mapping, and the
  branded `EntryKey` (`${vaultId}::${fileSlug}`) that composes with it; used by
  `debug/`, `editor/`, `model/`, `storage/`. `EntryKey` lives here rather than
  in a new root file precisely because `model/` may import `fileIO.ts`
  (invariant 1) and this module already owns the identity mapping.
- `wikilinks.ts` — wikilink parse+resolve; used by `editor/`, `model/` and root.
  Resolution is **per vault** — files store a bare `[[slug]]`, so
  `resolveWikilink` takes the linking file's vaultId and `buildResolveIndex`
  partitions by it.
- `occurrenceActions.ts` — user-action orchestration, including its delete-undo
  toast; used by `editor/` and `calendar/`.
- `storeCommit.ts` + `persistencePort.ts` — the persistence-port abstraction
  (invariant 3); used by `editor/`, `storage/` and `occurrenceActions.ts`.
- `autoSaveFlushPort.ts` — the open entry editor's pending-autosave flush port;
  a root leaf for the same reason as `persistencePort.ts` — `routes/__root.tsx`
  must call it at page teardown without statically importing the `@/editor`
  barrel (and with it, CodeMirror) into every route's entry chunk.
- `vaultActions.ts` — used by `components/` and `routes/`.
- `entryRoute.ts` — `newEntryRoute`/`entryRoute`/`keyRoute`, the pure TanStack
  Router Link/navigate descriptor builders for an entry; used by `editor/`,
  `hooks/useOpenEntry.ts` and `routes/`. A root leaf rather than
  `routes/-entryRoute.ts` (where it used to live) because `routes/` imports all
  three of those to compose its pages — a feature dir importing it back from
  `routes/` created a real cycle.
- `format.ts`, `fileOccurrence.ts`, `occView.ts` — view-model helpers, each used
  by three or more feature dirs. `occView.ts` also owns the display vocabulary:
  `OccState` (what an occurrence is, derived by its own `occState()`) and the
  painting layer on top of it — `OccHue`/`OccTone`, the `colorBy` preference,
  and the `OccPainter` that resolves both plus the card's one chip (bound to the
  store by `hooks/useOccPainter.ts`).

All feature directories already have `index.ts` barrels enforced by the
import-boundary lint rules — do not propose adding them.

## Route shells

There are two layout chains under `routes/`, and which one a route belongs to is
decided by **what the route contains**, not by whether it feels like a
"destination".

| Shell | Routes | For |
|---|---|---|
| `_app` — one screen tall, clips itself | `_app.*` (agenda, day/week/month, backlog, notes) | Routes with **virtualized lists**. `useVirtualizer` is element-scoped via `getScrollElement`, so the scroller must be an element, not the document. |
| Document flow | `_entry.*`, `settings.*`, `auth.*` | Routes with **text inputs and no virtualizer**. The document can grow, so the browser lifts a focused input above the on-screen keyboard natively, on every platform. |

Put a route with text inputs under `_app` and it gets neither: `_app` caps its
height so the document can never scroll, so there is no native keyboard
avoidance *and* nothing to scroll the field into view within — it sits behind
the keyboard. The failure is silent, mobile-only, and invisible to every test in
`src/`, since jsdom has no layout engine. This has been got wrong twice: the
entry routes started on the app chain, which is why keyboard avoidance was
hand-rolled across six surfaces before `3de767a` addressed the cause rather than
the symptom, and `/settings` then repeated it (PR #840, fixed in #844).

Nothing enforces *placement* — the filename is the whole declaration
(`_app.foo.tsx` vs `foo.tsx`), and a route wrongly filed under `_app` would pass
the app-shell geometry assertions and still fail keyboard avoidance uncaught.
*Coverage* is enforced, though: `e2e/layout-smoke.spec.ts`'s
`findUncoveredRoutes()` walks every leaf file in `src/routes/`, extracts its
`createFileRoute(...)` path, and its own test fails in CI if it isn't listed in
`APP_ROUTES`, `FLOW_ROUTES`, or the `ROUTE_COVERAGE_EXEMPTIONS` escape hatch
(documented inline — e.g. `/auth/callback`, which has no
`[data-flow-screen]`/`[data-topbar]` host to anchor to). So a new route can't
silently go unlisted; it can still silently go in the wrong list.
`routes/-appShell.test.ts` separately pins how `_app`'s cap is expressed.

## Architecture invariants

Enforced by the import-boundary lint rules (`pnpm run lint`):

1. **`model/` is the domain core — no outward dependencies.** It imports only
   from `types.ts`, `fileIO.ts` and `wikilinks.ts` (all cross-cutting root
   residents), never from `store`, `storage`, `editor`, `calendar` or any other
   feature.

2. **A module's internals are private to its own subtree; the barrel is its only
   public surface.** A module is any `src/` directory with its own `index.ts` —
   `eslint.config.js` derives the list from the filesystem (`findModules`), so a
   directory becomes a protected module the moment it grows a barrel, with no
   config edit. Code outside a module — a sibling module, *or* a root-level
   file — must import it via `@/module`, never `@/module/internal-file`; one
   `no-restricted-paths` zone per module enforces both directions the same way
   ("root resident" means cross-cutting, not exempt). Widening a module's reach
   costs an explicit barrel export or a move up the tree, never a deep import.
   Two permanent exceptions, both one level inside `components/`:
   `@/components/ui/**` (shadcn registry) and `@/components/primitives/**` (our
   own). `@/lib/**` is exempt for a different reason — it has no `index.ts`, so
   it isn't a module at all.

3. **Core persistence goes through the port.** `storeCommit.ts` and
   `occurrenceActions.ts` call the `persistencePort` abstraction rather than
   `@/storage` directly. The storage adapter registers the implementation at
   startup.

4. **No import cycles. There are no accepted ones, and `import type` counts.**
   Enforced by `pnpm run lint:deps` (dependency-cruiser,
   `.dependency-cruiser.mjs`), which `pnpm run lint` chains and CI runs.

   A hard rule, not a stylistic one, for two separate reasons. A *runtime* cycle
   means some module in the loop necessarily executes against a half-initialised
   copy of the next, so whether it works at all depends on the order the bundler
   happens to emit — silent until it isn't, and it lands at load time where
   there is no stack to read. A *type-only* cycle has no such bug and is still
   forbidden: two modules naming each other's types cannot be read, moved,
   tested or extracted independently, which is most of what the boundary was
   for. Treating the two differently would also make the rule one keystroke wide
   — deleting `type` from an import would turn a tolerated loop into a real one
   with nothing to catch it. So the checked graph counts type edges
   (`tsPreCompilationDeps`), and a shared type gets the same fix as shared code:
   put it where neither consumer has to import the other. Usually that is the
   module that *produces* values of it — `FilterOccs` sits in
   `calendar/useCalendarFilter.ts`, which builds the live filter, not in either
   of the two builders that take one.

   A cycle is a **placement bug**, not something inherent to feature-sliced
   React. Every one this codebase has had was a file in the wrong directory, and
   the two shapes both have a standard fix:

   - **A leaf layer importing a feature back.** `components/` is imported by the
     features; nothing in it may import `@/calendar`, `@/search`, `@/editor` or
     any other feature module. A component that genuinely needs one is not a
     shared component — it is a composite belonging beside whatever mounts it.
     `SearchBar`/`AppSidebar` were exactly this, and moved to
     `routes/-searchBar.tsx`/`routes/-appSidebar.tsx`.
   - **A downstream module calling back upstream.** Return the request as data
     and let the caller act on it. See `storage/sync.ts`'s `SyncCycleResult`:
     the sync core reports "these vaults want a push" and `syncScheduler.ts` —
     upstream of it — does the pushing. The type-level form is a low layer
     enumerating its own consumers: `storage/cache/db.ts`'s `meta` row is
     `value: unknown` rather than a union naming `VaultRef[]` and
     `PendingMove[]`, because every reader validates what came out of IndexedDB
     anyway.

   Both are ordinary dependency inversion; reach for them before anything more
   exotic. A cycle is never fixed by adding an exception to
   `.dependency-cruiser.mjs`.

5. **View-ephemeral state lives with its view.** `store.ts` holds durable
   vault/sync/prefs state only. `calendar/viewState.ts` owns calendar view
   ephemera (agenda scroll position, carousel swipe previews, scroll-to-today)
   in its own Zustand store, reached through the `@/calendar` barrel like any
   other feature-internal state — not through `store.ts`/`storeBridge`.
   `zustand` is otherwise restricted to `store.ts`; `calendar/viewState.ts` is
   the one named exception in `eslint.config.js`.

## Manual browser verification

Don't proactively start the dev server and drive it with `preview_*` tools to
verify a change. Only do this when the user explicitly asks — they generally
test UI changes themselves.

**This does not apply to survey runs.** `plans/surveys/performance.md`,
`product-niche.md` and `health-ui.md` each specify a measurement or screenshot
pass as a required phase — dev server, browser, real numbers — and that pass is
the explicit ask. Skipping it because of the paragraph above is a silent
failure: it lands as "partially assessed", which the survey conventions permit,
so nothing surfaces that the run never looked.

## Preview tools (gotchas — read before using `preview_*`)

These bit us repeatedly:

- **The preview server runs from the *session* cwd, not the worktree you're
  editing.** If your changes live in a different worktree, the default
  `meridian` launch config serves the *wrong* code — stale behavior, and your
  `console.log`s never fire. Add a config targeting the right worktree:
  ```json
  {
    "name": "pr-xyz",
    "runtimeExecutable": "pnpm",
    "runtimeArgs": ["-C", "<abs-path-to-worktree>", "exec", "vite", "--host", "--port", "5199", "--strictPort"],
    "port": 5199,
    "autoPort": false
  }
  ```
- **Give each config a unique port.** The MCP dedupes configs by port, so two
  both on `5173` collapse into one and you may get served the wrong one (the
  returned `name` reveals the mix-up).
- **Don't use `pnpm dev -- --port N`.** The extra `--` is forwarded to vite and
  silently breaks `--port` (vite stays on 5173). Use
  `pnpm exec vite --port N --strictPort`.
- **Trust `preview_logs`, not the MCP's reported port** — the MCP reports the
  *configured* port; vite prints the real `Local:` URL in its logs.
- **To verify which code is actually served**, assert on a feature only the
  target branch has.
- **Don't hard-navigate (`window.location`) straight to an
  `/entry/<vault>/<slug>` URL** — it races vault loading, so the entry isn't in
  the store yet and you get "Item not found". Load `/meridian/`, wait for
  `[data-testid="entry-card"]`, then click the card's
  `button[aria-label="<title>"]` (SPA nav, no reload).
- **Example-vault slugs:** "Welcome to Meridian" = `01-start-here`; its linked
  notes are `02-your-first-task`, `03-plan-your-week`, `04-link-your-notes`,
  `05-make-it-yours`.
- **Inspect CM6 state from the page:**
  `document.querySelector('.cm-content').cmTile.view` gives the `EditorView`.
