/**
 * Vault-scaling stress harness.
 *
 * Answers three questions that no unit test can: how each hot UI flow scales
 * with vault size, which unit the cost actually tracks (files or expanded
 * occurrences), and where memory runs out.
 *
 *   node scripts/perf/stress.mjs                     # default sizes
 *   node scripts/perf/stress.mjs --sizes 300,1000    # a subset
 *   node scripts/perf/stress.mjs --shapes mixed,flat # both vault shapes
 *   node scripts/perf/stress.mjs --skip-ui           # pipeline + Dexie only
 *
 * Results land in scripts/perf/results/<timestamp>.json and are printed as a
 * table. Runs against the **dev server**, because the large-vault generator is
 * dev-only (see storage/devFixtures/testVaultGen.ts) — so absolute ms are
 * inflated by unminified dev React and should be read as a scaling curve and
 * for before/after comparison, not as shipped latency.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { PROBE } from './probe.mjs'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PERF_PORT || 5291)
const BASE = `http://${HOST}:${PORT}/meridian`
const STARTUP_TIMEOUT_MS = 90_000

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const has = name => argv.includes(`--${name}`)

const SIZES = arg('sizes', '300,1000,3000,10000,30000').split(',').map(Number)
// `mixed` is the historical generator mix (15% of files are weekly series, so
// ~27 occurrences per file over the agenda window); `flat` has no recurrence
// at all, so occurrences === files. Running both at the same file counts is
// what separates "scales with files" from "scales with occurrences".
const SHAPE_BY_LABEL = {
  mixed: { label: 'mixed', recurringShare: 0.15 },
  flat:  { label: 'flat',  recurringShare: 0 },
}
const SHAPES = arg('shapes', 'mixed')
  .split(',')
  .map(l => SHAPE_BY_LABEL[l.trim()] ?? (() => { throw new Error(`unknown shape: ${l}`) })())
const SKIP_UI = has('skip-ui')
const SKIP_PIPELINE = has('skip-pipeline')
const SKIP_DEXIE = has('skip-dexie')
// A page that is thrashing can take minutes per interaction; past this we call
// the size unusable and move on rather than hanging the whole run.
const FLOW_TIMEOUT_MS = Number(arg('flow-timeout', 180_000))

// ── dev server ──────────────────────────────────────────────────────────────

async function startDevServer() {
  const child = spawn('pnpm', ['exec', 'vite', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  let exit = null
  child.on('exit', (code, signal) => { exit = signal ?? `code ${code}` })

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exit !== null) throw new Error(`vite exited (${exit}) before serving ${BASE}\n${log}`)
    try { await fetch(`${BASE}/`); return child } catch { await sleep(250) }
  }
  child.kill()
  throw new Error(`vite never answered ${BASE} in ${STARTUP_TIMEOUT_MS / 1000}s\n${log}`)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── per-page setup ──────────────────────────────────────────────────────────

/**
 * A fresh context per measurement, so IndexedDB, localStorage and the JS heap
 * of one vault size can never leak into the next one's numbers.
 */
async function freshPage(browser, spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(`
    try {
      localStorage.setItem('meridian_bigvault', ${JSON.stringify(JSON.stringify(spec))})
      localStorage.setItem('meridian_onboarded', 'true')
    } catch {}
  `)
  await context.addInitScript(PROBE)
  const page = await context.newPage()
  page.setDefaultTimeout(FLOW_TIMEOUT_MS)
  const crashes = []
  page.on('crash', () => crashes.push('page crashed (renderer OOM or kill)'))
  page.on('pageerror', e => crashes.push(`pageerror: ${String(e).slice(0, 200)}`))
  return { context, page, crashes }
}

/** JS heap as Chrome itself reports it — performance.memory is capped/quantized. */
async function heapMB(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const { metrics } = await cdp.send('Performance.getMetrics')
  await cdp.detach()
  const m = Object.fromEntries(metrics.map(x => [x.name, x.value]))
  return {
    heapUsedMB: +(m.JSHeapUsedSize / 1e6).toFixed(1),
    heapTotalMB: +(m.JSHeapTotalSize / 1e6).toFixed(1),
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
  }
}

// ── the UI flows ────────────────────────────────────────────────────────────

