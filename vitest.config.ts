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
        // shadcn registry components and route registration are boilerplate,
        // not application logic worth a coverage floor. components/ui/ is kept
        // as a faithful mirror of the shadcn registry precisely so this
        // exclusion stays true — our own shared primitives live in
        // components/primitives/ (and feature-owned ones in their feature dir),
        // where they ARE counted. Don't hand-write first-party files in here.
        'src/components/ui/**',
        'src/routes/**',
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
        statements: 55,
        branches: 52,
        functions: 46,
        lines: 57,
        'src/model/collapse.ts': { statements: 90, branches: 80, functions: 95, lines: 90 },
        'src/editor/cm/taskLines.ts': { statements: 90, branches: 80, functions: 95, lines: 95 },
        'src/editor/cm/markdownFormatting.ts': { statements: 88, branches: 78, functions: 70, lines: 87 },
        'src/editor/cm/ReactWidget.ts': { statements: 78, branches: 90, functions: 50, lines: 77 },
        'src/types.ts': { statements: 90, branches: 80, functions: 85, lines: 90 },
        'src/storage/conflictError.ts': { statements: 90, branches: 85, functions: 95, lines: 95 },
        'src/editor/dialogs/RepeatDialog.tsx': { statements: 75, branches: 60, functions: 65, lines: 75 },
        'src/occurrenceActions.ts': { statements: 85, branches: 75, functions: 80, lines: 88 },
        'src/editor/useEntryEditor.ts': { statements: 68, branches: 55, functions: 55, lines: 70 },
        'src/storeCommit.ts': { statements: 30, branches: 95, functions: 45, lines: 35 },
        'src/storage/sync.ts': { statements: 68, branches: 55, functions: 55, lines: 72 },
        // First-party primitives lifted out of components/ui/, where the
        // coverage exclusion had kept them invisible.
        'src/components/primitives/responsive-modal.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/components/primitives/icon-button.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/editor/dialogs/TimeWheels.tsx': { statements: 88, branches: 78, functions: 95, lines: 95 },
        'src/editor/FloatingComboboxList.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
        'src/calendar/ContinuationChevron.tsx': { statements: 92, branches: 90, functions: 95, lines: 92 },
      },
    },
  },
})
