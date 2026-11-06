# Dev server and preview tools

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
pins which occurrence of a series), `id` (the occurrence's stable id, breaking
ties when two occurrences of the same file land on the same date), and
`scope` (`single`/`future`/`all`/`add`).
`/meridian/entry/<fileSlug>` still works as a redirect to the loaded vault.
New entries are `/meridian/entry/new`, with `title`, `date`, `time`,
`duration`, `itemType` and `vault` search params — `vault` overrides
`defaultVaultId` for that entry, and is what the editor's vault chip sets.

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
- **Example-vault slugs:** "Welcome to Meridian" = `01-start-here`; the notes it lists are `everything-is-a-list`, `tasks-and-events`, `recurring-events`, `links-and-backlinks`, `favorites`, `frontmatter-reference`, `share-a-calendar`, `install-as-an-app`, `make-it-yours`. The entries those link on to are `buy-groceries`, `book-dentist`, `plan-the-week`, `lunch-with-sam`, `team-standup`, `morning-run` and `dev-notes`. Source of truth: the `id:` fields in `src/storage/devFixtures/tutorialVault.ts`.
- **Inspect CM6 state from the page:** `document.querySelector('.cm-content').cmTile.view` gives the `EditorView` (read `view.state`, `dispatch`, etc.).
