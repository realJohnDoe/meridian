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
