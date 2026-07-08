## Next steps

- Show multiday events as bars spanning multiple days in month view
- Check if all clickable components are at least 44x44 px
- Investigate split second hang when toggling tasks
- Add arrows to multiday rows in month and day view
- Consider if name and logo are still good
- Post about Meridian in Obsidian forums
- Add vault retention period
- Fix flow for adding a second vault

## Dev Tool recommendations from Fable

4. One ESLint zone, closing a known hole: your boundary rules stop model/ from importing feature dirs but not from importing React — which is exactly how useExpandWithMultiday leaked in. A no-restricted-imports block scoped to src/model/\*\* forbidding react makes the "model is pure" invariant machine-enforced instead of documented.

## Custom code that should lean on a library, according to Fable

2. Three hand-rolled search matchers, one of them actively opting out of the library's.
   ItemsList.tsx:313 renders <Command shouldFilter={false}> and then filters with e.title.toLowerCase().includes(pickerQuery.toLowerCase()) — i.e., you're using cmdk but disabling its command-scoring (its core feature) to substitute a weaker substring match. FileResultsList.tsx and ListedOnRow.tsx each have their own lowercase-substring logic too. At personal-vault scale substring matching is defensible — I wouldn't add fuse.js for this — but three divergent matchers is the real smell. Either re-enable cmdk's filtering where you're inside a <Command>, or extract one shared matchesQuery() used by all three, so "why does the picker find this file but search doesn't" can't happen.

# Meridian code health report

## 1. Health verdict

This is a disciplined, well-above-average codebase: import boundaries are actually enforced by lint (not just documented), there is essentially zero `any`, the OAuth flow is done properly (PKCE + state + server-side secret in the worker), routes are code-split, and the domain core in `model/` is genuinely pure and well-tested — with one exception noted below. The two weakest areas are the **architecture documentation (CLAUDE.md), which has drifted from the code it governs**, and the **root-level view-model helper layer (`occView.ts`, `format.ts`, plus the expansion cache hook), which contains the most branch-heavy pure logic in the app with zero test coverage**. The biggest structural theme is _convention decay at the root_: the "cross-cutting root residents" rule is eroding — the documented list names a file that no longer exists, files sit at root with a single consumer directory, and `model/` purity has its first React leak. None of this is rot; it's early-stage drift in an otherwise well-defended architecture, and almost all of it is cheap to fix.

## 2. Coverage statement

**Read closely (~35 files, ~40% of hand-written source lines):** entry points (`src/main.tsx`, `src/routes/__root.tsx`, `src/routes/_app.tsx`, `src/debug/main.tsx`); all root residents (`types.ts`, `store.ts`, `occurrenceActions.ts`, `storeCommit.ts`, `occView.ts`, `format.ts`, `fileOccurrence.ts`); `model/` (expansion, storeOps, useExpandWithMultiday, index); `storage/` (sync, vaultRegistry, githubOAuth); `editor/` (save, ItemsList, RepeatDialog, useEntryEditor — partial for the large ones); `calendar/` (DayView); `components/` (OccurrenceCard); `hooks/` (useCalendarFilter); `search/` (SearchResults); `onboarding/` (tourState); `worker/` (index); `lib/` (vaultStorage); `eslint.config.js`; all 14 test files by name, 4 by content.

**Sampled via greps and heads:** remaining routes, debug/NodeInheritanceDebugger (head only), storeItems, the import graph of every root file (measured, not guessed), `any`/catch/XSS/console/lazy-loading sweeps across the whole tree.

**Skipped:** `components/ui/**` (27 shadcn-vendored files, incl. the 771-line sidebar.tsx), `routeTree.gen.ts` (generated), `pnpm-lock.yaml`, `public/`, `scripts/process-icon.mjs`, `plans/`.

**Unverified (flagging, no budget):** `storage/cache.ts` Dexie layer and the three backend implementations (`githubBackend`, `localBackend`, `exampleBackend` — only their tests and call sites were read); the `editor/cm/` CodeMirror decoration layer (6 files, only 1 has tests — plausible second test-gap hotspot); `calendar/AgendaView` virtualization/scroll-restore logic.

Overall the report is based on direct reading of roughly 40% of the source and grep-level evidence over ~95% of it.
