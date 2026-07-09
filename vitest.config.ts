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
      },
    },
  },
})
