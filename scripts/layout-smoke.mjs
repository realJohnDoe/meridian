import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

/**
 * Layout smoke checks — the one class of bug nothing else here can see.
 *
 * Every test in `src/` runs under jsdom, which has no layout engine: it has no
 * opinion about how tall an element is, whether the document scrolls, or where
 * on screen anything lands. So an entire family of regressions passes `build`,
 * `lint` and 3000+ unit tests untouched. Two shipped inside two days:
 *
 *   - the app shell lost its one-screen cap, so the *document* scrolled instead
 *     of the agenda: the topbar scrolled away, rows started ~2500px below the
 *     fold, the search bar sat at the very end of the page, and scroll-to-today
 *     silently did nothing (the agenda's scroll element had no overflow left);
 *   - before that, the flow shell released a row pane's flex sizing along the
 *     wrong axis, pinning the app column to its content width — 412px viewport
 *     against a 729px document, with the backdrop showing beside the app.
 *
 * Both were caught by hand, on a Pixel 7 viewport, after a user noticed. Each
 * is one assertion below. That is the whole ambition here: not a UI test suite,
 * but a handful of load-bearing geometric facts, checked at two viewports on
 * every PR.
 *
 * Run with `pnpm run test:layout` (needs `pnpm run build` first — it serves
 * `dist/` through `vite preview`). CI installs the browser with
 * `pnpm dlx playwright install --with-deps chromium`; set CHROMIUM_PATH to
 * point at an already-installed binary instead.
 */

// 127.0.0.1 rather than localhost, on both sides: a CI runner with IPv6
// enabled resolves `localhost` to ::1 first, which a server bound to the IPv4
// loopback never answers.
const HOST = '127.0.0.1'
const PORT = 4183
const BASE = `http://${HOST}:${PORT}/meridian`
const STARTUP_TIMEOUT_MS = 60_000

/** Viewports: a phone (where every one of these bugs was reported) and a laptop. */
const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
]

/**
 * `_app` routes — the fixed shell. Static paths only, so no date arithmetic here.
 *
 * Each carries the selector that means "this route has painted". It used to be
 * one hardcoded entry-card wait, which only works for routes that list entries;
 * the settings screens are `_app` routes with no entries in them, and the shell
 * invariants below are exactly as load-bearing there.
 */
const APP_ROUTES = ['/', '/backlog', '/notes']

/**
 * Routes on the document-flow chain, which hold the opposite invariant. Both
 * mount text inputs and no virtualizer, so they live outside `_app` precisely
 * so the browser can lift a focused input above the on-screen keyboard.
 * `ready` is the selector that means the route has painted.
 */
const FLOW_ROUTES = ['/entry/example/01-start-here', '/settings']

const failures = []
function check(scope, label, ok, detail) {
  if (ok) return
  failures.push(`${scope} — ${label}${detail === undefined ? '' : `: ${detail}`}`)
}

/**
 * Starts `vite preview` over the built `dist/`, and resolves once it actually
 * answers a request.
 *
 * Readiness is an HTTP poll rather than a match against the server's banner on
 * stdout. Scraping that was the first version and it was wrong twice over: it
 * couples the check to Vite's console format, and when it failed — as it did on
 * the first CI run — the only thing it could report was that 30 seconds had
 * passed, with the server's own output thrown away. Asking the server whether
 * it is up tests the thing that matters and keeps the output to say why not.
 */
async function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Kept whole, for the failure paths below — this is the only account of what
  // went wrong when the server never comes up in CI.
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  let exit = null
  child.on('exit', (code, signal) => { exit = signal ?? `code ${code}` })

  const died = () => new Error(
    `vite preview exited (${exit}) before serving ${BASE}. Did \`pnpm run build\` run first?\n` +
    `--- vite preview output ---\n${log || '(nothing)'}`,
  )

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exit !== null) throw died()
    try {
      // Any HTTP answer means the server is listening; the status is the app's
      // business, not the server's readiness.
      await fetch(`${BASE}/`)
      return child
    } catch {
      await new Promise(r => setTimeout(r, 250))
    }
  }
  child.kill()
  throw new Error(
    `vite preview never answered ${BASE} within ${STARTUP_TIMEOUT_MS / 1000}s.\n` +
    `--- vite preview output ---\n${log || '(nothing)'}`,
  )
}

/**
 * The geometry every `_app` route must hold at every viewport. Read in one
 * evaluate() so the numbers all come from the same frame.
 */
function readAppShell() {
  const se = document.scrollingElement
  const topbar = document.querySelector('[data-topbar]')
  const bar = document.querySelector('.search-bar-wrap')
  return {
    docScrollH: se.scrollHeight,
    docClientH: se.clientHeight,
    docScrollW: se.scrollWidth,
    docClientW: se.clientWidth,
    topbarTop: topbar ? Math.round(topbar.getBoundingClientRect().top) : null,
    searchBar: bar
      ? { top: Math.round(bar.getBoundingClientRect().top), bottom: Math.round(bar.getBoundingClientRect().bottom) }
      : null,
    innerHeight: window.innerHeight,
  }
}

/** Agenda-only: the virtualizer's own element has to be the thing that scrolls. */
function readAgenda() {
  const row = document.querySelector('[data-index]')
  const scroller = row?.closest('.overflow-y-auto') ?? null
  const rows = [...document.querySelectorAll('[data-index]')]
  const onScreen = rows.filter(r => {
    const b = r.getBoundingClientRect()
    return b.bottom > 0 && b.top < window.innerHeight
  })
  return {
    scroller: scroller ? { scrollH: scroller.scrollHeight, clientH: scroller.clientHeight } : null,
    mountedRows: rows.length,
    onScreenRows: onScreen.length,
  }
}

