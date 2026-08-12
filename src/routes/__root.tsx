import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { startOfToday } from 'date-fns'
import { ThemeProvider, useTheme } from 'next-themes'
import { fmtISO } from '@/model'
import { restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush } from '@/storage'
import { requestScrollToToday, setCurrentDate } from '@/calendar'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: Root,
})

/**
 * Maps each theme id to the class applied on <html>.
 *
 * next-themes resolves the `system` theme to the literal names `light` and
 * `dark`, so those two keys are what point `prefers-color-scheme` at our own
 * branded pair rather than at one of the borrowed editor palettes. Every
 * other entry maps an explicit theme id to its own class — including
 * `meridian`, so a `meridian_theme` already in localStorage keeps resolving
 * across this change.
 */
export const THEME_CLASS: Record<string, string> = {
  light:              'meridian-light',
  dark:               'meridian',
  meridian:           'meridian',
  'meridian-light':   'meridian-light',
  'tokyo-night':      'tokyo-night',
  'catppuccin-latte': 'catppuccin-latte',
  'catppuccin-mocha': 'catppuccin-mocha',
  'rose-pine-dawn':   'rose-pine-dawn',
  'solarized-light':  'solarized-light',
  'solarized-dark':   'solarized-dark',
  dracula:            'dracula',
}

/**
 * Selectable theme ids — every THEME_CLASS key except the two
 * `prefers-color-scheme` aliases, which are resolution targets rather than
 * themes a user picks. Derived rather than written out so the list and the
 * class map cannot drift apart.
 */
export const THEME_IDS = Object.keys(THEME_CLASS).filter(id => id !== 'light' && id !== 'dark')

// Android colors the status/nav bar from this meta tag rather than from the
// page's own background, so it must track the active theme's --backdrop
// or it stays on the static dark default from index.html for light themes.
function ThemeColorSync() {
  // `resolvedTheme` is the dependency that matters, not `theme`: on the
  // system setting `theme` stays the constant 'system' while the OS flipping
  // light/dark moves only `resolvedTheme`, and keying off `theme` alone would
  // leave the status bar painted for the previous appearance.
  const { theme, resolvedTheme } = useTheme()
  useEffect(() => {
    // next-themes applies the new theme's class in its own effect on
    // ThemeProvider, which — being our parent — commits *after* this effect
    // (React fires effects child-first). Reading the computed style here
    // would therefore always see the previous theme. Deferring to the next
    // frame lets that effect land first.
    const raf = requestAnimationFrame(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      meta?.setAttribute('content', getComputedStyle(document.documentElement).backgroundColor)
    })
    return () => cancelAnimationFrame(raf)
  }, [theme, resolvedTheme])
  return null
}

function Root() {
  // Tracks the calendar day the app was last known to be on, so a resume
  // after a multi-day background suspend (mobile PWAs freeze timers rather
  // than reload) can tell "today changed while we were away" from an
  // ordinary tab switch and re-scroll the agenda to today accordingly.
  const lastActiveDayRef = useRef(startOfToday().getTime())

  useEffect(() => {
    void restoreVaults()
    const intervalId = setInterval(autoSyncTick, 60_000)
    const onOnline = () => { resetSyncBackoff(); autoSyncTick() }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        // Best-effort: push anything dirty before the tab is backgrounded (or
        // closed) instead of waiting up to 60s for the next autoSyncTick.
        // The next activation's own syncOnActivate() is the guarantee (its
        // pushDirty leg rescues whatever this missed) — this just narrows the
        // window in the common case.
        flushPendingPush()
        return
      }
      autoSyncTick()
      const day = startOfToday().getTime()
      if (day !== lastActiveDayRef.current) {
        lastActiveDayRef.current = day
        requestScrollToToday()
        // Also resets the cross-view "current date" (calendar/viewState.ts),
        // not just Agenda's own scroll target — otherwise resuming on Month
        // or Day after a multi-day suspend would leave the sidebar carrying
        // over whatever stale day was in view when the app was backgrounded.
        setCurrentDate(fmtISO(new Date(day)))
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    // visibilitychange doesn't always fire reliably before a tab/PWA is
    // actually torn down (notably iOS Safari) — pagehide is the more reliable
    // "about to go away" signal, so back it up here too.
    window.addEventListener('pagehide', flushPendingPush)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', flushPendingPush)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      themes={THEME_IDS}
      value={THEME_CLASS}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="meridian_theme"
    >
      <ThemeColorSync />
      <div id="app" className="flex flex-col">
        <Outlet />
      </div>
      <Toaster />
    </ThemeProvider>
  )
}
