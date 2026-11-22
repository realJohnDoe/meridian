/**
 * A bounded, in-memory recorder of the moments the app felt slow.
 *
 * Same reasoning as `storage/syncJournal.ts`: sluggishness shows up on a
 * phone, intermittently, with no devtools attached — so record it always,
 * cheaply, and let the user copy it out of Settings › About afterwards.
 *
 * Two browser-native sources:
 * - **Event Timing** (`event`): each slow interaction, split into input delay
 *   (main thread busy before the handler ran), processing (our handlers) and
 *   presentation (render, layout, paint after the handlers).
 * - **Long Animation Frames** (`long-animation-frame`): each slow frame, with
 *   the scripts that ran in it — the attribution for the above.
 *
 * Plus **React render time** (`recordRender`, the `<Profiler onRender>` callback
 * of a few static-id subtrees), appended to each slow interaction so the line
 * says how much of its handlers + paint was rendering and how much (`other`:
 * commit, effects, layout) was not. Needs the profiling build, aliased in vite.config.ts.
 *
 * Plus **User Timing measures** (`measure`, wrapped around the few synchronous
 * chunks suspected of blocking the main thread). Firefox and Safari have no
 * Long Animation Frames, so these are the only attribution there: each one that
 * overlaps an interaction's input delay is named on that interaction's line, and
 * one long enough to jank on its own gets a line of its own.
 *
 * No content: entries carry the route path, event type and target element
 * tag/role, never text.
 */

/** Below this, a frame or interaction is not recorded. ~100 ms is where a tap starts to feel laggy. */
const THRESHOLD_MS = 100
const CAPACITY = 100

/** One interaction, merged from its entries (pointerdown, pointerup, click …) as web-vitals' INP attribution does. */
interface Interaction {
  id: number; names: string[]; target: string; path: string
  start: number; end: number; processingStart: number; processingEnd: number
}

const _lines: { t: number; text: string; interaction?: Interaction }[] = []

function push(t: number, text: string, interaction?: Interaction): void {
  _lines.push({ t, text, interaction })
  if (_lines.length > CAPACITY) _lines.splice(0, _lines.length - CAPACITY)
}

/** Renders are kept this long: well past the interaction they belong to, which is described right after it. */
const RENDER_KEEP_MS = 10_000
const _renders: { id: string; phase: string; duration: number; commitTime: number }[] = []

/**
 * `<Profiler onRender>` callback (its full signature, so it can be passed as is).
 * Fires during commit, before Event Timing delivers the interaction.
 */
export function recordRender(
  id: string, phase: string, actualDuration: number, _baseDuration: number, _startTime: number, commitTime: number,
): void {
  _renders.push({ id, phase, duration: actualDuration, commitTime })
  while (_renders[0] && _renders[0].commitTime < commitTime - RENDER_KEEP_MS) _renders.shift()
}

const _measures: { name: string; start: number; end: number }[] = []

/** Run `fn` under a User Timing measure named `name`, for the journal to attribute input delay to. */
export function measure<T>(name: string, fn: () => T): T {
  const start = performance.now()
  try { return fn() } finally {
    try { performance.measure(name, { start }) } catch { /* best-effort, like the observers */ }
  }
}

const ms = (n: number) => `${Math.round(n)}ms`

function describeTarget(node: Node | null): string {
  if (!(node instanceof Element)) return '?'
  const role = node.getAttribute('role')
  const slot = node.getAttribute('data-slot')
  return [node.tagName.toLowerCase(), role && `role=${role}`, slot && `slot=${slot}`].filter(Boolean).join(' ')
}

/** Input delay until the first handler ran, handlers until the last one finished, then rendering until the next paint. */
function describeInteraction(i: Interaction): string {
  const renders = _renders.filter(r => r.commitTime >= i.start && r.commitTime <= i.end)
  // Nested Profilers' time is already inside `root`'s, so only `root` is subtracted.
  const rootMs = renders.filter(r => r.id === 'root').reduce((sum, r) => sum + r.duration, 0)
  // Renders happen in the handlers (discrete updates) or after them, never during input delay.
  const other = Math.max(0, i.end - i.processingStart - rootMs)
  const seen = renders.map(r => `${r.id} ${r.phase} ${ms(r.duration)}`).join(', ') || 'no render'
  const blocking = _measures.filter(m => m.start < i.processingStart && m.end > i.start)
    .map(m => `${m.name} ${ms(m.end - m.start)}`).join(', ')
  return `${i.names.join('+')} ${ms(i.end - i.start)} = input ${ms(i.processingStart - i.start)}`
    + ` + handlers ${ms(i.processingEnd - i.processingStart)} + paint ${ms(i.end - i.processingEnd)}`
    + `  on ${i.target} at ${i.path}`
    + `\n               ← ${seen} · other ${ms(other)} (commit/effects/layout)`
    + (blocking ? ` · input delayed by ${blocking}` : '')
}

