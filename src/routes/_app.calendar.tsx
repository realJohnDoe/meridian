import { createFileRoute, useNavigate } from '@tanstack/react-router'
import MonthView from '../components/MonthView'
import { fmtISO } from '../model/expansion'

export const Route = createFileRoute('/_app/calendar')({
  component: CalendarPage,
})

function CalendarPage() {
  const navigate = useNavigate()
  return (
    <MonthView
      onDayClick={date => navigate({ to: '/day/$date', params: { date: fmtISO(date) } })}
    />
  )
}
