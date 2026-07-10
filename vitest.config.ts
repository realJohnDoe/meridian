import { defineConfig } from 'vitest/config'
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
      // Per-file floors for modules already well-covered, so they can't
      // silently regress. Set a few points below measured coverage to leave
      // headroom for legitimate branches added later.
      thresholds: {
        'src/model/collapse.ts': { statements: 90, branches: 80, functions: 95, lines: 90 },
        'src/editor/cm/taskLines.ts': { statements: 90, branches: 80, functions: 95, lines: 95 },
        'src/types.ts': { statements: 90, branches: 80, functions: 85, lines: 90 },
        'src/storage/conflictError.ts': { statements: 90, branches: 85, functions: 95, lines: 95 },
        'src/editor/dialogs/RepeatDialog.tsx': { statements: 75, branches: 60, functions: 65, lines: 75 },
        'src/occurrenceActions.ts': { statements: 85, branches: 75, functions: 80, lines: 88 },
        'src/editor/useEntryEditor.ts': { statements: 68, branches: 55, functions: 55, lines: 70 },
        'src/storeCommit.ts': { statements: 30, branches: 95, functions: 45, lines: 35 },
        'src/storage/sync.ts': { statements: 68, branches: 55, functions: 55, lines: 72 },
      },
    },
  },
})
