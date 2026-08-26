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

const PORT = 4183
const BASE = `http://localhost:${PORT}/meridian`

/** Viewports: a phone (where every one of these bugs was reported) and a laptop. */
const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
]

/** `_app` routes — the fixed shell. Static paths only, so no date arithmetic here. */
const APP_ROUTES = ['/', '/backlog', '/notes']

const failures = []
function check(scope, label, ok, detail) {
  if (ok) return
  failures.push(`${scope} — ${label}${detail === undefined ? '' : `: ${detail}`}`)
}

function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview did not start within 30s')), 30_000)
    const onData = d => {
      if (!d.toString().includes(`:${PORT}`)) return
      clearTimeout(timer)
      resolve(child)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code => reject(new Error(`vite preview exited with code ${code} — did you run pnpm run build?`)))
  })
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
 * The entry routes are the opposite invariant: the document must be *able* to
 * grow past the viewport, which is what lets the browser lift a focused input
 * above the on-screen keyboard without any visualViewport arithmetic. Tested
 * as a capability rather than by reading CSS back — append something tall and
 * see whether the document actually grew.
 */
function probeFlow() {
  const se = document.scrollingElement
  const before = se.scrollHeight
  const probe = document.createElement('div')
  probe.style.cssText = 'height:3000px;width:1px'
  document.body.appendChild(probe)
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
    }

    // One entry route, for the invariant that runs the other way.
    const scope = `${name} /entry`
    await page.goto(`${BASE}/entry/example/01-start-here`, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    const f = await page.evaluate(probeFlow)
    check(scope, 'the document must be able to grow past the viewport', f.after > f.clientH,
      `scrollHeight stayed at ${f.after} with a 3000px probe appended (viewport ${f.clientH})`)

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
