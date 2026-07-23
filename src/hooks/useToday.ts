import { useState, useEffect } from 'react'
import { startOfToday } from 'date-fns'

/**
 * Returns midnight of the current calendar day. Re-renders consumers at the
 * next midnight so PWAs that stay open past midnight always reflect the
 * correct date without requiring a reload.
 */
export function useToday(): Date {
  const [today, setToday] = useState(startOfToday)

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>

    // Keeps the previous Date reference when the calendar day hasn't actually
    // changed. startOfToday() always allocates a fresh Date, and React's
    // bail-out is Object.is, so without this every call below would commit a
    // new reference and cascade a full re-derivation through every consumer
    // that depends on `today` (e.g. AgendaView's day grouping/sorting).
    function setTodayIfChanged() {
      setToday(prev => {
        const next = startOfToday()
        return prev.getTime() === next.getTime() ? prev : next
      })
    }

    function scheduleNext() {
      const now  = new Date()
      const next = startOfToday()
      next.setDate(next.getDate() + 1)
      id = setTimeout(() => {
        setTodayIfChanged()
        scheduleNext()
      }, next.getTime() - now.getTime())
    }

    scheduleNext()

    // Mobile PWAs get suspended (timers frozen) rather than killed when
    // backgrounded for days, so the scheduled midnight timeout above can be
    // missed entirely. Recompute eagerly whenever the tab regains visibility
    // so `today` never stays stuck on a stale date after a long suspend.
    function onVisible() {
      if (document.visibilityState === 'visible') setTodayIfChanged()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return today
}
