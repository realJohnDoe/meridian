import { createFileRoute, useNavigate } from '@tanstack/react-router'
import MonthView from '../components/MonthView'
import { fmtISO } from '../model/expansion'

export const Route = createFileRoute('/_app/calendar/$month')({
  component: CalendarPage,
})

function fmtMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseMonth(s: string) {
  const [y, m] = s.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

function CalendarPage() {
  const { month: monthStr } = Route.useParams()
  const navigate = useNavigate()
  const month = parseMonth(monthStr)

  return (
    <MonthView
      month={month}
      onNavigateMonth={d => navigate({ to: '/calendar/$month', params: { month: fmtMonth(d) } })}
      onDayClick={d => navigate({ to: '/day/$date', params: { date: fmtISO(d) } })}
    />
  )
}
