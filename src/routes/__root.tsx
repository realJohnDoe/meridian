import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { startOfToday } from 'date-fns'
import { ThemeProvider, useTheme } from 'next-themes'
import { restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush } from '@/storage'
import { useStore } from '@/store'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: Root,
})

// Android colors the status/nav bar from this meta tag rather than from the
// page's own background, so it must track the active theme's --backdrop
// or it stays on the static dark default from index.html for light themes.
function ThemeColorSync() {
  const { theme } = useTheme()
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
  }, [theme])
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
        // vault-activation's own flushPendingPush() is the guarantee — this
        // just narrows the window in the common case.
        flushPendingPush()
        return
      }
      autoSyncTick()
      const day = startOfToday().getTime()
      if (day !== lastActiveDayRef.current) {
        lastActiveDayRef.current = day
        useStore.setState({ scrollToTodayOnce: true })
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
      themes={['meridian', 'tokyo-night', 'catppuccin-latte', 'catppuccin-mocha', 'rose-pine-dawn', 'solarized-light', 'solarized-dark', 'dracula']}
      defaultTheme="meridian"
      enableSystem={false}
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
