import { useEffect, useRef } from 'react'
import { createFileRoute, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { IconButton } from '@/components/primitives/icon-button'
import { TopbarShell } from './-topbarShell'
import { TopbarLabel } from './-topbarLabel'
import { settingsTopbar } from './-settingsTopbar'

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
})

/**
 * The settings shell — a document-flow chain, deliberately *not* under `_app`.
 *
 * `_app` clips itself to exactly one screen so its virtualized lists own their
 * own scrolling; the cost is that the document can never scroll, so the browser
 * has nothing to lift a focused input above the on-screen keyboard within, and
 * keyboard avoidance has to be rebuilt by hand there. The entry routes were
 * split out for that reason, and these screens meet the same test: they hold
 * real text inputs (a vault's name, a feed's address) and mount no virtualizer,
 * which is what makes the flow shell safe here.
 *
 * Living outside `_app` also settles what belongs on screen. The search bar is
 * `_app` furniture — it searches and creates *entries*, and a settings screen
 * holds none — so rather than being conditioned away, it is simply not part of
 * this chain. Same for the view filter and the Today button.
 *
 * One centred column rather than a nav pane beside the content: list-into-detail
 * through the URL gives the same reach with one column, and with no split
 * between how the screens behave on a phone and on a desktop.
 */
function SettingsLayout() {
  const router   = useRouter()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const vaults   = useStore(s => s.vaults)

  const topbar = settingsTopbar(pathname, id => vaults.find(v => v.id === id)?.name)
  const upTo   = topbar?.backTo ?? null

  // Whether the current sub-screen was reached by navigating forward from the
  // settings list *within this mount* of the layout (list -> detail, pushing
  // a history entry) as opposed to landing on it directly — a deep link
  // (SyncButton points straight at a vault) or a page load/refresh. This ref
  // survives across sub-route changes because the layout itself doesn't
  // remount while staying inside `/settings/*`; it resets whenever the
  // pathname returns to the list.
  const cameFromListRef = useRef(false)
  const prevPathRef      = useRef<string | null>(null)
  useEffect(() => {
    if (pathname === '/settings') cameFromListRef.current = false
    else if (prevPathRef.current === '/settings') cameFromListRef.current = true
    prevPathRef.current = pathname
  }, [pathname])

  // A sub-screen reached straight from the list pops history, same as the
  // browser's own back button — that's what keeps the two from diverging.
  // A sub-screen reached without the list in history (a deep link, or a
  // fresh load) goes up to it explicitly instead: these screens are
  // linkable, so "back" there could otherwise leave Settings from a screen
  // that has a visible parent. At the root there is no parent left, so it
  // leaves Settings the same way the entry editor does.
  const onBack = () => {
    if (upTo) {
      if (cameFromListRef.current) router.history.back()
      else void navigate({ to: upTo })
    } else if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/' })
  }

  return (
    <div className="mx-auto w-full bg-background">
      <header
        className="sticky top-0 z-10 h-topbar pt-[env(safe-area-inset-top)] flex items-center border-b border-border shrink-0 bg-background shadow-md"
        data-topbar
      >
        <TopbarShell
          // The back button always leads the left edge: there is no sidebar
          // docked beside these screens, so it is the only way out.
          leftHasButton
          left={
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <IconButton variant="ghost" className="text-dim" onClick={onBack} title="Back" label="Back">
                <ArrowLeft size={18} />
              </IconButton>
              <TopbarLabel
                long={topbar?.title ?? 'Settings'}
                short={topbar?.title ?? 'Settings'}
                className="flex-1 text-base text-foreground"
              />
            </div>
          }
          right={<div className="shrink-0" />}
        />
      </header>

      {/* `data-flow-screen` marks this as a document-flow route's content root
          — what scripts/layout-smoke.mjs waits on and anchors its growth probe
          to, the same as the entry routes. */}
      <div
        data-flow-screen
        className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6"
      >
        <Outlet />
      </div>
    </div>
  )
}
