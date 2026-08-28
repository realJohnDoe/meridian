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
        // Route registration: the `_app*`/`_entry*` files wire a component to a
        // path and little else. Deliberately NOT all of src/routes/ — `-`
        // prefixed files aren't routes at all (TanStack ignores them; see
        // routeFileIgnorePrefix), they're ordinary modules that live here
        // because their callers do, and __root.tsx / auth.callback.tsx carry
        // real logic. All of those are counted and tested.
        'src/routes/_app*.tsx',
        'src/routes/_entry*.tsx',
        'src/routeTree.gen.ts',
        'src/main.tsx',
      ],
      // Per-file floors for modules already well-covered, so they can't
      // silently regress. Set a few points below measured coverage to leave
      // headroom for legitimate branches added later.
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
        'src/storeCommit.ts': { statements: 30, branches: 95, functions: 45, lines: 35 },
        'src/storage/sync.ts': { statements: 85, branches: 78, functions: 88, lines: 88 },
        // The parse/round-trip reporting cluster split out of sync.ts (health
        // survey finding #10, part A) — guarded on its own rather than
        // inheriting only the global floor.
        'src/storage/parseReport.ts': { statements: 92, branches: 78, functions: 85, lines: 94 },
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
        'src/routes/-entryRoute.ts': { statements: 92, branches: 85, functions: 95, lines: 95 },
        'src/routes/-entryTopbar.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/routes/-pagedTopbar.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/routes/-topbarEdgePadding.ts': { statements: 92, branches: 90, functions: 95, lines: 92 },
      },
    },
  },
})
