import { useCallback, useEffect, useRef } from 'react'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { CalendarCheck2 } from 'lucide-react'
import { useMediaQuery } from '@/hooks'
import { cn } from '@/lib/cn'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { useQuickNavOpen, toggleQuickNav, closeQuickNav, useQuickNavSwipe } from '@/calendar'
import { CoachTour } from '@/onboarding'
import { SyncButton, ViewFilterButton } from '@/components'
import { IconButton } from '@/components/primitives/icon-button'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import AppSidebar from './-appSidebar'
import SearchBar from './-searchBar'
import { TopbarShell } from './-topbarShell'
import { PagedTopbar } from './-pagedTopbar'
import { useViewChrome } from './-useViewChrome'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
  validateSearch: (search: Record<string, unknown>): { sq?: string } => ({
    sq: typeof search.sq === 'string' ? search.sq : undefined,
  }),
})

function AppLayout() {
  return (
    // `_app` is the one shell that stays exactly one screen tall and clips
    // itself, so every scroller below it (the agenda's virtualizer above all)
    // scrolls its own element instead of the document — see index.css, where
    // html/body/#root/#app deliberately only carry `min-height`.
    //
    // The cap lives on this app-owned element rather than on SidebarProvider,
    // which is a shadcn registry mirror (see CLAUDE.md — only files the shadcn
    // CLI wrote belong in components/ui). Overriding a vendored component's
    // base classes made the app's most load-bearing layout invariant depend on
    // upstream's own `flex min-h-svh w-full` and on which Tailwind utilities
    // tailwind-merge treats as colliding: `min-h-svh`/`min-h-0` collide and
    // merge, `h-svh`/`flex-1` do not — which is exactly how the shell silently
    // lost its cap once before. A `shadcn diff` can now change that component
    // without reaching this.
    //
    // `max-h-svh` is the cap that cannot be argued with. This is a flex item
    // of `#app` (`display:flex; flex-direction:column`), so its *height* is
    // the main size — and a flex item's main size comes from `flex-basis`,
    // not from `height`. `flex-1` sets `flex-basis: 0%`, a percentage resolved
    // against the container's inner main size, and #app's height is `auto`
    // with only a `min-height`, i.e. indefinite; a percentage basis that can't
    // resolve degrades to `content`, and the shell then sizes to the agenda's
    // full virtualized spacer with `h-svh` never applying. A max-height is
    // immune to that: it clamps the used main size *after* flex resolution,
    // whatever the basis did and however indefinite the ancestor is.
    <div data-app-shell className="flex w-full h-svh max-h-svh overflow-hidden">
      {/* min-h-0 only neutralizes upstream's `min-h-svh`, so this element
          stretches to the shell rather than insisting on a screen of its own.
          Nothing here caps anything — that is the shell's job, above. */}
      <SidebarProvider
        className="h-full min-h-0"
        style={{ '--sidebar-width': '260px' } as React.CSSProperties}
      >
        <AppSidebar />
        <AppMain />
      </SidebarProvider>
    </div>
  )
}

/**
 * The app shell's chrome: the topbar row, the quick-nav panel beneath it, and
 * the outlet the five views render into.
 *
 * Everything view-*specific* about that chrome — the label, the paging, what
 * Today does, what the panel contains, and whether the view has a panel at
 * all — arrives as one `ViewChrome` descriptor from `useViewChrome()`, built
 * by whichever of the five per-view adapters matched (see -viewChrome.ts for
 * the contract and -useViewChrome.ts for the composition root). Nothing below
 * asks which view is mounted; it reads that descriptor's fields, and the
 * nullable ones answer the only question this component actually has — what
 * does this view *have*. Keep it that way: a `useMatch` or an `isDayView`
 * appearing here is the finding this decomposition closed (health-ui #1)
 * growing back.
 *
 * What remains here is genuinely view-agnostic: layout, and the panel's own
 * presentation mechanics (its mobile-inline vs desktop-popover split, focus
 * and Escape handling, `inert`, the swipe gesture).
 */