/**
 * The three UI flows worth their coupling: cold start, toggling a task, and
 * scrolling the agenda.
 *
 * Deliberately not measured here any more: the view switches, search, and
 * opening an entry (with the CodeMirror keystroke measurement that hung off
 * it). Between them they carried nine of this file's eleven DOM selectors,
 * including the two that already broke mid-run — `.now-line` and the results
 * virtualizer's internal spacer — and every one of them is a Tailwind or
 * library-internal class rather than a semantic marker. What they bought was
 * thin: search measured flat at every size (232–586 ms, of which 150 ms is
 * FileResultsList's own debounce) and CodeMirror keystrokes were 16.6–16.7 ms
 * at every size from 300 to 100 000 files. The three below use `[data-index]`,
 * a `data-testid` and `button[role="checkbox"]` — markers the app owns — plus
 * `.overflow-y-auto`, which `scripts/layout-smoke.mjs` already depends on, so
 * CI breaks with it rather than after it.
 *
 * The numbers those flows did produce are recorded in
 * `plans/surveys/vault-scaling.md`; that section of the report cannot be
 * reproduced by re-running this harness.
 */
async function measureUI(browser, spec) {
  const { context, page, crashes } = await freshPage(browser, spec)
  const r = { crashes }
  // Each flow is isolated: one that cannot find its target must not cost the
  // rest of the size their measurement, and at 30k "cannot find its target"
  // is itself a result worth recording.
  const flow = async (name, fn) => {
    try { r[name] = await fn() } catch (e) { r[name] = { error: String(e).split('\n')[0].slice(0, 160) } }
  }
  try {
    // First load primes this context's HTTP cache; the measured one is the
    // reload. In dev every module is its own request, and a cold context pays
    // ~12 s of them regardless of vault size — which would swamp the very
    // thing being measured. `vaultPaintMs` (DOMContentLoaded → first agenda
    // row) is the vault-dependent half either way, and is the number to read.
    await page.goto(`${BASE}/`, { waitUntil: 'load' })
    await page.waitForSelector('[data-index]', { timeout: FLOW_TIMEOUT_MS })
    const t0 = Date.now()
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('[data-index]', { timeout: FLOW_TIMEOUT_MS })
    r.coldStart = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const firstRow = window.__perf.firstRow() ?? performance.now()
      return {
        firstAgendaRowMs: +firstRow.toFixed(0),
        domContentLoadedMs: +nav.domContentLoadedEventEnd.toFixed(0),
        vaultPaintMs: +(firstRow - nav.domContentLoadedEventEnd).toFixed(0),
        blockingMs: window.__perf.tasksIn(0, firstRow).total,
        worstTaskMs: window.__perf.tasksIn(0, firstRow).max,
      }
    })
    r.wallClockLoadMs = Date.now() - t0
    r.afterLoad = await heapMB(page)
    r.mountedRows = await page.evaluate(() => document.querySelectorAll('[data-index]').length)

    // 1. Toggle a task: click → the checkbox repaints.
    await flow('toggle', () => page.evaluate(async () => {
      const box = document.querySelector('[data-testid="entry-card"] button[role="checkbox"]')
      if (!box) return { skipped: 'no checkbox on screen' }
      const before = box.getAttribute('aria-checked')
      // Done either way: the card repaints its own checkbox optimistically,
      // or the re-sort moves the occurrence and the node is replaced. Waiting
      // only for the attribute would hang on the second case.
      const out = await window.__perf.interaction(
        () => box.click(),
        () => !document.contains(box) || box.getAttribute('aria-checked') !== before,
      )
      out.rowReplaced = !document.contains(box)
      return out
    }))

    // 2. Scroll the agenda hard — virtualizer + per-row render cost under load.
    await flow('scroll', () => page.evaluate(async () => {
      const scroller = document.querySelector('[data-index]')?.closest('.overflow-y-auto')
      if (!scroller) return { skipped: 'no scroller' }
      return window.__perf.frames(async () => {
        for (let i = 0; i < 30; i++) {
          scroller.scrollTop += 900
          await window.__perf.raf()
        }
      })
    }))

    r.afterFlows = await heapMB(page)
  } catch (e) {
    r.error = String(e).slice(0, 400)
  } finally {
    await context.close().catch(() => {})
  }
  return r
}

// ── the data pipeline, module by module ─────────────────────────────────────

/**
 * Runs the real pipeline modules in the page via Vite's dev server, so each
 * stage's cost is attributable rather than lumped into "cold start". The
 * modules are imported by URL — the app is served under /meridian/, so its
 * source tree is at /meridian/src/….
 */
