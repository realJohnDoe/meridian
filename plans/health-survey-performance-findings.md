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
| 3. Search                         | ✅     | ✅ live (7.1 s → ~1 s after Finding 2)   | **Finding 1** (downgraded; see re-eval)             |
| 4. Create item                    | ✅     | ⚠️ traced only                           | Shares the roots-change cost of Finding 3           |
| 5. Change metadata                | ✅     | ✅ (377 ms)                              | **Finding 3**                                       |
| 6. Cold start / reload            | ✅     | ✅ prod payload + expansion              | **Findings 4 + 3** (bundle + first-paint expansion) |
| 7. Editor keystroke               | ✅     | ⚠️ analytically bounded, not driven live | **Refuted as top-5** (see below)                    |

**Refuted — editor keystroke (flow 7):** the wikilink plugin rebuilds decorations over the _whole_ doc per keystroke (`parseWikilinks(doc.toString())` + a `for (let i = 1; i <= doc.lines; i++)` loop, not viewport-limited, in `src/editor/cm/wikilinkDecorations.ts:92`). At realistic note sizes this is cheap: `resolveWikilink` measured at ~0.01 ms/call, so even a 20-link note costs <1 ms/keystroke. I could not drive the CM editor live (every full-page navigation in this harness bounced to `/`, and card clicks didn't open the editor), so this is **unverified at pathological note sizes** (a 500-line note with 100+ links would re-scan everything each keystroke).

**Not measured / sampled:** GitHub sync path, IndexedDB cache writes (confirmed off the paint path — persistence is async via `writeEntity`), Day/Month view internals beyond the switch measurement, onboarding tour.

## 3. Findings

Ranked by `(impact × breadth) ÷ effort`.

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

**Net (updated 2026-07-14):** Finding 2 (backlink index) is **done** — that alone removed ~4.2 s from search (the per-match quadratic `backlinksTo`, which also ran in the now-collapsed second overlay) and ~115 ms from every mount. What's left of the original "recompute whole-vault work on every `roots` touch" theme:

- **Finding 1** is now just debounce + virtualize on the search results (single overlay already done) — estimated ~1 s → <50 ms.
- **Finding 3** (expansion cache keyed on `roots` identity → full 8,680-occurrence re-expansion per edit) is untouched by the backlink fix and remains the ~0.4 s edit-freeze lever.
- **Finding 4** (bundle) is unaffected.
