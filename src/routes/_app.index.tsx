import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import AgendaView from '@/calendar/AgendaView'
import { fmtISO } from '../model/dateUtils'
import { entryRoute } from './-entryRoute'
import type { EditScope } from '../types'
import { useToday } from '../hooks/useToday'
import { useStore } from '../store'
import { on } from '../events'

export const Route = createFileRoute('/_app/')({
  component: AgendaPage,
})

// Survives remounts so navigating back (e.g. from the entry editor) lands where we left off.
let savedScrollTop = 0

function findTopDate(scEl: HTMLDivElement): string | null {
  const sections = scEl.querySelectorAll<HTMLElement>('.day-section[data-key]')
  const containerTop = scEl.getBoundingClientRect().top
  let best: string | null = null
  for (const sec of sections) {
    if (sec.getBoundingClientRect().top <= containerTop + 4) {
      best = sec.getAttribute('data-key')
    } else {
      break
    }
  }
  return best
}

function AgendaPage() {
  const today = useToday()
  const navigate = useNavigate()
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)
  const itemCount = useStore(s => s.items.length)
  const scRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  // When a vault activates, scroll to today once data arrives.
  useEffect(() => on('vault:changed', () => useStore.setState({ scrollToTodayOnce: true })), [])

  // Restore saved scroll before paint (no blink); save on unmount.
  useLayoutEffect(() => {
    const el = scRef.current
    if (el && !useStore.getState().scrollToTodayOnce) el.scrollTop = savedScrollTop
    return () => { if (el) savedScrollTop = el.scrollTop }
  }, [])

  // Track topmost visible day for the top bar label.
  useEffect(() => {
    const el = scRef.current
    if (!el) return
    const update = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const date = findTopDate(el)
        useStore.setState({ agendaTopDate: date ?? fmtISO(today) })
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => { el.removeEventListener('scroll', update); cancelAnimationFrame(rafRef.current) }
  }, [today])

  // Scroll to today when flagged (vault load or Today button). The today section is always
  // seeded, so we wait for real data (itemCount > 0) before positioning — otherwise we'd
  // scroll against an empty agenda, then today shifts down once items load. Depends on
  // itemCount so it retries as data arrives; only consumes the flag once it actually scrolls.
  useEffect(() => {
    if (!scrollToTodayOnce || itemCount === 0) return
    const sec = document.querySelector(`.day-section[data-key="${fmtISO(today)}"]`)
    if (!sec) return
    useStore.setState({ scrollToTodayOnce: false })
    sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    useStore.setState({ agendaTopDate: fmtISO(today) })
  }, [scrollToTodayOnce, itemCount, today])

  const onOpen = useCallback(
    (occ: Parameters<typeof entryRoute>[0], scope?: EditScope) => navigate(entryRoute(occ, scope)),
    [navigate],
  )

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" id="agSc" ref={scRef}>
      <AgendaView onOpen={onOpen} />
    </div>
  )
}
