# PWA Snappiness Survey — Meridian

_Report generated 2026-07-25. Branch: `claude/pwa-snappiness-survey-2f54a3`. Companion to the survey brief in [health-survey-performance.md](health-survey-performance.md)._

## 1. Snappiness verdict

The app's React memoization is genuinely good — the toggle path re-renders exactly one row, persistence is async and off the paint path, and search is debounced and cheap. The problem is entirely in the **derivation layer**: the agenda re-derives its _entire_ occurrence set on every change instead of incrementally, and one section — **Overdue** — is a single un-row-virtualized block. On the 300-file test vault that section holds **6,789 occurrences**, and forcing it into the viewport mounted **6,937 `OccurrenceRow` components in one synchronous commit that blocked the main thread for ~12.9 s** (dev mode). That is the single worst flow — **scrolling up in the agenda / pressing "Today"** (which explicitly targets the overdue section). The second-worst is any **task toggle**, which re-groups + re-sorts all ~8,685 occurrences (~54 ms) even though only one row changed. The single biggest structural theme: **agenda derivation is whole-vault, not incremental — expansion, grouping, and sorting all run over every occurrence on every mutation and every mount, and the Overdue "section" has no per-row virtualization to cap what mounts.**

## 2. Coverage statement

**Traced AND measured end-to-end** (dev server, big vault, browser + patched `performance.mark`/counters):

- Flow 1 (toggle task in agenda) — measured handler, commit, expansion-overlay, group, sort, and per-component render counts.
- Flow 2 (view switching agenda↔month) — measured agenda re-mount expansion/group/sort and month expansion.
- Flow 3 (search) — measured keystroke→results memo.
- Flow 7 (editor typing) — measured wikilink decoration rebuild per keystroke on small and large docs.
- Flow 5 (metadata edit, title path) — measured; found title keystrokes do **not** hit `setData` (refuted a suspected amplification).

**Traced AND measured, production build:**

- Flow 6 (bundle/startup) — `pnpm run build` chunk sizes; isolated Octokit's contribution with a stub-and-rebuild diff.

**Traced statically only (environment limits, stated up front):**

- Local-FS and GitHub backends — the automated browser can't grant File System Access or complete GitHub OAuth, so only the **example (Tutorial)** backend is measurable. Persistence timing for those backends was read from `sync.ts`/`cache.ts` (writes are async, fired after `setData`, gated behind the `readOnly` check — off the paint path).
- Flow 4 (create-new) — traced through `useEntryEditor`/`save.ts`; the editor mount was measured but the create-specific first-save path was only traced.

**Test vault:** the existing dev generator `src/storage/devFixtures/testVaultGen.ts`, enabled via `localStorage.setItem('meridian_bigvault','300')` + reload → 300 files, 300 roots, **8,685 expanded occurrences** in the agenda's −365…+90 day window (**6,789** of them overdue). Deterministic (seeded PRNG).

**Dev-mode caveat:** all millisecond numbers are unminified dev-mode React and overstate absolute latency (~3–5×); treat them as **before/after baselines**, not shipping latencies. Bundle numbers (Finding 5) are from the production build. Cold-start (Flow 6) wall-clock TTI was **not** isolated because the big-vault generator is dev-only — measured the eager bundle payload instead (example-vault prod build only, as instructed).

**Unverified / flagged:** the exact production ms for Finding 1's freeze (dev ~12.9 s → est. ~3–4 s prod, extrapolated, not measured under minified React); month/day view toggle amplification (traced — `MonthGrid` expands one month only, so low risk — but not measured under load).

---

## 3. Findings — top 5

Ranked by (impact × breadth) ÷ effort. **Recommended model** replaces a plain effort label: it reflects how much of each fix is load-bearing judgment versus mechanical edit, and whether a wrong-but-plausible fix would fail loudly (build/test) or silently (wrong pixels, stale state).

