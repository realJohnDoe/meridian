import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useShellMode } from '@/hooks'

export const Route = createFileRoute('/_entry')({
  component: EntryLayout,
})

function EntryLayout() {
  // The entry routes are the only ones with a text input inside a scrolling
  // pane, and the only ones with no virtualizer — so they get the flow shell,
  // where the browser scrolls a focused input above the keyboard itself. See
  // hooks/use-shell-mode.ts.
  useShellMode('flow')
  return (
    <div className="mx-auto w-full bg-background">
      <Outlet />
    </div>
  )
}
