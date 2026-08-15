# Agent guidelines for Meridian

## Package manager

This project uses **pnpm**. Always use `pnpm` — never `npm` or `yarn`.

```bash
# Install dependencies in a new worktree
pnpm install

# Add a package
pnpm add <package>

# Build
pnpm run build
```

Using `npm install` will create a `package-lock.json` that must not be committed.

## GitHub / Pull Requests

Do **not** use the GitHub CLI (`gh`) to open pull requests. Just push the branch and leave PR creation to the user.

```bash
git push -u origin <branch-name>
```

## Git workflow

Once the first changeset of a session/task has been applied and verified (build/lint passing), commit and push it to a feature branch right away — don't wait for an explicit "commit and push" ask each time. Keep committing and pushing subsequent changesets the same way as the task progresses.

## Dev server base path

The app is served under `/meridian/` — not `/`. When using preview tools or navigating programmatically, always use this base path:

```
http://localhost:5173/meridian/
http://localhost:5173/meridian/entry/<vaultId>/<fileSlug>
```

The `pnpm dev` server defaults to port 5173 but may bind to another port if that's taken.

An entry lives at its own route, not a search param on the agenda. The URL
carries the two halves of its `EntryKey` as separate path segments — the
Tutorial vault's id is `example`, so its first note is
`/meridian/entry/example/01-start-here`. Search params: `date` (YYYY-MM-DD,
pins which occurrence of a series) and `scope` (`single`/`future`/`all`/`add`).
`/meridian/entry/<fileSlug>` still works as a redirect to the loaded vault.
New entries are `/meridian/entry/new`, with `title`, `date`, `time`,
`duration`, `itemType` and `vault` search params — `vault` overrides
`defaultVaultId` for that entry, and is what the editor's vault chip sets.

## Build verification

Always use `pnpm run build` (which runs `tsc -b`) to verify the full project build — **not** `tsc --noEmit` alone.

`tsc --noEmit` runs in single-file mode and misses unused-import errors and stricter checks that the composite project build (`tsc -b`) enforces. CI runs `pnpm run build`, so failures can show up there even if `--noEmit` is clean.

## Linting (generated types must exist first)

The type-aware lint rules (`no-unsafe-*`, etc.) resolve types from **gitignored generated files**. On a fresh worktree these don't exist yet, so `pnpm run lint` reports a flood of spurious "type that cannot be resolved" / "error typed value" errors — the code is fine, the types just haven't been generated. **Don't hand-fix these or add `eslint-disable`s.** Generate the types first:

```bash
pnpm run build                                          # regenerates src/routeTree.gen.ts (TanStack Router)
pnpm --filter meridian-oauth-worker run cf-typegen      # regenerates worker/worker-configuration.d.ts (wrangler types)
```

CI does exactly this before linting (`.github/workflows/build.yml`), which is why it stays green. The two known offenders:

- `src/routeTree.gen.ts` — without it, `Route.useSearch()`/`useParams()` resolve to `any` and `src/` lint fails.
- `worker/worker-configuration.d.ts` — without it, `Request`/`Response`/`HeadersInit`/`Env` resolve to `any` and **all** of `worker/src` lint fails (~150 errors).

## TypeScript pinned to 6.0.x

`typescript` is intentionally pinned below the TS 7 major in both `package.json` (root) and `worker/package.json`. `typescript-eslint` (even at latest, 8.65.0) hard-refuses to run against TS 7: `eslint` exits with `typescript-eslint does not support TS 7.0`. `vite build`/`tsc -b` themselves are fine under TS 7 — only the lint step breaks. Tracked upstream: https://github.com/typescript-eslint/typescript-eslint/issues/10940 (support for TS ≥7.1). Don't attempt the TS 7 bump again until that lands — re-check the issue first.

## Directory structure

**Placement rule:** a file moves into a subdirectory only when every caller already lives in that subdirectory (or a layer that naturally depends on it). Do not propose moving a file just because it "feels" like it belongs somewhere — check the actual import graph first.