| #   | Finding                                        | Recommended model                                    |
| --- | ---------------------------------------------- | ---------------------------------------------------- |
| F1  | Overdue section not row-virtualized            | **Opus 5, plan mode (multi-PR)**                     |
| F2  | Toggle re-groups + re-sorts all 8,685 occs     | **Opus 5** (single PR)                               |
| F3  | Agenda re-expands on every mount               | **Sonnet 5** if cache key specified; else **Opus 5** |
| F4  | CM decorations rebuild whole doc per keystroke | **Sonnet 5**                                         |
| F5  | Octokit eagerly bundled                        | **Sonnet 5** (Haiku 4.5 with an exact file list)     |

**Where Haiku 4.5 actually fits:** none of the five fixes, but it's well-suited to _re-running the measurement recipes_ after each fix lands — they're fully scripted (patch counter, drive the interaction, read `window.__last`/`__rc`, revert). A good cheap verification pass between PRs.

**Sequencing note:** F1 and F3 both rework the same hook (`useExpandWithMultiday` / `AgendaView`'s virtualizer), and F2 changes the identity contract that F3's cache would key on. If doing all three, **F2 → F3 → F1** avoids rebasing the same code twice; the F1 plan should be written _after_ F2 lands so it plans against the new identity model.

---

### F1 — The Overdue section is one un-row-virtualized block; thousands of rows mount in a single commit

- **Flows affected:** 2 (scrolling up through the agenda, and the **Today** button — `goToday` targets the overdue index), 6 (cold start when that scroll fires), 1 (toggling a task _inside_ overdue). Hit **every time the overdue section enters the viewport.**
- **Category:** `render-amplification` `memory-and-leak` (scaling cliff that worsens as undone recurring/overdue tasks accumulate over a vault's life)
- **Impact:** **10** — a multi-second full freeze on an everyday navigation.
- **Baseline measurement:** On the 300-file vault the single overdue section contains **6,789 occurrences**. Dispatching a scroll that brought it into view mounted **6,937 `OccurrenceRow` components** (counted via a body-level render counter) in **one synchronous commit measured at ~12,900 ms** of blocked main thread (dev). Repeated attempts to read the DOM during the mount timed out (tab frozen). By contrast, the agenda at rest holds **12** rows.
- **Measurement recipe:**
  1. Enable big vault (`localStorage.setItem('meridian_bigvault','300')`), reload, skip tour.
  2. In `useAgendaSections`'s `sections` memo, temporarily record `out.find(s=>s.kind==='overdue').items.length` → `window.__sec.overdueRows` (read: **6789**).
  3. In `OccurrenceRow` body: `window.__rc.OccurrenceRow = (…||0)+1`.
  4. In the page: `const sc=document.querySelector('.overflow-y-auto'); window.__rc={}; const t0=performance.now(); sc.scrollTop=30000; sc.dispatchEvent(new Event('scroll')); void sc.offsetHeight; /* → tSyncMs≈12921, rows=6937 */`.
  5. Re-measure after fix: the same scroll should mount **≤ (viewport rows + overscan)**, i.e. tens, not thousands.
- **Breadth:** 1 section component fans out to ~6,900 rows (count from the render counter). Files: `src/calendar/OverdueSection.tsx`, `src/calendar/AgendaView.tsx`, `src/calendar/useAgendaSections.ts`.
- **Recommended model:** **Opus 5, plan mode (multi-PR)** — two of the three hard parts aren't code. First, a genuine product call: cap the overdue section with a "show more" (small, ships this week, leaves the cliff at the cap) versus flattening sections+rows into one virtual list (correct, much larger). Second, flattening ripples through things that are load-bearing and non-obvious: `estimateSection`, the persisted `agendaScrollOffset`/`agendaScrollMeasurements` restore, `goToIndex`'s scroll-to-today, the `updateTopDate` scroll listener that maps a virtual index back to a section's `dateKey`, and the `FlipList` animations that currently assume a section owns its rows. That wants a written plan and staged PRs, not one pass.
- **Evidence:** The virtualizer counts **sections**, not rows — `src/calendar/AgendaView.tsx:62`: `const virtualizer = useVirtualizer({` / `count: sections.length,` — and the overdue section renders every item with no inner cap, `src/calendar/OverdueSection.tsx:29`: `{items.map(o => (` … while `src/calendar/useAgendaSections.ts:107` pours _all_ overdue occurrences into that one section: `if (overdueItems.length > 0) {` / `out.push({ kind: 'overdue', key: '__overdue__', items: overdueItems })` / `}`
- **Problem:** Because virtualization is section-granular and the overdue section is unbounded, the moment it scrolls into view React mounts one row component per overdue occurrence at once — thousands of touch-listener effects, `useState`s and backlink lookups in a single commit — freezing the app for seconds.
- **Fix:** Virtualize _rows_ (flatten sections+rows into one flat virtual list, or paginate/cap the overdue section with a "show more"). Expected: rows mounted per scroll should drop from **~6,937 to a few dozen**, and the freeze from seconds to one frame.

---

### F4 — Editor decorations rebuild over the whole document on every keystroke

- **Flows affected:** 7 (typing in the editor). Hit **every keystroke**, but the cost scales with note length — negligible on typical short entries, painful on long ones.
- **Category:** `editor-latency`
- **Impact:** **5** — imperceptible on the common short note (0.1 ms), but a clear scaling cliff: a large note drops well below the 60 fps budget on every keypress, and the task plugin has the same shape (doubling it).
- **Baseline measurement:** Tiny generated body (1 line, 2 links, 84 chars): wikilink `build()` **≈ 0.1 ms/keystroke**. After replacing the body with a **400-line / ~32 KB / 400-wikilink** doc: **~20–31 ms/keystroke, spiking to 84–99 ms** (10 consecutive inserts logged: `[26.3, 99.2, 21.9, 25.9, 24.2, 21.7, 20.4, 84.2, 31.3, 24.8]`).
- **Measurement recipe:**
  1. Open any entry. In `wikilinkDecorations.ts` `build()`, wrap the body in a `performance.now()` delta pushed to `window.__wlLog`.
  2. In the page, get the view (`document.querySelector('.cm-content')` → CM `EditorView`), `dispatch` a 400-line doc with `[[link-N]]` per line, then dispatch 10 single-char inserts; read `window.__wlLog`.
  3. After fix, re-run on the same doc: per-keystroke should be flat (viewport-bounded), not O(doc).
- **Breadth:** 2 plugins, both whole-doc-per-keystroke. Files: `src/editor/cm/wikilinkDecorations.ts`, `src/editor/cm/taskDecorations.ts`.
- **Recommended model:** **Sonnet 5** — restricting to `view.visibleRanges` is an idiomatic CM6 pattern, but the hazard is that it means parsing substrings instead of `doc.toString()`, and the position offsets have to be re-based correctly or chips render over the wrong text (visually obvious, but easy to ship if nobody looks). `RangeSetBuilder` also requires ranges added in ascending order. Worth asking for a decoration-position test alongside the change, since `taskLines.test.ts` covers the line map but not the resulting ranges.
- **Evidence:** `src/editor/cm/wikilinkDecorations.ts:92`: `const allLinks = parseWikilinks(doc.toString())` (re-parses the entire document) followed by `src/editor/cm/wikilinkDecorations.ts:100`: `for (let i = 1; i <= doc.lines; i++) {` (iterates every line), rebuilt whenever `update.docChanged` fires.
- **Problem:** Each keystroke re-parses and re-scans the whole document to rebuild decorations, so editing a long note stutters even though only the edited line changed.
- **Fix:** Scope the rebuild to the viewport + changed ranges (`update.view.visibleRanges`, `update.changes`), or cache the parse per doc-version. Expected: per-keystroke ~25 ms → ~1 ms on the 400-line doc, independent of length.

---

### F5 — Octokit (GitHub backend) is eagerly bundled into the main entry chunk

- **Flows affected:** 6 (cold start). Paid on **every launch**, by every user, regardless of backend.
- **Category:** `bundle-and-startup`
- **Impact:** **4** — a modest, unconditional startup tax; the GitHub client is only needed by GitHub vaults, yet Tutorial/local-folder users download and parse it on every cold start.
- **Baseline measurement:** Production `main` chunk = **451.23 kB raw / 144.68 kB gzip**. Stubbing out the Octokit import and rebuilding → **404.26 kB / 129.59 kB gzip**. Delta = **~47 kB raw / ~15.1 kB gzip** of always-eager Octokit + throttling plugin. (For scale, the whole eager cold-start payload is ~main 144.7 + model 47.9 + calendar 70.6 + Match 15.8 + css 19.9 ≈ **~300 kB gzip**; the lazily-split `editor` chunk is a separate **724 kB / 245 kB gzip** loaded on first entry-open — correctly code-split, so not eager.)
- **Measurement recipe:**
  1. `pnpm run build`; record `dist/assets/main-*.js` gzip (**144.68 kB**).
  2. Temporarily replace `makeOctokit`'s body in `src/storage/githubApi.ts` with a stub (drop the two `@octokit/*` imports); `npx vite build`; record new `main` gzip (**129.59 kB**). Delta = Octokit's footprint. Revert.
  3. After fix (lazy GitHub backend), re-run step 1: `main` should drop by ~15 kB gzip and Octokit should appear only in a github-specific async chunk.
- **Breadth:** static import chain `restoreVaults` → `vaultRegistry` → `githubBackend` → `githubApi` → `@octokit/*` (found via grep of the built `main` chunk: 31× `octokit`, 3× `throttling`). Files: `src/storage/githubApi.ts`, `src/storage/vaultRegistry.ts:13`.
- **Recommended model:** **Sonnet 5**, or **Haiku 4.5** if handed the exact file list plus the build-diff gate. The trap that voids the fix: lazying `GitHubBackend` in `vaultRegistry`'s three call sites is _not sufficient_ — `storage/index.ts` re-exports `startGitHubSignIn`/`completeGitHubSignIn`/`fetchInstalledRepos` from `githubOAuth.ts`, which itself does `import { makeOctokit } from './githubApi'`, and `__root.tsx` imports that barrel eagerly for `restoreVaults`. So Octokit stays in the entry chunk unless the OAuth module is lazied too. Note also that `vite.config.ts` hard-throws on `CYCLIC_CROSS_CHUNK_REEXPORT`, so a sloppy barrel edit fails the build rather than degrading quietly.
- **Evidence:** `src/storage/githubApi.ts:1`: `import { Octokit } from '@octokit/core'` pulled eagerly via `src/storage/vaultRegistry.ts:13`: `import { GitHubBackend }  from './githubBackend'` (and `vaultRegistry`'s `restoreVaults`/`buildBackend` run at startup from `__root`).
- **Problem:** The GitHub client is in the initial critical-path bundle for everyone, so users who never touch GitHub still pay ~15 kB gzip of download + parse on every launch.
- **Fix:** `await import('./githubBackend')` inside `buildBackend`/`addGitHubVault` (all already async) and lazy-import `ensureFreshAccessToken`, so Octokit moves to a GitHub-only chunk. Expected: `main` gzip 144.7 → ~129.6 kB.

---

**Note on what's deliberately right (verified — don't re-investigate):**

- **Toggle React re-renders** — memoization holds: 1 row re-rendered per toggle, not the visible screen (refutes "missing memo" concerns; `OccurrenceRow`/`DaySection` `occArraysEqual` + the overlay's reference-stable occs work as designed).
- **Search** — 2.2 ms per debounced query over 300 files → 90 results; the 150 ms debounce and file-granular scan are fine.
- **Persistence timing** — `writeEntity` is fired _after_ `setData` and is async; YAML serialize + IndexedDB write never block the toggle paint (and short-circuit on the read-only example backend).
- **Title-edit metadata path** — title keystrokes don't reach `setData`/`buildBacklinkIndex` (no per-keystroke backlink rebuild); `buildBacklinkIndex` itself is ~1.2 ms.
