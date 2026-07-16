import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ThemeProvider, useTheme } from 'next-themes'
import { restoreVaults, autoSyncTick, resetSyncBackoff } from '@/storage'
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
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', getComputedStyle(document.documentElement).backgroundColor)
  }, [theme])
  return null
}

function Root() {
  useEffect(() => {
    void restoreVaults()
    const intervalId = setInterval(autoSyncTick, 60_000)
    const onOnline = () => { resetSyncBackoff(); autoSyncTick() }
    const onVisible = () => { if (document.visibilityState === 'visible') autoSyncTick() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      themes={['meridian', 'tokyo-night', 'catppuccin-latte', 'rose-pine-dawn', 'solarized-light', 'dracula']}
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
