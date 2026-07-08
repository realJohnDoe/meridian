## Next steps

- Show multiday events as bars spanning multiple days in month view
- Day view does not use localized times
- Check if all clickable components are at least 44x44 px
- Investigate split second hang when toggling tasks
- Turn day view into buttons like in Google Calendar
- Add arrows to multiday rows in month and day view
- Consider if name and logo are still good
- Post about Meridian in Obsidian forums
- Add vault retention period
- Fix flow for adding a second vault

## Recommend Linters from Fable

2. Worth adding: @eslint-react/eslint-plugin
   Modern, TypeScript-aware, flat-config-native (the successor to legacy eslint-plugin-react for setups like yours). The rules that fit your priorities:
   no-leaked-conditional-rendering (type-aware) — catches {count && <X/>} rendering a literal 0
   no-unstable-context-value / no-unstable-default-props — re-render churn from inline objects
   no-array-index-key — would flag e.g. the key={${o.fileSlug}-${o.date}-${i}} in DayView.tsx:81
   the hooks-extra group: no-unnecessary-use-memo / no-unnecessary-use-callback
   Not worth it
   eslint-plugin-react-perf — largely obsoleted by the compiler rules above, and noisy.
   Legacy eslint-plugin-react — mostly redundant given TypeScript + the two above.
   eslint-plugin-jsx-a11y — only if accessibility becomes a goal; you already hand-write aria-labels consistently, so it would mostly confirm what you do.
   My suggested order: preset first (it's free and its findings are the most substantive), fix the ~21 non-cache findings, decide on the expansion cache, then add @eslint-react in a second pass. Want me to wire up the preset at warn and triage the findings?

## Dev Tool recommendations from Fable

3. Vitest coverage (@vitest/coverage-v8) — one dev-dependency, then vitest run --coverage. This makes the test-gap finding from the report measurable and lets you give Claude instructions like "get occView.ts above 90% branch coverage" instead of vibes.

4. One ESLint zone, closing a known hole: your boundary rules stop model/ from importing feature dirs but not from importing React — which is exactly how useExpandWithMultiday leaked in. A no-restricted-imports block scoped to src/model/\*\* forbidding react makes the "model is pure" invariant machine-enforced instead of documented.

## Custom code that should lean on a library, according to Fable

1. Raw day arithmetic in expansion.ts → date-fns (already installed, already imported in that file).
   Three spots do calendar math by adding multiples of 86_400_000 ms:
   expansion.ts:70 — Math.round((viewDate.getTime() - startD.getTime()) / 86_400_000) + 1 (multiday "Day 3/15" label)
   expansion.ts:85 and expansion.ts:567 — new Date(startD.getTime() + d \* 86_400_000) (multiday span cover dates)
   In local time a "day" is not always 24 hours — you're in Europe/Berlin, so twice a year a multiday event spanning a DST switch is off by an hour, and startOfDay(+24h) can land on the wrong calendar day or double-count. date-fns's addDays and differenceInCalendarDays are DST-correct, and the file already imports addDays. This is the highest-value swap: zero new dependencies, fixes a latent correctness bug, three call sites.

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

## 3. Findings

### 4. DayView silently hides timed events outside 07:00–22:00

- **Category:** `ux`
- **Impact:** 5 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `src/calendar/DayView.tsx:260` — `return h >= SH && h <= EH` (with `const SH = 7` / `const EH = 22` hardcoded at the top). The all-day strip only catches untimed occurrences (`allDay = sorted.filter(o => !fmtT(o.time))`).
- **Problem:** An event at 23:00 or 06:00 is filtered out of the timeline and doesn't appear in the all-day strip either — user data becomes invisible on a primary view with no indicator it exists.
- **Fix:** Clamp out-of-window events to the timeline edges (or extend the window dynamically to cover the day's earliest/latest event) instead of filtering them out.

---

### 10. `OccurrenceCard` gates its meta row on tags it never renders

- **Category:** `dead-code` `ux`
- **Impact:** 2 · **Breadth:** 1 file · **Fix effort:** S
- **Evidence:** `src/components/OccurrenceCard.tsx:134` — `const hasTagsContent      = showTagsParticipants && (tags.length > 0 || listedOn.length > 0)` — but the meta row only renders `listedOn.map(label => (<TagChip …` ; `tags` appears nowhere in the JSX.
- **Problem:** An occurrence with tags but no time/date/backlinks renders an empty meta row (layout gap), and the dead `tags` wiring suggests tag chips were removed from the card without cleaning up the gating logic.
- **Fix:** Either render the tag chips or remove `tags` from `hasTagsContent` and the destructuring.

---

**Also noted (below top-10 cutoff):** the docstring on `extractFileMetadata` in `src/types.ts:172` claims "Migrates legacy `topics` to `items`" but the implementation never reads `fields.topics` — no migration exists anywhere (grep `topics` → comments only). One-line docstring fix, same "docs claim things the code doesn't do" theme as finding 1.