| Directory | Scope |
|---|---|
| `model/` | Temporal/occurrence domain logic and YAML round-trip (expansion, collapse, inheritance, repeat, store ops). Does **not** include general file I/O or markup parsing. |
| `storage/` | Backend abstraction (local FS, GitHub, example), IndexedDB cache, sync, vault registry, toast notifications. |
| `editor/` | CodeMirror editor, entry UI, dialogs, save logic. |
| `calendar/` | Day/month/agenda views and occurrence rendering. |
| `components/` | Shared React components. Two primitive layers below it: `components/ui/` is a faithful mirror of the **shadcn registry** — only files the shadcn CLI wrote go there, never hand-written ones — and `components/primitives/` holds **our own** shared primitives (`IconButton`, `ResponsiveModal`, `SurfaceButton`, …). This split is load-bearing: `vitest.config.ts` excludes `components/ui/**` from coverage as boilerplate, `knip.json` ignores its unused exports/types, and `shadcn diff` compares that directory against upstream. `components/primitives/` is deliberately covered by none of those exemptions — do not add it to them. A first-party primitive used by only one feature dir belongs in that feature dir, not here — see the placement rule above. |
| `hooks/` | Shared React hooks. |
| `routes/` | TanStack Router route definitions. |

**Root-level files are intentionally cross-cutting** — they are imported by three or more unrelated layers and have no single owning directory. The deliberate root residents are:

- `types.ts` — pure domain type declarations, plus the four `isX` discriminated-union guards that belong beside their unions (`isSeries`, `isStandaloneOcc`, `isTracked`, `isEditScope`). No runtime registries or logic — the YAML field-parse registry that used to live here is `model/fieldRegistry.ts`, private to `model/` since every consumer lives there.
- `vaultRef.ts` — the `VaultRef`/`VaultKind`/`GitHubVaultRef` family; a root leaf (not `storage/`) because `components/` is barred from importing `@/storage` at all (invariant 2), and `@/vaultActions` re-exports `VaultRef` for it.
- `store.ts` + `storeBridge.ts` — Zustand store for durable, cross-cutting state (vault data, sync status, favorites, prefs); `storeBridge` is imported by `storage/`, `editor/`, and `occurrenceActions.ts`/`storeCommit.ts`. View-local ephemeral state does not belong here — see invariant 5 below.
- `fileIO.ts` — YAML/frontmatter parse+serialize, the path↔slug mapping, and the branded `EntryKey` (`${vaultId}::${fileSlug}`) that composes with it; used by `debug/`, `editor/`, `model/`, `storage/`. `EntryKey` lives here rather than in a new root file precisely because `model/` may import `fileIO.ts` (invariant 1) and this module already owns the identity mapping.
- `wikilinks.ts` — wikilink parse+resolve; used by `editor/`, `model/`, and root. Resolution is **per vault** — files store a bare `[[slug]]`, so `resolveWikilink` takes the linking file's vaultId and `buildResolveIndex` partitions by it.
- `occurrenceActions.ts` — user-action orchestration, including its delete-undo toast; used by `editor/` and `calendar/`
- `storeCommit.ts` + `persistencePort.ts` — persistence-port abstraction (see invariant 3 below); used by `editor/`, `storage/`, and `occurrenceActions.ts`
- `vaultActions.ts` — used by `components/` and `routes/`
- `format.ts`, `fileOccurrence.ts`, `occView.ts` — view-model helpers; each used by three or more feature dirs (`calendar/`, `components/`, `editor/`, `hooks/`, `routes/`, `storage/`, `search/`). `occView.ts` also owns `OccState`, the display-styling vocabulary its own `occState()` derives.

All feature directories already have `index.ts` barrels enforced by the import-boundary lint rules — do not propose adding them.

## Architecture invariants

These rules are enforced by the import-boundary lint rules (`pnpm run lint`):

1. **`model/` is the domain core — no outward dependencies.** It imports only from `types.ts`, `fileIO.ts`, and `wikilinks.ts` (all cross-cutting root residents). It must never import from `store`, `storage`, `editor`, `calendar`, or any other feature.

