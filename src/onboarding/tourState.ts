const KEY = 'meridian.tourDone'
const REPLAY_EVENT = 'meridian:replay-tour'

export function isTourDone(): boolean {
  try { return !!localStorage.getItem(KEY) } catch { return true }
}

export function markTourDone(): void {
  try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
}

/** Clear the done flag and ask any mounted CoachTour to restart from step 1. */
export function replayTour(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  window.dispatchEvent(new Event(REPLAY_EVENT))
}

/** Subscribe to replay requests; returns an unsubscribe function. */
export function onReplayTour(cb: () => void): () => void {
  window.addEventListener(REPLAY_EVENT, cb)
  return () => window.removeEventListener(REPLAY_EVENT, cb)
}
