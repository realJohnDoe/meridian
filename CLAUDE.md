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