function onEvent(e: PerformanceEventTiming): void {
  if (!e.interactionId || e.duration < THRESHOLD_MS) return
  const line = _lines.find(l => l.interaction?.id === e.interactionId)
  if (!line) {
    const i: Interaction = {
      id: e.interactionId, names: [e.name], target: describeTarget(e.target), path: location.pathname,
      start: e.startTime, end: e.startTime + e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd,
    }
    push(performance.timeOrigin + e.startTime, describeInteraction(i), i)
    return
  }
  const i = line.interaction!
  if (!i.names.includes(e.name)) i.names.push(e.name)
  i.start = Math.min(i.start, e.startTime)
  i.end = Math.max(i.end, e.startTime + e.duration)
  i.processingStart = Math.min(i.processingStart, e.processingStart)
  i.processingEnd = Math.max(i.processingEnd, e.processingEnd)
  line.text = describeInteraction(i)
}

/** The fields used here of the Long Animation Frames API, which TypeScript's DOM lib doesn't type yet. */
interface LongAnimationFrame extends PerformanceEntry {
  blockingDuration: number
  scripts: { duration: number; invoker: string; sourceFunctionName: string; sourceURL: string }[]
}

function onFrame(e: LongAnimationFrame): void {
  if (e.duration < THRESHOLD_MS) return
  const scripts = [...e.scripts]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3)
    .map(s => `${s.sourceFunctionName || s.invoker || '?'} (${s.sourceURL.split('/').pop()?.split('?')[0] ?? ''}) ${ms(s.duration)}`)
  push(
    performance.timeOrigin + e.startTime,
    `frame        ${ms(e.duration)} blocking ${ms(e.blockingDuration)}${scripts.length ? `  ${scripts.join('; ')}` : ''}`,
  )
}

function onMeasure(e: PerformanceEntry): void {
  const m = { name: e.name, start: e.startTime, end: e.startTime + e.duration }
  _measures.push(m)
  while (_measures[0] && _measures[0].end < m.end - RENDER_KEEP_MS) _measures.shift()
  if (e.duration >= THRESHOLD_MS) push(performance.timeOrigin + e.startTime, `task         ${ms(e.duration)}  ${e.name}`)
}

/** Start recording. Safe to call where neither entry type is supported (Safari, Firefox, jsdom). */
export function startPerfJournal(): void {
  const supported = typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes
  try {
    if (supported.includes('event')) {
      new PerformanceObserver(list => { list.getEntries().forEach(e => { onEvent(e as PerformanceEventTiming) }) })
        .observe({ type: 'event', durationThreshold: THRESHOLD_MS, buffered: true } as PerformanceObserverInit)
    }
    if (supported.includes('long-animation-frame')) {
      new PerformanceObserver(list => { list.getEntries().forEach(e => { onFrame(e as LongAnimationFrame) }) })
        .observe({ type: 'long-animation-frame', buffered: true })
    }
    if (supported.includes('measure')) {
      new PerformanceObserver(list => { list.getEntries().forEach(onMeasure) }).observe({ type: 'measure', buffered: true })
    }
  } catch { /* observing is best-effort; the app must not care */ }
}

export function perfJournalCount(): number {
  return _lines.length
}

/** A pasteable report, newest last, times relative to now. */
export function perfJournalDump(): string {
  const now = Date.now()
  const nav = navigator as Navigator & { deviceMemory?: number }
  const header = `meridian perf journal — ${_lines.length} slow event(s) ≥${THRESHOLD_MS}ms`
    + `\n${navigator.userAgent} · ${navigator.hardwareConcurrency} cores · ${nav.deviceMemory ?? '?'} GB · ${__APP_VERSION__}`
  return [header, ..._lines.map(l => `-${((now - l.t) / 1000).toFixed(1).padStart(7)}s  ${l.text}`)].join('\n')
}

/** Tests only. */
export function clearPerfJournal(): void {
  _lines.length = 0
  _renders.length = 0
  _measures.length = 0
}
