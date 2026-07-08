import { defineConfig } from 'vitest/config'
import path from 'path'

// Standalone Vitest config — intentionally does NOT load the app's Vite plugins
// (PWA, the debug-page middleware, react-refresh). The model layer under test is
// pure TS with no DOM, so a plain Node environment keeps the suite fast and
// isolated from build-time concerns.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