function AppMain() {
  const { isMobile, setOpenMobile } = useSidebar()
  const setSidebarOpen = useCallback((open: boolean) => {
    if (isMobile) setOpenMobile(open)
  }, [isMobile, setOpenMobile])

  const navigate = useNavigate()

  const chrome = useViewChrome()
  // Whether this view has a quick-nav panel at all — the single gate on the
  // swipe gesture, the label's disclosure button, the mobile inline card and
  // the desktop popover below. Backlog/Notes are the views without one.
  const hasQuickNav = chrome.quickNav !== null

  const quickNavOpen = useQuickNavOpen()
  // Same breakpoint ResponsiveModal uses for its dialog/drawer split (md,
  // 768px) — deliberately not useSidebar's own `isMobile` (lg, 1024px),
  // which answers a different question (does the sidebar collapse behind a
  // hamburger). Below it the quick-nav panel stays the inline slide-down
  // card it's always been; at or above it, the panel opens as a Popover
  // anchored to the toggle button instead (see the two render sites below).
  const isDesktopQuickNav = useMediaQuery('(min-width: 768px)')

  // Vertical swipe on the topbar chrome as an alternate gesture for the quick-nav
  // panel's own disclosure button — see useQuickNavSwipe. Disabled on Backlog/Notes,
  // which render no panel to toggle.
  const quickNavSwipeRef = useQuickNavSwipe<HTMLDivElement>(hasQuickNav)

  // Closes the quick-nav panel on a view switch — paging within the same view
  // (chevron taps, swipes) must leave it open, which is why this keys off the
  // view kind rather than the route params those carry.
  useEffect(() => { closeQuickNav() }, [chrome.kind])

  // The one disclosure button currently rendered — PagedTopbar's, for
  // whichever view has a panel — so Escape can return focus to it on close.
  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  // tabIndex={-1} on the panel itself makes it a valid focus target despite
  // holding no text content of its own; see the effect below.
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus moves into the panel the moment it opens (and is no longer
  // `inert`), so a keyboard/screen-reader user lands directly on its
  // content instead of it opening silently behind the still-focused label
  // button.
  // Escape closes the panel and returns focus to whichever button opened it.
  // A document-level listener rather than a JSX onKeyDown on the (necessarily
  // non-interactive) panel div — jsx-a11y flags keyboard handlers on a
  // non-interactive role, and the panel itself isn't a control.
  //
  // Desktop's panel is a Radix Popover instead, which owns autofocus-into-
  // Content-on-open and Escape-to-dismiss on its own — this manual version is
  // only for the mobile inline panel below, which isn't Radix-managed (its
  // close-focus-restore is handled separately too, see PopoverContent's own
  // onCloseAutoFocus below). Running this same effect on desktop actively
  // fights Radix's own FocusScope: our manual focus() moves focus outside the
  // still-mounted, still-trapping Content, which the trap then yanks back, so
  // by the time Content actually unmounts (after its close transition)
  // neither attempt has stuck and focus falls through to the document body.
  useEffect(() => {
    if (isDesktopQuickNav) return
    if (quickNavOpen) panelRef.current?.focus()
    if (!quickNavOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeQuickNav()
      toggleButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [quickNavOpen, isDesktopQuickNav])

  const navigateHome   = useCallback(() => void navigate({ to: '/' }), [navigate])
  const openSidebar    = () => setSidebarOpen(true)

  return (
    <>
      <div className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* One chrome block: the fixed-height topbar row plus the quick-nav
            panel beneath it, sharing a single background/border/shadow so the
            panel reads as the topbar sliding open, not a separate surface
            stacked under it. Because the border and shadow live here rather
            than on the header itself, they paint at the bottom of whichever
            is currently visible — the header alone while the panel is closed
            or absent, both together once it opens — with no divider between
            the two. */}
        <div ref={quickNavSwipeRef} className="shrink-0 z-10 bg-background border-b border-border shadow-md">
          {/* Wraps the header (holding the PagedTopbar — and, via its
              popoverAnchor prop, the disclosure button that anchors this)
              together with the desktop PopoverContent below, so both sit
              inside the same Popover context. `open` only ever goes true from
              our own toggle button's onClick (PopoverAnchor carries no click
              handling of its own — see PagedTopbar); onOpenChange only ever
              runs the other direction, from Radix's own outside-click/Escape
              handling closing it — so the two can never race each other. */}
          <Popover open={quickNavOpen && isDesktopQuickNav} onOpenChange={o => { if (!o) closeQuickNav() }}>
            <header
              id="mainTop"
              className="h-topbar pt-[env(safe-area-inset-top)] flex items-center"
              data-topbar
            >
              <TopbarShell
                leftHasButton={isMobile}
                left={
                  <PagedTopbar
                    isMobile={isMobile}
                    openSidebar={openSidebar}
                    label={chrome.label}
                    // Undefined rather than omitted for a view without paging
                    // (agenda, backlog, notes) — PagedTopbar treats the two
                    // the same and renders no chevrons either way.
                    paging={chrome.paging ? {
                      prevLabel: `Previous ${chrome.paging.unit}`,
                      nextLabel: `Next ${chrome.paging.unit}`,
                      onPrev: chrome.paging.onPrev,
                      onNext: chrome.paging.onNext,
                    } : undefined}
                    // The label is a disclosure button only for a view that has
                    // a panel to disclose; Backlog/Notes get plain static text.
                    expanded={hasQuickNav ? quickNavOpen : undefined}
                    onToggle={hasQuickNav ? toggleQuickNav : undefined}
                    toggleRef={hasQuickNav ? toggleButtonRef : undefined}
                    popoverAnchor={hasQuickNav}
                  />
                }
                right={
                  <div className="flex items-center gap-0.5 shrink-0">
                    <ViewFilterButton />
                    <SyncButton />
                    {chrome.onToday && (
                      <IconButton variant="ghost" className="text-muted-foreground" onClick={chrome.onToday} title="Today" label="Today"><CalendarCheck2 size={18} /></IconButton>
                    )}
                  </div>
                }
              />
            </header>

            {/* Kept mounted for as long as its view is, panel open or not: the
                grid-rows fr trick below animates a real "auto" height by
                interpolating against the row's own content, so that content has
                to still be there through a close transition, not just an open
                one. Staying mounted also means MonthStrip's centering effect has
                already settled by the time the panel first opens, instead of
                popping in mis-centered. `inert` drops it from focus and a11y
                while collapsed, matching MonthGrid's off-screen carousel panes.

                Below the `isDesktopQuickNav` breakpoint this is the only form
                the panel takes, stretched edge-to-edge. At or above it, the
                PopoverContent below takes over as the actual panel, so this
                stays collapsed instead (`quickNavOpen && !isDesktopQuickNav`)
                — see isDesktopQuickNav's own comment above for why a floating
                popover reads better once the topbar has room to spare instead
                of stretching a full-width card under the label.

                tabIndex={-1} plus the mount-on-open effect above make this the
                focus target when the panel opens; Escape is handled by a
                document-level listener (see that same effect) rather than a
                JSX handler here, since jsx-a11y flags keyboard handlers on a
                non-interactive role. */}
            {chrome.quickNav && (
              <div
                id={isDesktopQuickNav ? undefined : 'quickNavPanel'}
                ref={panelRef}
                tabIndex={-1}
                role="region"
                aria-label="Quick date navigation"
                inert={quickNavOpen && !isDesktopQuickNav ? undefined : true}
                className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-linear motion-reduce:transition-none',
                  quickNavOpen && !isDesktopQuickNav ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                )}
              >
                <div className="overflow-hidden">
                  {chrome.quickNav('strip')}
                </div>
              </div>
            )}
            {/* At/above the desktop breakpoint this — not the div above,
                permanently `inert` there — is the actual panel a keyboard/
                screen-reader user lands in and Escape returns focus from, so
                it (not the inline div) carries the shared "quickNavPanel" id
                the toggle button's aria-controls and the focus-management
                effect above key off. Radix focuses Content itself on open, no
                help needed there — but its own default close-focus-restore
                targets `Popover.Trigger`'s own ref, which this button isn't
                (see `popoverAnchor`'s doc comment on PagedTopbar for why:
                Anchor only, so the button's own onClick keeps sole ownership
                of opening it). With no Trigger, Radix has nothing to restore
                focus to and leaves it wherever the browser defaults to once
                Content unmounts (the document body) — onCloseAutoFocus below
                substitutes the toggle button as that target instead, for
                every dismissal path (Escape, outside click), not just the
                Escape case the mobile inline panel's own effect covers. */}
            {chrome.quickNav && (
              <PopoverContent
                id={isDesktopQuickNav ? 'quickNavPanel' : undefined}
                align="start"
                onCloseAutoFocus={e => {
                  e.preventDefault()
                  toggleButtonRef.current?.focus()
                }}
              >
                {chrome.quickNav('buttons')}
              </PopoverContent>
            )}
          </Popover>
        </div>

        <section className="flex flex-1 flex-col overflow-hidden min-h-0">
          <Outlet />
        </section>

        <SearchBar />
      </div>

      <CoachTour
        setSidebarOpen={setSidebarOpen}
        navigateHome={navigateHome}
      />
    </>
  )
}