async function measurePipeline(browser, spec) {
  const { context, page, crashes } = await freshPage(browser, spec)
  const out = { crashes }
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'commit' })
    await page.waitForSelector('[data-index]', { timeout: FLOW_TIMEOUT_MS })
    out.result = await page.evaluate(async (spec) => {
      const gen = await import('/meridian/src/storage/devFixtures/testVaultGen.ts')
      const model = await import('/meridian/src/model/index.ts')
      const fio = await import('/meridian/src/fileIO.ts')
      const fom = await import('/meridian/src/fileOccurrence.ts')
      const store = await import('/meridian/src/store.ts')
      const sections = await import('/meridian/src/calendar/agendaSections.ts')
      const matching = await import('/meridian/src/lib/matching.ts')
      // Repeat cheap sizes for a median; at the top end one run each, since a
      // single pass already takes seconds and the extra copies are what push
      // the tab into an out-of-memory kill rather than a measurement.
      const reps = spec.count <= 3000 ? 3 : 1
      const b = (fn, n) => window.__perf.bench(fn, Math.min(n, reps))
      const r = {}
      // Heap after each stage, so "the vault does not fit in memory" can be
      // attributed to a structure rather than asserted about the whole app.
      // performance.memory is exact here — the browser is launched with
      // --enable-precise-memory-info.
      r.heapMB = {}
      const mark = (name) => {
        window.gc?.()
        const mem = performance.memory
        if (mem) r.heapMB[name] = +(mem.usedJSHeapSize / 1e6).toFixed(1)
      }
      mark('baseline')

      const files = gen.generateBigVault(spec.count, spec).map(e => ({ path: e.id + '.md', content: e.content }))
      r.bytes = files.reduce((a, f) => a + f.content.length, 0)
      mark('rawFiles')

      // parse: markdown+YAML → StoreItems, once per file
      let entries
      r.parse = await b(() => {
        entries = new Map()
        for (const f of files) {
          const res = model.parseToStoreItems(f.path, f.content, 'example')
          entries.set(res.key, res)
        }
      }, 3)

      mark('parsedEntries')

      // deriveViews: Entries → the flat items array + roots map
      let views
      r.deriveViews = await b(() => { views = store.deriveViews(entries, null) }, 3)
      r.files = entries.size
      r.storeItems = views.items.length

      r.backlinks = await b(() => { fom.buildBacklinkIndex(views.roots) }, 3)
      mark('derivedViews')

      // expansion over the agenda window (-365 / +90) — the occurrence unit
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const day = 86400000
      const from = new Date(today.getTime() - 365 * day)
      const to = new Date(today.getTime() + 90 * day)
      let occs
      r.expandAgendaWindow = await b(() => {
        occs = model.computeExpansionCache(null, views.items, views.roots, from, to).allOccs
      }, 3)
      r.occurrencesInAgendaWindow = occs.length
      mark('agendaExpansion')

      // grouping/sorting/filtering into virtualizable rows
      r.agendaSections = await b(() => {
        const res = sections.computeAgendaSections(null, occs, today, new Date(), o => o, today, true, 1)
        r.agendaRows = res.rows.length
      }, 3)

      // search ranking, one keystroke's worth
      const fileList = fom.fileEntries(views.roots)
      r.rankByQuery = await b(() => {
        const ranked = matching.rankByQuery('review', fileList,
          e => [e.title, ...e.tags, ...e.items].join(' '), e => e.title)
        r.searchHits = ranked.length
      }, 5)

      // the incremental toggle path: one item changes, everything downstream
      // is asked to notice only that
      const firstKey = [...entries.keys()][0]
      let cache = model.computeExpansionCache(null, views.items, views.roots, from, to)
      r.toggleRecompute = await b(() => {
        const entry = entries.get(firstKey)
        const item = entry.items[0]
        const nextItem = { ...item, metadata: { ...item.metadata, done: !item.metadata.done } }
        const nextEntry = { ...entry, items: [nextItem, ...entry.items.slice(1)] }
        const nextEntries = new Map(entries); nextEntries.set(firstKey, nextEntry)
        const nextViews = store.deriveViews(nextEntries, views)
        cache = model.computeExpansionCache(cache, nextViews.items, nextViews.roots, from, to)
      }, 3)

      // Last on purpose: this is the heaviest stage by a wide margin (a +/-3
      // year window, an order of magnitude more occurrences than the agenda's
      // own), so it is the one that can take the tab out. Running it last
      // means an out-of-memory kill costs only its own number.
      r.fileOccurrenceMap = await b(() => {
        const m = fom.updateFileOccurrenceMap(new Map(), new Map(), entries, views.roots)
        r.fomSize = m.size
      }, 1)
      mark('afterFileOccurrenceMap')

      return r
    }, spec)
    out.heap = await heapMB(page)
  } catch (e) {
    out.error = String(e).slice(0, 400)
  } finally {
    await context.close().catch(() => {})
  }
  return out
}