/**
 * The flow routes are the opposite invariant: the document must be *able* to
 * grow past the viewport, which is what lets the browser lift a focused input
 * above the on-screen keyboard without any visualViewport arithmetic. Tested
 * as a capability rather than by reading CSS back — append something tall and
 * see whether the document actually grew.
 *
 * The probe goes inside the route's own content, marked `data-flow-screen`,
 * NOT on document.body. body carries only `min-height` (see index.css); the
 * one-screen cap lives on `_app`'s own wrapper, several levels below it. A
 * probe appended to body is therefore a sibling of that cap and grows the
 * document on *every* route — this check passed on `/backlog` before it was
 * anchored here, which is to say it was asserting nothing at all.
 */
function probeFlow() {
  const se = document.scrollingElement
  const host = document.querySelector('[data-flow-screen]')
  if (!host) return { missing: true, clientH: se.clientHeight }
  const before = se.scrollHeight
  const probe = document.createElement('div')
  probe.style.cssText = 'height:3000px;width:1px'
  host.appendChild(probe)
  const after = se.scrollHeight
  probe.remove()
  return { before, after, clientH: se.clientHeight }
}

const preview = await startPreview()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
})

try {
  for (const { name, ...contextOptions } of VIEWPORTS) {
    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    page.on('pageerror', e => failures.push(`${name} — uncaught page error: ${e.message}`))

    for (const route of APP_ROUTES) {
      const scope = `${name} ${route}`
      await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
      await page.waitForSelector('[data-testid="entry-card"]', { timeout: 30_000 })
      await page.waitForTimeout(1500) // let the virtualizer measure and settle

      const m = await page.evaluate(readAppShell)
      // The shell clips itself at one screen, so nothing below it can extend
      // the page. A scrolling document here means the cap is gone.
      check(scope, 'document must not scroll vertically', m.docScrollH <= m.docClientH, `${m.docScrollH} > ${m.docClientH}`)
      check(scope, 'document must not scroll horizontally', m.docScrollW <= m.docClientW, `${m.docScrollW} > ${m.docClientW}`)
      check(scope, 'topbar must sit at the top of the viewport', m.topbarTop === 0, `top=${m.topbarTop}`)
      check(scope, 'search bar must be on screen', m.searchBar !== null && m.searchBar.top >= 0 && m.searchBar.bottom <= m.innerHeight,
        m.searchBar ? `top=${m.searchBar.top} bottom=${m.searchBar.bottom} viewport=${m.innerHeight}` : 'not rendered')

      if (route !== '/') continue
      const a = await page.evaluate(readAgenda)
      check(scope, 'the agenda must own a scrollable element', a.scroller !== null && a.scroller.scrollH > a.scroller.clientH,
        a.scroller ? `scrollHeight=${a.scroller.scrollH} clientHeight=${a.scroller.clientH}` : 'no scroll container found')
      check(scope, 'agenda rows must be visible', a.onScreenRows > 0, `${a.mountedRows} mounted, none on screen`)

      // The quick-nav panel (CLAUDE.md's month-label disclosure) grows the
      // topbar chrome block in place via a grid-template-rows transition —
      // exactly the kind of height change that cracked _app's one-screen cap
      // open twice before. Open it here and re-check the same shell geometry,
      // plus the panel's own focus contract (focus moves in on open, Escape
      // returns it to the toggle button).
      await page.click('[aria-controls="quickNavPanel"]')
      await page.waitForTimeout(400) // past the 200ms open transition
      const withPanel = await page.evaluate(readAppShell)
      check(scope, 'document must not scroll vertically with the quick-nav panel open',
        withPanel.docScrollH <= withPanel.docClientH, `${withPanel.docScrollH} > ${withPanel.docClientH}`)
      check(scope, 'document must not scroll horizontally with the quick-nav panel open',
        withPanel.docScrollW <= withPanel.docClientW, `${withPanel.docScrollW} > ${withPanel.docClientW}`)

      const focusedInPanel = await page.evaluate(() => {
        const panel = document.getElementById('quickNavPanel')
        return !!panel && panel.contains(document.activeElement)
      })
      check(scope, 'focus moves into the quick-nav panel on open', focusedInPanel)

      await page.keyboard.press('Escape')
      const focusedBackOnToggle = await page.evaluate(() =>
        document.activeElement === document.querySelector('[aria-controls="quickNavPanel"]'))
      check(scope, 'Escape returns focus to the quick-nav toggle button', focusedBackOnToggle)
    }

    // The routes whose invariant runs the other way.
    for (const route of FLOW_ROUTES) {
      const scope = `${name} ${route}`
      await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
      await page.waitForSelector('[data-flow-screen]', { timeout: 30_000 })
      await page.waitForTimeout(1500)

      const f = await page.evaluate(probeFlow)
      check(scope, 'the route content must be able to grow the document past the viewport',
        !f.missing && f.after > f.clientH,
        f.missing
          ? 'no [data-flow-screen] element found'
          : `scrollHeight stayed at ${f.after} with a 3000px probe appended (viewport ${f.clientH})`)

      // The search bar is `_app` furniture — it searches and creates entries.
      // A flow route is outside that shell and must not carry it.
      const bar = await page.evaluate(() => document.querySelector('.search-bar-wrap') !== null)
      check(scope, 'the app search bar must not render here', bar === false)
    }

    await context.close()
  }
} finally {
  await browser.close()
  preview.kill()
}

if (failures.length) {
  console.error(`\nLayout smoke checks failed (${failures.length}):\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('')
  process.exit(1)
}
console.log('Layout smoke checks passed.')
