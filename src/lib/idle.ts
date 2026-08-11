/**
 * Idle scheduling for work that must not sit on the critical path.
 *
 * Both users are cold-start deferrals: the file→occurrence map (see
 * `fileOccurrence.ts`) and the round-trip guard sweep (see `storage/sync.ts`).
 * Each used to run synchronously inside the vault load, between the Dexie read
 * and the agenda's first paint.
 *
 * `requestIdleCallback` is unavailable in Safari before 16.4 and in the test
 * environment, so both helpers fall back to a macrotask. The only guarantee
 * callers depend on is "not in this frame", which the fallback still gives.
 */

function schedule(fn: (deadline?: IdleDeadline) => void, timeout: number): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout })
    return () => { cancelIdleCallback(id) }
  }
  const id = setTimeout(() => fn(), 0)
  return () => { clearTimeout(id) }
}

/** Time budget per batch when no `IdleDeadline` is available — roughly half a frame. */
const FALLBACK_BUDGET_MS = 8

/**
 * Run `fn` once the browser is idle, or after `timeout` ms at the latest.
 * Returns a cancel function; calling it after `fn` has run is a no-op.
 */
export function onIdle(fn: () => void, timeout = 1_000): () => void {
  return schedule(() => fn(), timeout)
}

/**
 * Apply `step` to every item, spread across idle periods so no single batch
 * blocks a frame, then call `onDone`. Returns a cancel function that stops the
 * sweep wherever it got to (`onDone` is then never called).
 *
 * At least one item is processed per wake-up: `requestIdleCallback`'s `timeout`
 * option fires the callback with `timeRemaining() === 0`, so a purely
 * budget-gated loop would reschedule forever without making progress on a busy
 * main thread.
 */
export function runInIdleBatches<T>(
  items: readonly T[],
  step: (item: T) => void,
  onDone: () => void = () => {},
  timeout = 2_000,
): () => void {
  let i = 0
  let cancelled = false
  let cancelPending = () => {}

  const pump = (deadline?: IdleDeadline): void => {
    if (cancelled) return
    const started = performance.now()
    const hasTime = (): boolean => deadline
      ? deadline.timeRemaining() > 1
      : performance.now() - started < FALLBACK_BUDGET_MS

    if (i < items.length) {
      do { step(items[i++]!) } while (i < items.length && hasTime())  // i < length checked
    }

    if (i < items.length) { cancelPending = schedule(pump, timeout); return }
    onDone()
  }

  cancelPending = schedule(pump, timeout)
  return () => { cancelled = true; cancelPending() }
}
