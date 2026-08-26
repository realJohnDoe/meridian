import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_entry')({
  component: EntryLayout,
})

function EntryLayout() {
  return (
    // `data-flow-screen` marks the content root of a document-flow route, for
    // scripts/layout-smoke.mjs to anchor its growth probe to. It has to be the
    // route's own content and not document.body: the one-screen cap lives on
    // `_app`'s wrapper, well below body, so a probe on body grows the document
    // whatever shell the route uses.
    <div data-flow-screen className="mx-auto w-full bg-background">
      <Outlet />
    </div>
  )
}
