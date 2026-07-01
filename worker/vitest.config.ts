import { defineConfig } from 'vitest/config'

// The handlers under test use only standard Fetch API globals
// (Request/Response/FormData/URLSearchParams), so a plain Node environment
// is enough — no need for @cloudflare/vitest-pool-workers here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
