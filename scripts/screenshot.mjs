/**
 * Screenshot app routes at phone and desktop width, in light and dark, so a
 * UI change can be checked in a real browser in one command.
 *
 *   pnpm run screenshot                                   # the agenda
 *   pnpm run screenshot /settings /entry/example/01-start-here
 *   pnpm run screenshot --out some/dir /week
 *
 * Paths are relative to the /meridian base. Reuses a dev server already on
 * SHOT_PORT (default 5292), else starts one and stops it afterwards. Each path
 * is reached by in-app navigation after the Tutorial vault has loaded, because
 * a hard load of an entry URL races vault loading ("Item not found"). Page
 * errors and console errors are printed, since they are as much a result as
 * the pictures.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.SHOT_PORT || 5292)
const BASE = `http://127.0.0.1:${PORT}/meridian`
const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const OUT = outIdx >= 0 ? argv.splice(outIdx, 2)[1] : 'test-results/screenshots'
const PATHS = argv.length ? argv : ['/']
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } }
const SCHEMES = ['light', 'dark']

const sleep = ms => new Promise(r => setTimeout(r, ms))
const up = () => fetch(`${BASE}/`).then(() => true, () => false)

async function startDevServer() {
  // Own process group, so the pnpm → vite chain can be stopped as a whole.
  const child = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', detached: true })
  for (let i = 0; i < 360; i++) {
    if (await up()) return child
    await sleep(250)
  }
  process.kill(-child.pid)
  throw new Error(`vite never answered ${BASE}`)
}

const server = (await up()) ? null : await startDevServer()
// Cloud sessions ship one Chromium that may not match the pinned Playwright.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium'
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {})
mkdirSync(OUT, { recursive: true })
try {
  for (const path of PATHS) {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      for (const colorScheme of SCHEMES) {
        const page = await browser.newPage({ viewport, colorScheme })
        page.on('pageerror', e => console.log(`  pageerror ${path}: ${e.message}`))
        page.on('console', m => { if (m.type() === 'error') console.log(`  console.error ${path}: ${m.text()}`) })
        await page.goto(`${BASE}/`)
        await page.waitForSelector('[data-testid="entry-card"]', { timeout: 60_000 })
        if (path !== '/') {
          await page.evaluate(p => {
            history.pushState(null, '', `/meridian${p}`)
            dispatchEvent(new PopStateEvent('popstate'))
          }, path)
        }
        await page.waitForLoadState('networkidle')
        await sleep(300) // let enter animations finish
        const file = `${OUT}/${path.replace(/^\/|\/$/g, '').replace(/\//g, '_') || 'agenda'}-${vpName}-${colorScheme}.png`
        await page.screenshot({ path: file, fullPage: true })
        console.log(file)
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
  if (server) process.kill(-server.pid)
}
