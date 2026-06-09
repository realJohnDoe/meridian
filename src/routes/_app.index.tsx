import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import AgendaView from '../components/AgendaView'
import type { Occurrence } from '../types'
import { fmtISO } from '../model/expansion'
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

  return (
    <div className="ag-sc" id="agSc">
      <AgendaView
        onOpen={(occ: Occurrence, scope?: string) =>
          navigate({ to: '/entry/$fileSlug', params: { fileSlug: occ.fileSlug }, search: { date: occ.date ?? undefined, scope: scope ?? 'single' } })
        }
      />
    </div>
  )
}
