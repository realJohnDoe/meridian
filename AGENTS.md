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
