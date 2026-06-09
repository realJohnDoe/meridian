import { useCallback, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import DayView from '../components/DayView'
import { fmtISO } from '../model/expansion'
import { entryRoute } from './-entryRoute'

export const Route = createFileRoute('/_app/day/$date')({
  component: DayPage,
})

function DayPage() {
  const navigate = useNavigate()
  const { date } = Route.useParams()

  const dvDate = useMemo(() => new Date(date + 'T00:00:00'), [date])

  const onOpen = useCallback(
    (occ: Parameters<typeof entryRoute>[0], scope?: string) => navigate(entryRoute(occ, scope)),
    [navigate],
  )
  const onNavigateDate = useCallback(
    (d: Date) => navigate({ to: '/day/$date', params: { date: fmtISO(d) } }),
    [navigate],
  )

  return (
    <DayView
      date={dvDate}
      onOpen={onOpen}
      onNavigateDate={onNavigateDate}
    />
  )
}
