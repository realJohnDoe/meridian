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

## Dev server base path

The app is served under `/meridian/` — not `/`. When using preview tools or navigating programmatically, always use this base path:

```
http://localhost:5173/meridian/
http://localhost:5173/meridian/?editor=<fileSlug>
```

The `pnpm dev` server defaults to port 5173 but may bind to another port if that's taken. Entry editor search params: `editor` (fileSlug), `edate` (YYYY-MM-DD), `escope`, `etitle`.

## Build verification

Always use `pnpm run build` (which runs `tsc -b`) to verify the full project build — **not** `tsc --noEmit` alone.

`tsc --noEmit` runs in single-file mode and misses unused-import errors and stricter checks that the composite project build (`tsc -b`) enforces. CI runs `pnpm run build`, so failures can show up there even if `--noEmit` is clean.

## Directory structure

**Placement rule:** a file moves into a subdirectory only when every caller already lives in that subdirectory (or a layer that naturally depends on it). Do not propose moving a file just because it "feels" like it belongs somewhere — check the actual import graph first.

| Directory | Scope |
|---|---|
| `model/` | Temporal/occurrence domain logic and YAML round-trip (expansion, collapse, inheritance, repeat, store ops). Does **not** include general file I/O or markup parsing. |
| `storage/` | Backend abstraction (local FS, GitHub, example), IndexedDB cache, sync, vault registry. |
| `editor/` | CodeMirror editor, entry UI, dialogs, save logic. |
| `calendar/` | Day/month/agenda views and occurrence rendering. |
| `components/` | Shared React components and shadcn/ui primitives (`components/ui/`). |
| `hooks/` | Shared React hooks. |
| `routes/` | TanStack Router route definitions. |

**Root-level files are intentionally cross-cutting** — they are imported by three or more unrelated layers and have no single owning directory. The deliberate root residents are:

- `types.ts` — domain types used by every layer
- `store.ts` + `storeBridge.ts` — Zustand store; `storeBridge` is imported by `storage/`, `editor/`, and `components/`
- `fileIO.ts` — YAML/frontmatter parse+serialize; used by `debug/`, `editor/`, `model/`, `storage/`
- `wikilinks.ts` — wikilink parse+resolve; used by `editor/`, `model/`, and root
- `occurrenceActions.ts` + `undoToast.ts` — user-action orchestration; used by `editor/` and `calendar/`
- `format.ts`, `fileOccurrence.ts`, `occState.ts` — view-model helpers split from a former `presentation.ts`; each is used by three or more feature dirs

Do not flag these as misplaced. A future barrel PR will add `index.ts` files to each directory to formalize the public API surface.

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
- **Don't hard-navigate (`window.location`) straight to `?editor=<slug>`** — it races vault loading and opens a blank `untitled.md` draft. Instead load `/meridian/`, wait for `[data-tour="entry-card"]` to appear, then click the card's `button[aria-label="<title>"]` (SPA nav, no reload).
- **Example-vault slugs:** "Welcome to Meridian" = `01-start-here`; its linked notes are `02-your-first-task`, `03-plan-your-week`, `04-link-your-notes`, `05-make-it-yours`.
- **Inspect CM6 state from the page:** `document.querySelector('.cm-content').cmTile.view` gives the `EditorView` (read `view.state`, `dispatch`, etc.).
