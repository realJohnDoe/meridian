import { useEffect, useState } from 'react'

/**
 * Ticking wall-clock value, refreshed every `intervalMs` while `enabled`.
 * `enabled` lets a caller freeze the clock at mount instead of tearing the
 * hook down conditionally (e.g. DayPane only wants a live clock for the pane
 * showing today; other panes keep whatever `now` they mounted with).
 */
export function useNow(intervalMs: number, enabled: boolean = true): Date {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])

  return now
}
