import { defineConfig } from 'vitest/config'

// The handlers under test use only standard Fetch API globals
// (Request/Response/FormData/URLSearchParams), so a plain Node environment
// is enough — no need for @cloudflare/vitest-pool-workers here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Count every source file, not just ones a test happens to import —
      // mirrors the root config's rationale (see vitest.config.ts there).
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Set a few points below measured coverage to leave headroom, same
      // convention as the root config. This is the repo's most
      // security-sensitive code (SSRF guard, OAuth client secret), so a
      // floor here is what makes an unexercised branch fail CI instead of
      // slipping through unnoticed.
      thresholds: {
        statements: 87,
        branches: 74,
        functions: 82,
        lines: 92,
      },
    },
  },
})
