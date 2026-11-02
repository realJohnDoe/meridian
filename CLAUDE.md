# Agent guidelines for Meridian

## Before implementing

Before starting work on an issue, feature, or bug fix, check whether
architectural issues are making the implementation harder than it needs to be
(e.g. a misplaced file, a missing abstraction, a boundary violation). Fix
those first, then implement the requested change on top of it.

## Code size

Given two implementations with essentially equivalent behavior, prefer the
one with less code. A shorter diff that does the same job is worth more than
a longer one that merely feels more thorough — don't pad a change with extra
abstraction, options, or handling the task doesn't need just to make it look
more complete. This applies to edits to this file and to the survey skills in
`.claude/skills/survey-*/` as much as to source: see
`.claude/skills/_survey/conventions.md` for
the same principle applied to keeping survey files from growing unchecked.

## Package manager

This project uses **pnpm** (`pnpm install`, `pnpm add`, `pnpm run …`). A
`package-lock.json` from npm must not be committed.

## Git workflow

Once the first changeset of a session/task has been applied and verified (build/lint passing), commit and push it to a feature branch right away — don't wait for an explicit "commit and push" ask each time. Keep committing and pushing subsequent changesets the same way as the task progresses.

Pushing a `ccr-*` or `claude/*` branch opens its PR automatically
(`.github/workflows/open-pr.yml`), so don't open one yourself. After the first
push, find that PR by its head branch (it appears within a minute) and run the
`tracemap-pr` skill from [realJohnDoe/tracemap](https://github.com/realJohnDoe/tracemap) (`skills/tracemap-pr/SKILL.md`) on it to add trace map images to its description; it decides itself when none would help. Link the PR in your final message.

Label every issue an agent creates `Sonnet` (well-scoped, mechanical) or
`Opus` (needs design or cross-module reasoning), plus `Human` when it needs
human judgement or an important decision before work can start.

## Checking UI changes

After a change that affects what renders, look at it before calling it done:
`pnpm run screenshot <path>…` writes phone and desktop shots in light and dark
to `test-results/screenshots/`; read them, and say in your summary what you
looked at and what you couldn't check. The app is served under `/meridian/`.
Before driving the app any other way (Playwright, `preview_*` tools, entry
URLs, Tutorial-vault slugs), read `docs/agents/browser-verification.md`.

## Build and lint

Verify with `pnpm run build` (which runs `tsc -b`), **not** `tsc --noEmit`
alone: single-file mode misses unused-import errors and stricter checks the
composite build enforces, and CI runs `pnpm run build`. Run it before
`pnpm run lint` on a fresh worktree, since lint needs the types it generates.
Before touching `worker/`, root build/test config, or the `typescript` pin,
read `docs/agents/toolchain.md`.

## Domain vocabulary

`GLOSSARY.md` (repo root) is the ubiquitous language: ~40 terms, which word to reach for when two are close enough to confuse (`hasRemote` vs `readOnly`, `view-only` vs `sandbox`, the two meanings of `items`, which of the three occurrence renderers a context wants), and a table of retired names so a stale doc or an old commit message can be translated forward. Read it before naming anything new.

It is an **index, not an encyclopedia** — each entry is one sentence plus a pointer at the authoritative definition in code, which stays where it already lives (`src/types.ts` doc comments, `src/model/AGENTS.md`). Do not restate behaviour there; explanations belong beside the code.

`src/glossary.test.ts` enforces this: every referenced file must exist, every referenced symbol must still be declared in it, and no retired name may come back. **A rename therefore has to update `GLOSSARY.md` or the test suite fails** — that is the point, and it is why entries name symbols rather than describe them.

## Directory structure

**Placement rule:** a file moves into a subdirectory only when every caller already lives in that subdirectory (or a layer that naturally depends on it). Do not propose moving a file just because it "feels" like it belongs somewhere — check the actual import graph first.

| Directory | Scope |
|---|---|
| `model/` | Temporal/occurrence domain logic and YAML round-trip (expansion, collapse, inheritance, repeat, store ops). Does **not** include general file I/O or markup parsing. |
| `storage/` | Backend abstraction (local FS, GitHub, example), IndexedDB cache, sync, vault registry, toast notifications. |
| `editor/` | CodeMirror editor, entry UI, dialogs, save logic. |
| `calendar/` | Day/month/agenda views and occurrence rendering. |
| `settings/` | The settings screens — general preferences, the theme picker, the vault list and each vault's own screen, and the add-vault wizard. Reached by route (`/settings/…`), not as a modal. |
| `components/` | Shared React components. `components/ui/` is a faithful mirror of the **shadcn registry** — only files the shadcn CLI wrote go there — and is excluded from coverage, knip and checked by `shadcn diff`; `components/primitives/` holds **our own** shared primitives (`IconButton`, `ResponsiveModal`, …) and gets none of those exemptions. A first-party primitive used by only one feature dir belongs in that feature dir. **Leaf layer:** nothing here may import a feature module back (`@/calendar`, `@/search`, `@/editor`, …); a component that needs one is a shell composite and belongs beside whatever mounts it. |
| `hooks/` | Shared React hooks. |
| `routes/` | TanStack Router route definitions, plus the `-`-prefixed files (excluded from route generation) that a route composes: the topbars, and the `_app` shell's own `-appSidebar.tsx`/`-searchBar.tsx`. This is the top of the graph — nothing imports `routes/` — so it is where a composite that reaches across several feature modules belongs. A route goes under `_app` (virtualized lists) or the document-flow chain (text inputs) by what it contains: read `docs/agents/route-shells.md` before adding or moving one. |

**Root-level files are intentionally cross-cutting** — imported by three or more unrelated layers, with no single owning directory. Before adding, moving or splitting one, read the list of deliberate root residents and why each is there in `docs/agents/architecture.md`.

All feature directories already have `index.ts` barrels enforced by the import-boundary lint rules — do not propose adding them.

## Architecture invariants

Enforced by `pnpm run lint` (ESLint per file, then dependency-cruiser over the whole graph):

1. **`model/` is the domain core — no outward dependencies.** It imports only from `types.ts`, `fileIO.ts`, and `wikilinks.ts`. It must never import from `store`, `storage`, `editor`, `calendar`, or any other feature.
2. **A module's internals are private to its own subtree; the barrel is its only public surface.** A module is any `src/` directory with its own `index.ts` (`eslint.config.js` derives the list from the filesystem). Code outside a module — a sibling module *or* a root-level file — imports it via `@/module`, never `@/module/internal-file`; "root resident" means cross-cutting, not exempt. Widening a module's reach costs an explicit barrel export or a move up the tree, never a deep import. Permanent exceptions: `@/components/ui/**` and `@/components/primitives/**`; `@/lib/**` has no `index.ts`, so it isn't a module.
3. **Core persistence goes through the port.** `storeCommit.ts` and `occurrenceActions.ts` call the `persistencePort` abstraction rather than `@/storage` functions directly. The storage adapter registers the implementation at startup.
4. **No import cycles. There are no accepted ones, and `import type` counts.** A cycle is a placement bug, never fixed by adding an exception to `.dependency-cruiser.mjs`. When `pnpm run lint:deps` reports one, read `docs/agents/architecture.md` for the two shapes it takes and their standard fixes.
5. **View-ephemeral state lives with its view.** `store.ts` holds durable vault/sync/prefs state only. `calendar/viewState.ts` owns calendar view ephemera (agenda scroll position, carousel swipe previews, scroll-to-today) in its own Zustand store, reached through the `@/calendar` barrel — not through `store.ts`/`storeBridge`. `zustand` is otherwise restricted to `store.ts`.

## Agent skills

- **Issue tracker:** GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.
- **Triage labels:** default five-label vocabulary. See `docs/agents/triage-labels.md`.
- **Domain docs:** single-context; `GLOSSARY.md` serves as the context file. See `docs/agents/domain.md`.
