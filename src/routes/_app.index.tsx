import { useEffect, useLayoutEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import AgendaView from '@/calendar/AgendaView'
import { fmtISO } from '../model/dateUtils'
import { useOpenEntry } from '../hooks/useOpenEntry'
import { useToday } from '../hooks/useToday'
import { useStore } from '../store'
import { on } from '../events'
import { Skeleton } from '../components/ui/skeleton'

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
    if (sec.getBoundingClientRect().top <= containerTop + 12) {
      best = sec.getAttribute('data-key')
    } else {
      break
    }
  }
  return best
}

function AgendaSkeleton() {
  return (
    <div className="flex flex-col gap-0 px-4 pt-3 pb-8">
      {[0, 1, 2].map(i => (
        <div key={i} className="mb-5">
          <Skeleton className="h-4 w-28 mb-3" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            {i === 0 && <Skeleton className="h-10 w-full rounded-xl" />}
          </div>
        </div>
      ))}
    </div>
  )
}

function AgendaPage() {
  const today = useToday()
  const vaultLoading = useStore(s => s.vaultLoading)
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
  // seeded, so we wait for real data (itemCount > 0) and for the vault to finish loading
  // before positioning — otherwise the AgendaView hasn't rendered yet (skeleton is shown)
  // and the .day-section query finds nothing, leaving the flag stuck. vaultLoading is in
  // the deps so the effect re-runs when the skeleton gives way to the real view.
  useEffect(() => {
    if (!scrollToTodayOnce || itemCount === 0 || vaultLoading) return
    const sec =
      document.querySelector('.day-section[data-overdue]') ??
      document.querySelector(`.day-section[data-key="${fmtISO(today)}"]`)
    if (!sec) return
    useStore.setState({ scrollToTodayOnce: false })
    sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    useStore.setState({ agendaTopDate: fmtISO(today) })
  }, [scrollToTodayOnce, itemCount, today, vaultLoading])

  const onOpen = useOpenEntry()

  if (vaultLoading) {
    return (
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <AgendaSkeleton />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" id="agSc" ref={scRef}>
      <AgendaView onOpen={onOpen} />
    </div>
  )
}
