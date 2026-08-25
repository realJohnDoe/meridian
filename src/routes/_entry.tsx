import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_entry')({
  component: EntryLayout,
})

function EntryLayout() {
  return (
    <div className="mx-auto w-full bg-background">
      <Outlet />
    </div>
  )
}
