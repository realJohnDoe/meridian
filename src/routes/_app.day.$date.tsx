import { createFileRoute, useNavigate } from '@tanstack/react-router'
import DayView from '../components/DayView'
import { fmtISO } from '../model/expansion'
import type { Occurrence } from '../types'

export const Route = createFileRoute('/_app/day/$date')({
  component: DayPage,
})

function DayPage() {
  const navigate = useNavigate()
  const { date } = Route.useParams()
  const dvDate = new Date(date + 'T00:00:00')

  return (
    <DayView
      date={dvDate}
      onOpen={(occ: Occurrence, scope?: string) =>
        navigate({ to: '/entry/$fileSlug', params: { fileSlug: occ.fileSlug }, search: { date: occ.date ?? undefined, scope: scope ?? 'single' } })
      }
      onNavigateDate={d => navigate({ to: '/day/$date', params: { date: fmtISO(d) } })}
    />
  )
}
