# PWA Snappiness Survey — Meridian

## 1. Snappiness verdict

The app is well-tuned on the flows the code was clearly optimized for — **toggling a task and switching views are genuinely snappy** (no main-thread task over 50 ms even at 300 files), thanks to the expansion-cache overlay and optimistic checkbox state. But it falls off a cliff the moment a flow touches the **`roots` map or the backlink lookup**, because both do whole-vault work with coarse invalidation. The **worst flow by far is search**: a single keystroke ("e") froze the main thread for **7.1 seconds** on a 300-file vault, because the results list computes an **O(files²)** backlink lookup for _every_ matching file, does it _twice_ (both the mobile and desktop overlays mount and render), and mounts ~600 un-virtualized cards. The **second-worst is editing metadata** (title/tags/scope): each save creates a new `roots` Map, which invalidates the expansion cache and forces a full re-expansion of all 8,680 occurrences — a **377 ms** freeze per edit. The single biggest structural theme: **backlink resolution and occurrence expansion are recomputed wholesale, keyed on `roots` _identity_ rather than on what actually changed**, so a keystroke, a title edit, or a fresh mount each redo O(files²)/O(all-occurrences) work synchronously.

## 2. Coverage statement

**Test vault:** 300 files / 878 wikilink-items / **8,680 expanded occurrences** over the agenda's −365…+90 day window (15% weekly-recurring series, 40% dated tasks, 25% one-off events, 10% undated backlog, 10% notes). Generated deterministically (seeded mulberry32). Generator preserved at `scratchpad/testVaultGen.ts`. **Reproduce:** drop it in `src/storage/`, add to `exampleBackend.ts`:

```js
const ENTRIES =
  Number(localStorage.meridian_bigvault) > 0
    ? generateBigVault(Number(localStorage.meridian_bigvault))
    : buildEntries();
```

then set `localStorage.meridian_bigvault = "300"` and load the Tutorial vault.

| Flow                              | Traced | Measured                                 | Verdict                                             |
| --------------------------------- | ------ | ---------------------------------------- | --------------------------------------------------- |
| 1. Toggle task                    | ✅     | ✅ live (0 long tasks)                   | **Fast** — optimistic paint + memoized rows         |
| 2. View switch (day↔month↔agenda) | ✅     | ✅ live (0 long tasks)                   | **Fast**                                            |
| 3. Search                         | ✅     | ✅ live (7.1 s freeze)                   | **Finding 1**                                       |
| 4. Create item                    | ✅     | ⚠️ traced only                           | Shares the roots-change cost of Finding 3           |
| 5. Change metadata                | ✅     | ✅ (377 ms)                              | **Finding 3**                                       |
| 6. Cold start / reload            | ✅     | ✅ prod payload + expansion              | **Findings 4 + 3** (bundle + first-paint expansion) |
| 7. Editor keystroke               | ✅     | ⚠️ analytically bounded, not driven live | **Refuted as top-5** (see below)                    |

