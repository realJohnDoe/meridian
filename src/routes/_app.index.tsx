import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import AgendaView from '../components/AgendaView'
import { fmtISO } from '../model/dateUtils'
import { entryRoute } from './-entryRoute'
import type { EditScope } from '../types'
import { TODAY } from '../constants'
import { useStore } from '../store'

export const Route = createFileRoute('/_app/')({
  component: AgendaPage,
})

// Survives remounts so navigating back (e.g. from the entry editor) lands where we left off.
let savedScrollTop = 0

function AgendaPage() {
  const navigate = useNavigate()
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)
  const itemCount = useStore(s => s.items.length)
  const scRef = useRef<HTMLDivElement>(null)

  // Restore saved scroll before paint (no blink); save on unmount.
  useLayoutEffect(() => {
    const el = scRef.current
    if (el && !useStore.getState().scrollToTodayOnce) el.scrollTop = savedScrollTop
    return () => { if (el) savedScrollTop = el.scrollTop }
  }, [])

  // Scroll to today when flagged (vault load or Today button). The today section is always
  // seeded, so we wait for real data (itemCount > 0) before positioning — otherwise we'd
  // scroll against an empty agenda, then today shifts down once items load. Depends on
  // itemCount so it retries as data arrives; only consumes the flag once it actually scrolls.
  useEffect(() => {
    if (!scrollToTodayOnce || itemCount === 0) return
    const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
    if (!sec) return
    useStore.setState({ scrollToTodayOnce: false })
    sec.scrollIntoView({ behavior: 'instant', block: 'start' })
  }, [scrollToTodayOnce, itemCount])

  const onOpen = useCallback(
    (occ: Parameters<typeof entryRoute>[0], scope?: EditScope) => navigate(entryRoute(occ, scope)),
    [navigate],
  )

  return (
    <div className="ag-sc" id="agSc" ref={scRef}>
      <AgendaView onOpen={onOpen} />
    </div>
  )
}
