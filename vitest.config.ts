import { coverageConfigDefaults, defineConfig } from 'vitest/config'
import path from 'path'

// Standalone Vitest config — intentionally does NOT load the app's Vite plugins
// (PWA, the debug-page middleware, react-refresh). Most of the suite is pure TS
// with no DOM, so the default environment stays 'node' for speed; UI/hook tests
// that need a DOM opt in per-file with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test-utils/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Count every source file, not just ones a test happens to import —
      // otherwise whole untested modules silently vanish from the report.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // shadcn registry components are boilerplate, not application logic
        // worth a coverage floor. components/ui/ is kept as a faithful mirror
        // of the shadcn registry precisely so this exclusion stays true — our
        // own shared primitives live in components/primitives/ (and
        // feature-owned ones in their feature dir), where they ARE counted.
        // Don't hand-write first-party files in here.
        'src/components/ui/**',
        // Route registration: these files wire a component to a path and
        // little else. Deliberately NOT all of src/routes/ — `-` prefixed
        // files aren't routes at all (TanStack ignores them; see
        // routeFileIgnorePrefix), they're ordinary modules that live here
        // because their callers do, and __root.tsx / auth.callback.tsx carry
        // real logic. All of those are counted and tested. Listed
        // individually rather than as a `_app*`/`_entry*` glob — the glob
        // used to also swallow src/routes/_app.tsx, which is 569 lines of
        // topbar composition, quick-nav orchestration and focus management,
        // not registration (health-ui-results.md finding #6).
        'src/routes/_app.index.tsx',
        'src/routes/_app.backlog.tsx',
        'src/routes/_app.notes.tsx',
        'src/routes/_app.day.$date.tsx',
        'src/routes/_app.week.$date.tsx',
        'src/routes/_app.calendar.$month.tsx',
        // Entry routes: only the two that really are registration. Listed
        // individually for the same reason the `_app` routes above are — the
        // `_entry*.tsx` glob this replaces also swallowed
        // _entry.entry.$vault.$slug.tsx (occurrence resolution from the URL,
        // the view-only/editable branch, the not-found state) and
        // _entry.entry.new.tsx (draft resume keyed on TanStack's __TSR_key),
        // which are logic, not wiring. Un-excluding them measured them for the
        // first time: _entry.entry.new.tsx was already at 95/48/88/92 and is
        // floored below; _entry.entry.$vault.$slug.tsx was at 0/0/0/0
        // (health-results.md finding #6) and is now tested and floored below too.
        'src/routes/_entry.tsx',
        'src/routes/_entry.entry.$slug.tsx',
        'src/routeTree.gen.ts',
        'src/main.tsx',
      ],
      // Per-file floors for modules already well-covered, so they can't
      // silently regress. Set a few points below measured coverage to leave
      // headroom for legitimate branches added later — and record the measured
      // value in the comment beside anything non-obvious, because a floor is
      // only as honest as its distance from reality. That distance grows on its
      // own: coverage rises as tests land and nothing lowers the floor back
      // toward it, so a floor left alone drifts into guarding nothing.
      // storeCommit.ts sat at 30/95/45/35 against a measured 100/100/100/100
      // until 2026-09-06 for exactly that reason. Re-measure the floors
      // (`pnpm run test:coverage`) when running the health survey, per
      // plans/surveys/health.md's Budget.
      thresholds: {
        // Global floor. Per-file thresholds only guard the files they name, so
        // a brand-new untested logic module used to slip through the gate
        // entirely. This catches that: adding a sizeable unexercised module
        // drags the project total below the floor and fails CI. Kept a few
        // points under the measured total so ordinary UI work doesn't trip it.
        statements: 68,
        branches: 62,
        functions: 59,
        lines: 70,
        'src/model/collapse.ts': { statements: 90, branches: 80, functions: 95, lines: 90 },
        'src/editor/cm/taskLines.ts': { statements: 90, branches: 80, functions: 95, lines: 95 },
        'src/editor/cm/markdownFormatting.ts': { statements: 88, branches: 78, functions: 70, lines: 87 },
        'src/editor/cm/ReactWidget.ts': { statements: 78, branches: 90, functions: 50, lines: 77 },
        // The only XSS gate between file-/feed-derived `url:` frontmatter and a
        // rendered `<a href>` (health-ui-results.md finding #8) — a single
        // anchored allowlist regex, fully exercised by urlSafety.test.ts.
        'src/editor/urlSafety.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/model/fieldRegistry.ts': { statements: 90, branches: 80, functions: 85, lines: 90 },
        'src/model/storeOps.ts': { statements: 88, branches: 82, functions: 92, lines: 92 },
        'src/model/expansion.ts': { statements: 87, branches: 76, functions: 94, lines: 92 },
        'src/storage/conflictError.ts': { statements: 90, branches: 85, functions: 95, lines: 95 },
        // The durability + credentials layer: unsynced edits, tombstones and
        // GitHub tokens. Every other suite that touches it swaps in an
        // in-memory fake, so without these floors it can drift back to being
        // covered only by its own doubles. cache.test.ts runs the real Dexie
        // code against fake-indexeddb; keep it that way.
        'src/storage/cache/files.ts': { statements: 95, branches: 92, functions: 95, lines: 95 },
        'src/storage/cache/credentials.ts': { statements: 95, branches: 92, functions: 95, lines: 95 },
        'src/storage/cache/registry.ts': { statements: 95, branches: 92, functions: 95, lines: 95 },
        // db.ts sits lower on branches by design: cacheInit's
        // `_cacheInitPromise` re-entry guard is unreachable in practice (the
        // IIFE assigns `db` before its first await, so a concurrent caller
        // always returns on the `if (db)` line above it) and isn't worth
        // contorting a test to reach.
        'src/storage/cache/db.ts': { statements: 88, branches: 70, functions: 95, lines: 95 },
        // The iCal import: a pure text→markdown pipeline with no UI to notice a
        // regression in, feeding a read-only vault the user cannot correct by
        // hand. The parse and synthesis stages sit high because every branch is
        // reachable from a fixture. rruleToRepeat used to sit lower — its
        // bounded-expansion fallback has arms for BY* parts no mainstream
        // exporter emits — but repeatToRrule.test.ts now drives that walk over
        // a few hundred rules as the RFC-side oracle, so the floor reflects it.
        'src/storage/ical/icsParse.ts':      { statements: 92, branches: 85, functions: 95, lines: 95 },
        'src/storage/ical/icsDateTime.ts':   { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/storage/ical/icsToEntries.ts':  { statements: 90, branches: 82, functions: 95, lines: 94 },
        'src/storage/ical/rruleToRepeat.ts': { statements: 87, branches: 81, functions: 86, lines: 94 },
        'src/storage/ical/repeatToRrule.ts': { statements: 92, branches: 88, functions: 95, lines: 95 },
        'src/storage/icalBackend.ts':        { statements: 93, branches: 85, functions: 95, lines: 95 },
        'src/editor/dialogs/RepeatDialog.tsx': { statements: 75, branches: 60, functions: 65, lines: 75 },
        'src/occurrenceActions.ts': { statements: 85, branches: 75, functions: 80, lines: 88 },
        'src/editor/useEntryEditor.ts': { statements: 68, branches: 55, functions: 55, lines: 70 },
        'src/editor/useAutoSave.ts': { statements: 85, branches: 70, functions: 80, lines: 90 },
        'src/editor/useVaultTarget.ts': { statements: 88, branches: 72, functions: 90, lines: 95 },
        // The three one-way localStorage migrations (favorites, participant
        // filter, show-tasks) are now covered by store.migrations.test.ts;
        // this floor guards that from regressing without pinning the rest of
        // this cross-cutting file's many untested setters to the same bar.
        'src/store.ts': { statements: 68, branches: 55, functions: 58, lines: 68 },
        // The persistence commit path: every write, delete and cross-vault
        // move leaves through one of these five functions. Measured
        // 100/100/100/100 on 2026-09-06; floored just under that. The previous
        // floor was 30/95/45/35, which let two of the five go entirely
        // unexecuted with CI green — including commitMove's refusal branch,
        // the one thing standing between a mis-built `next` and writing an
        // empty file over the target before tombstoning the source.
        'src/storeCommit.ts': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'src/storage/sync.ts': { statements: 88, branches: 82, functions: 90, lines: 90 },
        // The three clusters split out of sync.ts (health survey finding #10):
        // the parse/round-trip reporting (part A), and the per-vault sync
        // state, the scheduler and the persistence-port write side (part B).
        // Each is guarded on its own rather than inheriting only the global
        // floor — before the split they were covered under sync.ts's, and
        // nothing else would hold them there.
        'src/storage/parseReport.ts': { statements: 92, branches: 78, functions: 85, lines: 94 },
        'src/storage/syncState.ts': { statements: 92, branches: 90, functions: 95, lines: 95 },
        'src/storage/syncScheduler.ts': { statements: 80, branches: 60, functions: 88, lines: 85 },
        // entityWrites sits lower than its old home because the split made its
        // two `catch` arms (a Dexie write failing outright) visible as their
        // own file rather than diluted across sync.ts. Still floored: a save
        // that vanishes silently is the worst bug this codebase can have.
        'src/storage/entityWrites.ts': { statements: 72, branches: 62, functions: 75, lines: 72 },
        // First-party primitives lifted out of components/ui/, where the
        // coverage exclusion had kept them invisible.
        'src/components/primitives/responsive-modal.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/components/primitives/icon-button.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/editor/dialogs/TimeWheels.tsx': { statements: 88, branches: 78, functions: 95, lines: 95 },
        'src/editor/FloatingComboboxList.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/calendar/ContinuationChevron.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        // src/routes/ files that are not route registration. auth.callback.tsx
        // is the OAuth phase machine — a regression there is a broken sign-in
        // with no other way in — so it gets the tightest floor here.
        'src/routes/auth.callback.tsx': { statements: 92, branches: 88, functions: 95, lines: 95 },
        'src/routes/__root.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        // Un-excluded from coverage (health-ui-results.md finding #6):
        // AppMain's shell layout and quick-nav panel mechanics, not
        // registration. Re-measured after finding #1 moved the per-view half
        // out to the chrome adapters below — the file got smaller and its
        // covered fraction rose, but the two Radix desktop-popover callbacks
        // (onOpenChange, onCloseAutoFocus) stay out of reach under jsdom and
        // now weigh more against a shorter file, which is why functions sits
        // well below -entryTopbar.tsx/-pagedTopbar.tsx's 95.
        'src/routes/_app.tsx': { statements: 75, branches: 80, functions: 55, lines: 85 },
        // The five per-view chrome adapters, the ViewChrome port they
        // implement and the composition root that picks between them
        // (health-ui-results.md finding #1). This is the per-view topbar and
        // quick-nav logic that used to live inside _app.tsx and was floored as
        // part of it; keeping it floored here is what stops the extraction
        // from quietly downgrading its guard. -weekChrome.tsx is the loosest
        // because its onBrowseMonthPreview only fires mid-gesture.
        'src/routes/-viewChrome.ts': { statements: 92, branches: 90, functions: 95, lines: 95 },
        'src/routes/-useViewChrome.ts': { statements: 92, branches: 90, functions: 95, lines: 95 },
        'src/routes/-dayChrome.tsx': { statements: 92, branches: 90, functions: 95, lines: 95 },
        'src/routes/-weekChrome.tsx': { statements: 88, branches: 78, functions: 75, lines: 90 },
        'src/routes/-monthChrome.tsx': { statements: 92, branches: 90, functions: 95, lines: 95 },
        'src/routes/-listChrome.ts': { statements: 92, branches: 90, functions: 95, lines: 95 },
        'src/routes/-agendaChrome.tsx': { statements: 92, branches: 82, functions: 95, lines: 95 },
        'src/entryRoute.ts': { statements: 92, branches: 85, functions: 95, lines: 95 },
        // Draft resume keyed on TanStack's history `__TSR_key` — without it a
        // returning user's second save minted `buy-milk-2` beside the first,
        // carrying none of the edits. Measured 95.12/48.48/88.23/92.59 on
        // 2026-09-06, its first measurement: the `_entry*.tsx` exclusion glob
        // had kept it out of the report entirely.
        'src/routes/_entry.entry.new.tsx': { statements: 92, branches: 44, functions: 85, lines: 90 },
        'src/routes/-entryTopbar.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/routes/-pagedTopbar.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/routes/-topbarEdgePadding.ts': { statements: 92, branches: 90, functions: 95, lines: 92 },
        // health-results.md finding #6: the URL->occurrence resolution route
        // (date/id disambiguation, the view-only vs editable branch, the
        // not-found state) and the app shell's sidebar/search bar, all
        // previously at ~0%. Measured 2026-09-06 via
        // _entry.entry.$vault.$slug.test.tsx, -appSidebar.test.tsx and
        // -searchBar.test.tsx: 97.14/82.35/92.59/95.74,
        // 92.18/90.47/90/92.5 and 96.77/92.59/100/95.65 respectively.
        'src/routes/_entry.entry.$vault.$slug.tsx': { statements: 92, branches: 77, functions: 87, lines: 91 },
        'src/routes/-appSidebar.tsx': { statements: 87, branches: 85, functions: 85, lines: 87 },
        'src/routes/-searchBar.tsx': { statements: 92, branches: 87, functions: 95, lines: 91 },
        // health-results.md finding #6: the add-vault wizard (all three steps,
        // the iCal preview/validate cycle, the folder-picker branch, the
        // tutorial-card offer) and two settings screens, all previously at
        // ~0%. Measured 2026-09-06: AddVaultWizard.tsx 100/91.3/100/100;
        // VaultDetail.tsx and AppearanceSettings.tsx both 100/100/100/100.
        'src/settings/AddVaultWizard.tsx': { statements: 95, branches: 86, functions: 95, lines: 95 },
        'src/settings/VaultDetail.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/settings/AppearanceSettings.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
      },
    },
  },
})
