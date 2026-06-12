import { useState, useEffect } from 'react'

function todayMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Returns midnight of the current calendar day. Re-renders consumers at the
 * next midnight so PWAs that stay open past midnight always reflect the
 * correct date without requiring a reload.
 */
export function useToday(): Date {
  const [today, setToday] = useState(todayMidnight)

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>

    function scheduleNext() {
      const now  = new Date()
      const next = new Date(now)
      next.setDate(next.getDate() + 1)
      next.setHours(0, 0, 0, 0)
      id = setTimeout(() => {
        setToday(todayMidnight())
        scheduleNext()
      }, next.getTime() - now.getTime())
    }

    scheduleNext()
    return () => clearTimeout(id)
  }, [])

  return today
}
