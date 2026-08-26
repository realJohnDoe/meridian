import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
})

/**
 * The scroll container and measure for every settings screen.
 *
 * One centred column rather than a nav pane beside the content: the app shell
 * already carries a 260px sidebar on desktop, and a second navigation column
 * next to it would be two lists competing to be the place you navigate from.
 * List-into-detail through the URL gives the same reach with one column, and
 * with no split between how the screens behave on a phone and on a desktop.
 */
function SettingsLayout() {
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <Outlet />
      </div>
    </div>
  )
}
