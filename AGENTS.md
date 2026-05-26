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
