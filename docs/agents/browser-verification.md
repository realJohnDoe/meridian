# Checking a change in the browser

## The quick path

```bash
pnpm run screenshot /settings /entry/example/01-start-here
```

`scripts/screenshot.mjs` starts vite (or reuses one already on `SHOT_PORT`,
default 5292), waits for the Tutorial vault, reaches each path by in-app
navigation, and writes phone (390px) and desktop (1280px) shots in light and
dark to `test-results/screenshots/`. It prints any page errors or
`console.error`s. Open the PNGs with the Read tool and look at them. The script
only covers what a route renders when it opens; to check an interaction (open a
dialog, toggle a task, swipe), write a short Playwright script on the same
pattern.

Things the screenshots will mislead you about:

- **Viewport-fixed elements stop at the viewport.** Shots are full-page, so a
  `fixed` sidebar ends at 800px on a taller desktop page. That is the camera,
  not a layout bug.
- **Only the Tutorial backend is reachable.** GitHub and local-folder vaults
  can't be signed into from a cloud container, so their screens can only be
  seen empty or judged from code.

## URLs

The app is served under `/meridian/`, not `/`:

```
http://localhost:5173/meridian/
http://localhost:5173/meridian/entry/<vaultId>/<fileSlug>
```

`pnpm dev` defaults to port 5173 but may bind to another if that's taken.

An entry lives at its own route, not a search param on the agenda. The URL
carries the two halves of its `EntryKey` as separate path segments. The
Tutorial vault's id is `example`, so its first note is
`/meridian/entry/example/01-start-here`. Search params: `date` (YYYY-MM-DD,
pins which occurrence of a series), `id` (the occurrence's stable id, breaking
ties when two occurrences of the same file land on the same date), and `scope`
(`single`/`future`/`all`/`add`). `/meridian/entry/<fileSlug>` still works as a
redirect to the loaded vault. New entries are `/meridian/entry/new`, with
`title`, `date`, `time`, `duration`, `itemType` and `vault` search params.
`vault` overrides `defaultVaultId` for that entry, and is what the editor's
vault chip sets.

**Example-vault slugs:** "Welcome to Meridian" = `01-start-here`; the notes it
lists are `everything-is-a-list`, `tasks-and-events`, `recurring-events`,
`links-and-backlinks`, `favorites`, `frontmatter-reference`,
`share-a-calendar`, `install-as-an-app`, `make-it-yours`. The entries those
link on to are `buy-groceries`, `book-dentist`, `plan-the-week`,
`lunch-with-sam`, `team-standup`, `morning-run` and `dev-notes`. Source of
truth: the `id:` fields in `src/storage/devFixtures/tutorialVault.ts`.

## Gotchas

- **Don't hard-navigate straight to an `/entry/<vault>/<slug>` URL.** It races
  vault loading, so the entry isn't in the store yet and you get "Item not
  found". Load `/meridian/`, wait for `[data-testid="entry-card"]`, then
  navigate in-app (click the card's `button[aria-label="<title>"]`, or
  `history.pushState` plus a `popstate` event, as the screenshot script does).
- **Playwright in a cloud container:** the pinned `@playwright/test` may not
  match the preinstalled browser. Launch with
  `executablePath: '/opt/pw-browsers/chromium'` when that path exists, and
  never run `playwright install`.
- **Inspect CM6 state from the page:**
  `document.querySelector('.cm-content').cmTile.view` gives the `EditorView`
  (read `view.state`, `dispatch`, etc.).

### `preview_*` tools (desktop sessions)

- **The preview server runs from the *session* cwd, not the worktree you're
  editing.** If your changes live in a different worktree, the default
  `meridian` launch config serves the *wrong* code: you'll see stale behaviour
  and your `console.log`s never fire. Add a dedicated launch config that
  targets the right worktree:
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
  configs both on `5173` collapse into one and you may get served the wrong one
  (the returned `name` will reveal the mix-up).
- **Don't use `pnpm dev -- --port N`.** The extra `--` is forwarded to vite and
  silently breaks `--port` (vite stays on 5173). Use
  `pnpm exec vite --port N --strictPort` instead.
- **Trust `preview_logs`, not the MCP's reported port.** The MCP reports the
  *configured* port; vite prints the real `Local:` URL in its logs.
- **To verify which code is actually being served**, assert on a feature only
  the target branch has.
