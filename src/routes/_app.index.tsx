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

function AgendaPage() {
  const navigate = useNavigate()
  const scrollToTodayOnce = useStore(s => s.scrollToTodayOnce)

  // Enable window-scroll layout before first paint; restore on unmount
  useLayoutEffect(() => {
    document.documentElement.classList.add('agenda-scroll')
    return () => document.documentElement.classList.remove('agenda-scroll')
  }, [])

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
