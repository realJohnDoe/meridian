import { useCallback, useEffect, useLayoutEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import AgendaView from '../components/AgendaView'
import { fmtISO } from '../model/expansion'
import { entryRoute } from './-entryRoute'
import type { EditScope } from '../types'
import { TODAY } from '../constants'
import { useStore } from '../store'

export const Route = createFileRoute('/_app/')({
  component: AgendaPage,
})

// Survives remounts; window scroll so we use scrollY not a container's scrollTop
let savedScrollTop = 0

function AgendaPage() {
  const navigate = useNavigate()
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)

  // Toggle window-scroll layout and restore position — all before first paint
  useLayoutEffect(() => {
    document.documentElement.classList.add('agenda-scroll')
    if (!scrollToTodayOnce) window.scrollTo(0, savedScrollTop)
    return () => {
      savedScrollTop = window.scrollY
      document.documentElement.classList.remove('agenda-scroll')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to today when flagged (vault load or Today button)
  useEffect(() => {
    if (!scrollToTodayOnce) return
    useStore.setState({ scrollToTodayOnce: false })
    const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollToTodayOnce])

  const onOpen = useCallback(
    (occ: Parameters<typeof entryRoute>[0], scope?: EditScope) => navigate(entryRoute(occ, scope)),
    [navigate],
  )

  return (
    <div className="ag-sc" id="agSc">
      <AgendaView onOpen={onOpen} />
    </div>
  )
}
