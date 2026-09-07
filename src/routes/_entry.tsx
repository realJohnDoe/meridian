import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SidebarProvider } from '@/components/ui/sidebar'
import AppSidebar from './-appSidebar'

export const Route = createFileRoute('/_entry')({
  component: EntryLayout,
})

/**
 * `SidebarProvider` renders the same nav rail the calendar views dock beside
 * — off-canvas below `lg` (1024px, see `SIDEBAR_MOBILE_QUERY` in
 * components/ui/sidebar.tsx), fixed open beside the content at/above it. It
 * imposes no height of its own (`flex min-h-svh w-full`, no `overflow`), so
 * it doesn't fight this shell's document-flow invariant the way `_app`'s
 * `max-h-svh` clip would — the sidebar is viewport-`fixed` internally, and
 * the document underneath is still free to grow past the viewport for
 * keyboard avoidance (see CLAUDE.md's "Route shells").
 *
 * Deliberately no mobile hamburger trigger here (contrast `_app.tsx`'s
 * `PagedTopbar`): below `lg` the editor is reached exactly as before, with
 * the topbar's own back button (see -entryTopbar.tsx) as the only way out.
 */
function EntryLayout() {
  return (
    <SidebarProvider style={{ '--sidebar-width': '260px' } as React.CSSProperties}>
      <AppSidebar />
      {/* `data-flow-screen` marks the content root of a document-flow route, for
          scripts/layout-smoke.mjs to anchor its growth probe to. It has to be the
          route's own content and not document.body: the one-screen cap lives on
          `_app`'s wrapper, well below body, so a probe on body grows the document
          whatever shell the route uses. `flex-1 min-w-0` makes it the row's other
          flex item, filling whatever width the docked sidebar (`lg`+) doesn't
          claim — see the sidebar's own "sidebar-gap" placeholder in
          components/ui/sidebar.tsx. */}
      <div data-flow-screen className="mx-auto w-full min-w-0 flex-1 bg-background">
        <Outlet />
      </div>
    </SidebarProvider>
  )
}
