import { useCallback, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import AgendaView from '../components/AgendaView'
import { fmtISO } from '../model/expansion'
import { entryRoute } from './-entryRoute'
import { TODAY } from '../constants'

export const Route = createFileRoute('/_app/')({
  component: AgendaPage,
})

function AgendaPage() {
  const navigate = useNavigate()

  useEffect(() => {
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    }, 200)
  }, [])

  const onOpen = useCallback(
    (occ: Parameters<typeof entryRoute>[0], scope?: string) => navigate(entryRoute(occ, scope)),
    [navigate],
  )

  return (
    <div className="ag-sc" id="agSc">
      <AgendaView onOpen={onOpen} />
    </div>
  )
}