**Refuted — editor keystroke (flow 7):** the wikilink plugin rebuilds decorations over the _whole_ doc per keystroke (`parseWikilinks(doc.toString())` + a `for (let i = 1; i <= doc.lines; i++)` loop, not viewport-limited, in `src/editor/cm/wikilinkDecorations.ts:92`). At realistic note sizes this is cheap: `resolveWikilink` measured at ~0.01 ms/call, so even a 20-link note costs <1 ms/keystroke. I could not drive the CM editor live (every full-page navigation in this harness bounced to `/`, and card clicks didn't open the editor), so this is **unverified at pathological note sizes** (a 500-line note with 100+ links would re-scan everything each keystroke).

**Not measured / sampled:** GitHub sync path, IndexedDB cache writes (confirmed off the paint path — persistence is async via `writeEntity`), Day/Month view internals beyond the switch measurement, onboarding tour.

## 3. Findings

Ranked by `(impact × breadth) ÷ effort`.

---

### Finding 1 — Search recomputes O(files²) backlinks for every result, twice, un-virtualized

- **Flows affected:** 3 (Search) — **every keystroke** while the search bar is open.
- **Category:** `search-latency` `render-amplification` `critical-path-work`
- **Impact:** **10** — multi-second full-page freeze on an everyday path.
- **Baseline measurement:** Typing **"e"** (299 of 300 files match the fuzzy matcher) produced a single **7,105 ms** `longtask` and mounted **608** `[data-tour="entry-card"]` nodes (≈299 results × 2 overlays + agenda behind). Isolated algorithmic cost of the `useMemo` body alone: **2,131 ms** for "e" (299 matches), **1,004 ms** for "rev" (150 matches) — because it calls `backlinksTo` (~8.9 ms each, see Finding 2) once per match. No debounce: `setQuery` fires on every `onChange`.
- **Measurement recipe:** load big vault → click search input → install `new PerformanceObserver(l => …).observe({entryTypes:['longtask']})` → clear `window.__longtasks` → set input value to `"e"` via the native setter + dispatch `input` → after 2.5 s read `window.__longtasks` (got `[7105]`) and `document.querySelectorAll('[data-tour="entry-card"]').length` (got 608). Algorithmic isolation: replicate `fileEntries`→`matchesQuery` filter→`backlinksTo` per match against `useStore.getState().roots`, `performance.now()` around it.
- **Breadth:** 4 files (`src/search/FileResultsList.tsx`, `src/search/SearchResults.tsx`, `src/search/FilterOverlay.tsx`, `src/search/MobileSearchOverlay.tsx`); both overlays confirmed to mount `SearchResults` simultaneously (desktop CSS-hides one with `hidden fine:block` / `fine:hidden` but it still renders).
- **Fix effort:** M
- **Evidence:** `src/search/FileResultsList.tsx:37` — inside `useMemo(…, [roots, query])`:
  ```js
  .map(x => ({
    entry: x.entry,
    listedOn: backlinksTo(x.entry.fileSlug, roots).map(slug => roots.get(slug)?.title ?? slug),
  }))
  ```
  and `src/components/SearchBar.tsx:22` — no debounce:
  ```js
  function setQuery(value: string) { void navigate({ … sq: value … , replace: true }) }
  ```
- **Problem:** Every keystroke re-filters all files, then runs the quadratic `backlinksTo` for each of the up-to-300 matches, in two mounted overlays, then mounts hundreds of un-virtualized cards — so the user sees the whole UI lock up for seconds on the first letter typed.
- **Fix:** Debounce the query (~150 ms); render results in only one overlay at a time; virtualize the results list (as the agenda already is); and read backlinks from a prebuilt index (Finding 2). Expected effect: per-keystroke long task **~7,100 ms → <50 ms**.

---

### Finding 2 — `backlinksTo` is O(files²·items) and unmemoized at its call sites

- **Flows affected:** 2 (view switch / agenda mount), 3 (search), 5 (edits), 6 (cold start) — runs for **every visible occurrence row on every mount** and (via Finding 1) **every search match**.
- **Category:** `data-and-persistence` `render-amplification` `memory-and-leak` (scaling cliff)
- **Impact:** **8** — the shared root cause behind Findings 1 and 3; the single highest-leverage fix.
- **Baseline measurement:** **8.9 ms per `backlinksTo` call** (2,675 ms / 300 slugs) at 300 files / 878 items. Cost is O(files²·items) because the inner `resolveWikilink` itself loops over all roots (up to twice), nested inside a loop over all roots × their items. At ~13 visible agenda rows that's ~115 ms of backlink work per agenda mount; in search it's ×299.
- **Measurement recipe:** replicate `unwrapRef`/`resolveWikilink`/`backlinksTo` verbatim in-page, run over every slug in `useStore.getState().roots`, `performance.now()` around the loop, divide by slug count.
- **Breadth:** 2 core functions (`src/fileOccurrence.ts`, `src/wikilinks.ts`) + 2 hot call sites (`grep backlinksTo src` → `src/calendar/OccurrenceRow.tsx:32`, `src/search/FileResultsList.tsx:37`).
- **Fix effort:** M
- **Evidence:** `src/fileOccurrence.ts:167` — the doc comment even says to memoize, but the call site doesn't:
  ```js
  // Self-links are excluded. Memoize the result on [roots] at the call site.
  export function backlinksTo(targetSlug: string, roots: Roots): string[] {
    const result: string[] = []
    for (const [fileSlug, meta] of roots) {
      if (fileSlug === targetSlug) continue
      for (const raw of meta.items ?? []) {
        const ref = unwrapRef(raw)
        if (resolveWikilink(ref, roots) === targetSlug) { result.push(fileSlug); break }
  ```
  and `src/wikilinks.ts:56` — `resolveWikilink` is itself O(files): `for (const [fileSlug] of roots) { if (fileSlug.toLowerCase() === lower) return fileSlug }` (plus a second title loop). `src/calendar/OccurrenceRow.tsx:32` calls it inline every render:
  ```js
  const listedOn = backlinksTo(occ.fileSlug, roots).map(
    (slug) => roots.get(slug)?.title ?? slug,
  );
  ```
- **Problem:** Resolving "which files link here" rescans the entire vault for each target, so the per-row backlink chip does quadratic work that multiplies across rows and search results — invisible in the 16-file example vault, painful at a few hundred files.
- **Fix:** Build one reverse-link index (`Map<targetSlug, sourceSlug[]>`) once per `roots` change — O(files·items) total with an O(1) lowercase-keyed `resolveWikilink` map — and have rows/results do an O(1) lookup. Expected effect: per-call cost **8.9 ms → ~0 ms**; agenda-mount backlink work **~115 ms → <1 ms**; removes 4.2 s from the search freeze.

---

### Finding 3 — Any metadata edit invalidates the expansion cache → full 8,680-occurrence re-expansion

- **Flows affected:** 5 (change date/scope/title/tags/repeat), 4 (create), 6 (cold start does the first expansion) — **every edit save**.
- **Category:** `critical-path-work` `data-and-persistence`
- **Impact:** **6** — a ~0.4 s freeze on a daily-but-not-constant action; the toggle path avoids it, edits don't.
- **Baseline measurement:** A single `roots`-identity change (what editing one title does) produced a **377 ms** long task. Isolated: full `expandWithMultiday` over the −365…+90 window = **111 ms median** (300 files → **8,680 occurrences**), plus `dedupeAndSort` of all 8,680 + regrouping + visible rows re-running `backlinksTo` (roots identity changed). By contrast, `toggleDone` keeps `roots` referentially stable, hits the cache overlay, and measured **0 long tasks**.
- **Measurement recipe:** `st.setData({items: st.items.slice(), roots: newMapWithOneTitleChanged})` with a longtask observer installed → read the resulting long task (377 ms). Expansion isolation: exposed `expandWithMultiday`, ran it 6×, took the median (111 ms) and `.length` (8,680).
- **Breadth:** `src/model/expansionCache.ts` + `src/model/storeOps.ts` `updateRoot` (every edit scope routes file-level fields through it) — affects all of `applyAll`/`applySingle`/`applyFuture`/`applyAdd`/`applyNew`.
- **Fix effort:** M–L
- **Evidence:** `src/model/expansionCache.ts:84` — the fast path requires `roots` reference-equality:
  ```js
  if (prev && prev.fromMs === fromMs && prev.toMs === toMs && prev.weekStart === weekStart && prev.roots === roots && hasSameStructure(prev.items, items)) {
  ```
  and `src/model/storeOps.ts:171` — `updateRoot` allocates a fresh map on every edit:
  ```js
  function updateRoot(roots: Roots, fileSlug: string, f: EditFields): Roots { const next = new Map(roots) }
  ```
- **Problem:** File-level fields (title/tags/items/body) live in `roots`; because the expansion cache keys on `roots` _identity_, changing any of them on one file discards the cached expansion for _all_ files and re-expands every series, blocking the save for ~0.4 s.
- **Fix:** Gate the cache on structural inputs only (the `items` structure already has `hasSameStructure`; `roots` only feeds `joinFileMeta`'s title/tags), and overlay changed file-level fields onto cached occurrences the same way `done`/`priority` are overlaid today — or expand from `items` and join `roots` fields at render. Expected effect: edit long task **377 ms → <20 ms**.

---

### Finding 4 — 298 kB gzip `components` chunk on the agenda's cold-start critical path

- **Flows affected:** 6 (cold start / PWA launch) — **once per launch**.
- **Category:** `bundle-and-startup`
- **Impact:** **4** — seconds only on slow networks; on localhost the parse/exec floor is small, but the transfer dominates real first-load.
- **Baseline measurement:** Production build ships **547 kB gzip / 1,710 kB decoded** of JS+CSS on the first agenda load. Largest chunk `components-*.js` = **298 kB gzip / 870 kB decoded**, larger than `main` (433 kB decoded) + `model` (148 kB) combined, and it's on the agenda's critical path (the agenda's `OccurrenceCard` + `_app`'s `SearchBar`/`Sidebar` all live there). `SearchBar` eagerly mounts `MobileSearchOverlay` (the `vaul` drawer) even on desktop.
- **Measurement recipe:** `pnpm run build` chunk table; then `vite preview` + `performance.getEntriesByType('resource')` summed `transferSize`/`decodedBodySize`, filtered to `.js`/`.css`.
- **Breadth:** `src/components/index.ts` barrel + its transitive `vaul`/`cmdk`/`radix`/`sonner` deps; build output (`grep -c vaul` on the built chunk: 118 occurrences).
- **Fix effort:** M
- **Evidence:** build output `dist/assets/components-Cbq1nBfP.js  891.08 kB │ gzip: 298.01 kB`; `src/components/SearchBar.tsx:48` mounts the mobile drawer unconditionally:
  ```jsx
  <MobileSearchOverlay open={searchOpen} … />
  ```
- **Problem:** The initial calendar paint downloads and parses the mobile search drawer, command-palette (`cmdk`), and dialog primitives it doesn't need yet, inflating time-to-interactive on first launch.
- **Fix:** Lazy-load `MobileSearchOverlay`/`FilterOverlay` behind the search-open state and split the settings/vault-wizard dialogs out of the eager barrel. Expected effect: agenda critical-path JS **~298 kB gzip → est. ~200 kB gzip**.

---

**Net:** Findings 1–3 all trace back to the same lever — stop recomputing whole-vault backlinks and expansion on every `roots` touch. Fixing Finding 2 (backlink index) alone removes ~4.2 s from search and ~115 ms from every mount; fixing Finding 3 removes the 377 ms edit freeze; Finding 1's virtualize/debounce/single-overlay work removes the remaining ~2.9 s search-render cost.
