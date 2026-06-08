import { fmtISO } from './model/expansion'
import { getPrimary, setPrimary, setCalMonth, setDvDate } from './storeBridge'
import { TODAY } from './constants'

// ── VIEW NAVIGATION ────────────────────────────────────────────

export function goToday(): void {
  const primary = getPrimary()
  if (primary === 'day') {
    setDvDate(new Date(TODAY))
  } else if (primary === 'calendar') {
    setCalMonth(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1))
  } else {
    setPrimary('agenda')
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }
}

export function openDayViewForDate(date: Date): void {
  setDvDate(date)
  setPrimary('day')
}
