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

  // Long Animation Frames, collected for the whole page lifetime (not just
  // around one flow) so 'settle' below and any flow's own attribution read
  // from the same record — a second observer registered mid-run would replay
  // the same buffered history via { buffered: true } and double-count it.
  const loafs = []
  let loafObserver = null
  try {
    loafObserver = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        loafs.push({
          start: e.startTime,
          dur: e.duration,
          blockingDuration: e.blockingDuration,
          styleAndLayoutStart: e.styleAndLayoutStart,
          scripts: [...e.scripts].map(s => ({
            invoker: s.invoker,
            sourceFunctionName: s.sourceFunctionName,
            sourceURL: s.sourceURL,
            sourceCharPosition: s.sourceCharPosition,
            duration: s.duration,
          })),
        })
      }
    })
    loafObserver.observe({ type: 'long-animation-frame', buffered: true })
  } catch { /* no LoAF support */ }

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

  /** LoAF entries whose span overlaps [t0, t1). */
  function loafsIn(t0, t1) {
    return loafs.filter(e => e.start + e.dur > t0 && e.start < t1)
  }

  /**
   * Wait until no Long Animation Frame has ended in the last quietMs, or
   * timeoutMs total elapses — whichever comes first. LoAF, not longtask, is
   * the signal: it's what actually captured the cold-start confounds (idle
   * warm-up, Dexie's cache write) a scroll-flow profile ran into (finding 4,
   * plans/vault-scaling-results.md) as attributed entries, including bursts
   * of individually-short callbacks that never cross the longtask
   * threshold. Meant to run right before a flow that wants to measure
   * steady-state cost rather than whatever cold-start work is still
   * mid-flight.
   */
  async function settle(quietMs, timeoutMs) {
    const q = quietMs ?? 500
    const start = performance.now()
    const deadline = start + (timeoutMs ?? 30000)
    for (;;) {
      const now = performance.now()
      const lastEnd = loafs.length ? loafs[loafs.length - 1].start + loafs[loafs.length - 1].dur : start
      if (now - lastEnd >= q) return { waitedMs: Math.round(now - start), timedOut: false }
      if (now > deadline) return { waitedMs: Math.round(now - start), timedOut: true }
      await raf()
    }
  }

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

  // mo/loafObserver/longTaskObserver are returned so the probe holds a strong
  // reference to each: an observer nothing points at is collectable, and
  // under GC pressure that shows up as a mark that silently never lands.
  return {
    longTasks, loafs, loafsIn, settle,
    firstRow: () => firstRowAt, waitFor, tasksIn, interaction, frames, bench, raf,
    mo, longTaskObserver, loafObserver,
  }
})()
`
