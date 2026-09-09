import { defineConfig } from '@playwright/test'

/**
 * Config for the two browser-driven checks in `e2e/` — layout geometry
 * (`layout-smoke.spec.ts`) and the WCAG contrast sweep (`contrast-sweep.spec.ts`).
 * Both need a real layout engine and real compositing, which is exactly what
 * `src/`'s jsdom-based Vitest suite doesn't have — see each spec file's own
 * doc comment for what it checks and why.
 *
 * Needs `pnpm run build` first: `webServer` below serves the built `dist/`
 * through `vite preview`, the same way `pnpm run preview` does. It does not
 * run the build itself, matching the CI step ordering in `build.yml`.
 *
 * `CHROMIUM_PATH`, if set, launches that binary instead of the browser
 * Playwright would otherwise resolve — this sandbox's preinstalled chromium
 * doesn't match what a bare `@playwright/test` install expects by default
 * (it resolves a headless-shell-only revision that isn't the one preinstalled
 * here), so local runs need `CHROMIUM_PATH=/opt/pw-browsers/chromium-<rev>/chrome-linux/chrome`.
 * CI installs the exact matching browser via `playwright install` instead and
 * leaves this unset.
 */

// 127.0.0.1 rather than localhost, on both sides: a CI runner with IPv6
// enabled resolves `localhost` to ::1 first, which a server bound to the IPv4
// loopback never answers.
const HOST = '127.0.0.1'
const PORT = 4183
export const BASE_URL = `http://${HOST}:${PORT}/meridian`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: `pnpm exec vite preview --host ${HOST} --port ${PORT} --strictPort`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
})
