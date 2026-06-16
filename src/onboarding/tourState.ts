const KEY = 'meridian.tourDone'

export function isTourDone(): boolean {
  try { return !!localStorage.getItem(KEY) } catch { return true }
}

export function markTourDone(): void {
  try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
}