2. **A module's internals are private to its own subtree; the barrel is its only public surface.** A module is any `src/` directory with its own `index.ts` — `eslint.config.js` derives the list from the filesystem (`findModules`), so a directory becomes a protected module the moment it grows a barrel, with no config edit. Code outside a module — a sibling module, *or* a root-level file — must import it via `@/module` (the barrel), never `@/module/internal-file`; a single `no-restricted-paths` zone per module enforces both directions the same way (root files aren't a privileged exception — "root resident" means cross-cutting, not exempt from the boundary). Widening a module's reach costs an explicit barrel export or a move up the tree, never a deep import. Two permanent exceptions (always allowed as deep imports): `@/components/ui/**` (shadcn registry) and `@/components/primitives/**` (our own shared primitives) — both primitive layers one level inside `components/`. `@/lib/**` is exempt for a different reason: it has no `index.ts`, so it isn't a module at all.

3. **Core persistence goes through the port.** `storeCommit.ts` and `occurrenceActions.ts` call the `persistencePort` abstraction rather than `@/storage` functions directly. The storage adapter registers the implementation at startup.

4. **Accepted cycles — do not refactor.** Feature-mesh cycles through `root` (e.g. `calendar → components → editor → routes → calendar`) are inherent to feature-sliced React. These are deliberately not targets for restructuring.

5. **View-ephemeral state lives with its view.** `store.ts` holds durable vault/sync/prefs state only. `calendar/viewState.ts` owns calendar view ephemera (agenda scroll position, carousel swipe previews, scroll-to-today) in its own Zustand store, reached through the `@/calendar` barrel like any other feature-internal state — not through `store.ts`/`storeBridge`. `zustand` is otherwise restricted to `store.ts`; `calendar/viewState.ts` is the one named exception in `eslint.config.js`.

## Manual browser verification

Don't proactively start the dev server and drive it with `preview_*` tools to verify a change. Only do this when the user explicitly asks for it — they generally test UI changes themselves.

## Preview tools (gotchas — read before using `preview_*`)

These bit us repeatedly; follow them to avoid a long debug loop:

- **The preview server runs from the *session* cwd, not the worktree you're editing.** If your changes live in a different worktree, the default `meridian` launch config will serve the *wrong* code (you'll see stale behavior and your `console.log`s never fire). Add a dedicated launch config that targets the right worktree:
  ```json
  {
    "name": "pr-xyz",
    "runtimeExecutable": "pnpm",
    "runtimeArgs": ["-C", "<abs-path-to-worktree>", "exec", "vite", "--host", "--port", "5199", "--strictPort"],
    "port": 5199,
    "autoPort": false
  }
  ```
- **Give each config a unique port.** The MCP dedupes/reuses configs by port, so two configs both on `5173` collapse into one and you may get served the wrong one (the returned `name` will reveal the mix-up).
- **Don't use `pnpm dev -- --port N`.** The extra `--` is forwarded to vite and silently breaks `--port` (vite stays on 5173). Use `pnpm exec vite --port N --strictPort` instead.
- **Trust `preview_logs`, not the MCP's reported port.** The MCP reports the *configured* port; vite prints the real `Local:` URL in its logs. Check there.
- **To verify which code is actually being served**, assert on a feature only the target branch has (e.g. for PR 3, that off-cursor wikilinks render as chips, not `.wl` marks).
- **Don't hard-navigate (`window.location`) straight to an `/entry/<vault>/<slug>` URL** — it races vault loading, so the entry isn't in the store yet and you get "Item not found". Instead load `/meridian/`, wait for `[data-testid="entry-card"]` to appear, then click the card's `button[aria-label="<title>"]` (SPA nav, no reload).
- **Example-vault slugs:** "Welcome to Meridian" = `01-start-here`; its linked notes are `02-your-first-task`, `03-plan-your-week`, `04-link-your-notes`, `05-make-it-yours`.
- **Inspect CM6 state from the page:** `document.querySelector('.cm-content').cmTile.view` gives the `EditorView` (read `view.state`, `dispatch`, etc.).