// ── Dexie ───────────────────────────────────────────────────────────────────

/**
 * The Tutorial backend is cache-free by design, so the app's own cold start
 * never touches Dexie at this scale. Every real backend does, so the cache is
 * measured directly: write the same vault through applyRemoteBatch, then read
 * it back the way hydrateFromCache does.
 */
async function measureDexie(browser, spec) {
  const { context, page, crashes } = await freshPage(browser, spec)
  const out = { crashes }
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'commit' })
    await page.waitForSelector('[data-index]', { timeout: FLOW_TIMEOUT_MS })
    out.result = await page.evaluate(async (spec) => {
      const gen = await import('/meridian/src/storage/devFixtures/testVaultGen.ts')
      const cache = await import('/meridian/src/storage/cache/files.ts')
      const r = {}
      const files = gen.generateBigVault(spec.count, spec)
        .map(e => ({ path: e.id + '.md', content: e.content, version: 'v1' }))
      r.bytes = files.reduce((a, f) => a + f.content.length, 0)

      let t = performance.now()
      const written = await cache.applyRemoteBatch('perfvault', files)
      r.writeMs = Math.round(performance.now() - t)
      r.written = written.length

      t = performance.now()
      const rows = await cache.cacheLoadAll('perfvault')
      r.readAllMs = Math.round(performance.now() - t)
      r.rows = rows.length

      t = performance.now()
      await cache.cacheGetDirty('perfvault')
      r.dirtyScanMs = Math.round(performance.now() - t)

      const est = await navigator.storage.estimate()
      r.quotaMB = +(est.quota / 1e6).toFixed(0)
      r.usageMB = +(est.usage / 1e6).toFixed(1)
      return r
    }, spec)
    out.heap = await heapMB(page)
  } catch (e) {
    out.error = String(e).slice(0, 400)
  } finally {
    await context.close().catch(() => {})
  }
  return out
}

// ── driver ──────────────────────────────────────────────────────────────────

const server = await startDevServer()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
})

// Vite compiles each module on first request, and the entry/editor routes are
// lazily loaded — on a cold dev server that lands entirely in whichever size
// runs first (13 s of it, measured). One throwaway pass over every flow on a
// tiny vault moves that cost outside the measurements.
console.log('warming the dev server (module transform + lazy routes)...')
await measureUI(browser, { count: 20, recurringShare: 0.15 })

const runs = []
try {
  for (const shape of SHAPES) {
    for (const count of SIZES) {
      const spec = { count, recurringShare: shape.recurringShare }
      const label = `${shape.label}/${count}`
      const entry = { shape: shape.label, count, spec }
      console.log(`\n=== ${label} ===`)

      if (!SKIP_PIPELINE) {
        const t = Date.now()
        entry.pipeline = await measurePipeline(browser, spec)
        console.log(`  pipeline  ${((Date.now() - t) / 1000).toFixed(0)}s`, JSON.stringify(entry.pipeline.result ?? entry.pipeline.error))
      }
      if (!SKIP_UI) {
        const t = Date.now()
        entry.ui = await measureUI(browser, spec)
        console.log(`  ui        ${((Date.now() - t) / 1000).toFixed(0)}s`, JSON.stringify({
          cold: entry.ui.coldStart, toggle: entry.ui.toggle, scroll: entry.ui.scroll,
          month: entry.ui.toMonth, search: entry.ui.search, heap: entry.ui.afterFlows,
          err: entry.ui.error, crashes: entry.ui.crashes,
        }))
      }
      if (!SKIP_DEXIE) {
        const t = Date.now()
        entry.dexie = await measureDexie(browser, spec)
        console.log(`  dexie     ${((Date.now() - t) / 1000).toFixed(0)}s`, JSON.stringify(entry.dexie.result ?? entry.dexie.error))
      }
      runs.push(entry)
    }
  }
} finally {
  await browser.close().catch(() => {})
  server.kill()
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url)
  writeFileSync(file, JSON.stringify(runs, null, 2))
  console.log(`\nwrote ${file.pathname}`)
}
