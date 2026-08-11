import { describe, it, expect, vi, afterEach } from 'vitest'
import { onIdle, runInIdleBatches } from './idle'

// Node has no requestIdleCallback, so these exercise the setTimeout fallback
// unless a test installs a stub. Both paths matter: browsers take the idle
// path, the test environment and Safari < 16.4 take the fallback.
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback
  delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback
})

/** Installs a requestIdleCallback stub that hands out `budgetMs` per wake-up. */
function stubIdleCallback(budgetMs: number): { flush: () => void; pending: () => number } {
  const queue: Array<(d: IdleDeadline) => void> = []
  let nextId = 1
  Object.assign(globalThis, {
    requestIdleCallback: (fn: (d: IdleDeadline) => void) => { queue.push(fn); return nextId++ },
    cancelIdleCallback: () => { queue.length = 0 },
  })
  return {
    pending: () => queue.length,
    flush: () => {
      // One wake-up at a time: the pump reschedules itself, and draining the
      // queue in a loop here would hide whether it actually did.
      const fn = queue.shift()
      const started = performance.now()
      fn?.({ didTimeout: false, timeRemaining: () => Math.max(0, budgetMs - (performance.now() - started)) })
    },
  }
}

describe('onIdle', () => {
  it('defers the callback rather than running it inline', async () => {
    const fn = vi.fn()
    onIdle(fn)
    expect(fn).not.toHaveBeenCalled()

    await vi.waitFor(() => { expect(fn).toHaveBeenCalledTimes(1) })
  })

  it('does not run a cancelled callback', async () => {
    const fn = vi.fn()
    onIdle(fn)()
    await new Promise<void>(resolve => { setTimeout(resolve, 5) })
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('runInIdleBatches', () => {
  it('processes every item and then calls onDone', async () => {
    const seen: number[] = []
    const done = vi.fn()
    runInIdleBatches([1, 2, 3, 4, 5], n => seen.push(n), done)

    await vi.waitFor(() => { expect(done).toHaveBeenCalledTimes(1) })
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('calls onDone immediately for an empty list', async () => {
    const done = vi.fn()
    runInIdleBatches([], () => {}, done)
    await vi.waitFor(() => { expect(done).toHaveBeenCalledTimes(1) })
  })

  it('stops where it got to when cancelled mid-sweep', () => {
    const idle = stubIdleCallback(0)
    const seen: number[] = []
    const done = vi.fn()

    const cancel = runInIdleBatches([1, 2, 3, 4], n => seen.push(n), done)
    idle.flush()          // a zero-budget wake-up still makes one item of progress
    expect(seen).toEqual([1])

    cancel()
    idle.flush()
    expect(seen).toEqual([1])
    expect(done).not.toHaveBeenCalled()
  })

  // requestIdleCallback's `timeout` option fires the callback with
  // timeRemaining() === 0. A purely budget-gated loop would reschedule forever
  // without consuming anything, so the sweep must always take at least one item.
  it('makes progress even when the deadline reports no time remaining', () => {
    const idle = stubIdleCallback(0)
    const seen: number[] = []
    const done = vi.fn()

    runInIdleBatches([1, 2, 3], n => seen.push(n), done)
    idle.flush()
    expect(seen).toEqual([1])
    idle.flush()
    expect(seen).toEqual([1, 2])
    idle.flush()
    expect(seen).toEqual([1, 2, 3])
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('drains the whole list in one wake-up when the budget allows', () => {
    const idle = stubIdleCallback(50)
    const seen: number[] = []
    const done = vi.fn()

    runInIdleBatches([1, 2, 3], n => seen.push(n), done)
    idle.flush()

    expect(seen).toEqual([1, 2, 3])
    expect(done).toHaveBeenCalledTimes(1)
    expect(idle.pending()).toBe(0)
  })
})
