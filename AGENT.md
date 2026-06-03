# Agent notes for Meridian

## Build verification

Always use `pnpm run build` (or `tsc -b`) to verify the full project build — **not** `tsc --noEmit` alone.

`tsc --noEmit` runs single-file mode and misses unused-import errors and stricter checks that the composite project build (`tsc -b`) enforces. CI runs `pnpm run build`, so local failures will show up there even if `--noEmit` is clean.
