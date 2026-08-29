/**
 * In-page measurement helpers, installed at document_start by stress.mjs.
 *
 * Everything timed precisely runs *inside* the page: a Playwright round-trip
 * costs 1–5 ms, which is the whole budget of the interactions we care about.
 * Node only ever asks for a number that was already measured here.
 */
export const PROBE = String.raw`
window.__perf = (() => {
  const longTasks = []
  let longTaskObserver = null
  try {
    // Held, not fire-and-forget: same hazard as the MutationObserver below —
    // an observer nothing references can be collected, and then the long-task
    // record silently stops growing partway through a run.
    longTaskObserver = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration })
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch { /* no longtask support */ }

  // First agenda row painted — the cold-start number. Recorded by observer so
  // it is the real DOM moment, not "when Playwright got round to asking".
  let firstRowAt = null
  const mo = new MutationObserver(() => {
    if (firstRowAt === null && document.querySelector('[data-index]')) {
      firstRowAt = performance.now()
      mo.disconnect()
    }
  })
  const arm = () => mo.observe(document.body, { childList: true, subtree: true })
  if (document.body) arm(); else document.addEventListener('DOMContentLoaded', arm)

  const raf = () => new Promise(r => requestAnimationFrame(() => r()))

  /** Resolve once pred() is true, checked once per frame. */
  async function waitFor(pred, timeout) {
    const deadline = performance.now() + (timeout || 120000)
    while (!pred()) {
      if (performance.now() > deadline) throw new Error('waitFor timed out')
      await raf()
    }
  }

  /** Long tasks overlapping [t0, t1]. */
  function tasksIn(t0, t1) {
    const hit = longTasks.filter(t => t.start + t.dur > t0 && t.start < t1)
    return {
      count: hit.length,
      total: Math.round(hit.reduce((a, t) => a + t.dur, 0)),
      max: hit.length ? Math.round(Math.max.apply(null, hit.map(t => t.dur))) : 0,
    }
  }

  /**
   * Time an interaction from the event to the frame in which its effect is on
   * screen: run act, wait for pred, then let one more frame commit.
   */
  async function interaction(act, pred) {
    const t0 = performance.now()
    await act()
    await waitFor(pred)
    await raf()
    const t1 = performance.now()
    return { ms: +(t1 - t0).toFixed(1), long: tasksIn(t0, t1) }
  }

  /** Frame intervals while act runs — the jank measure for scrolling. */
  async function frames(act) {
    const times = []
    let stop = false
    const tick = t => { times.push(t); if (!stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    await act()
    stop = true
    await raf()
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
    const at = q => gaps.length ? +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))].toFixed(1) : 0
    return { frames: gaps.length, p50: at(0.5), p95: at(0.95),
             worst: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : 0,
             janky: gaps.filter(g => g > 50).length }
  }

  /**
   * Median of n timed runs of fn, plus the first (cold) run.
   *
   * Deliberately returns no value from fn: these stages return whole expanded
   * vaults, and handing one back to Playwright serialises megabytes per size.
   * Callers record counts into their own result object instead.
   */
  async function bench(fn, n) {
    const ms = []
    for (let i = 0; i < (n || 1); i++) {
      const t0 = performance.now()
      await fn()
      ms.push(+(performance.now() - t0).toFixed(1))
    }
    const sorted = ms.slice().sort((a, b) => a - b)
    return { cold: ms[0], median: sorted[Math.floor(sorted.length / 2)] }
  }

  // mo is returned so the probe holds a strong reference to it: an observer
  // nothing points at is collectable, and under GC pressure that shows up as
  // a mark that silently never lands.
  return { longTasks, firstRow: () => firstRowAt, waitFor, tasksIn, interaction, frames, bench, raf, mo, longTaskObserver }
})()
`
