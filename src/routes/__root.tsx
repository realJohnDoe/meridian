import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ThemeProvider } from 'next-themes'
import { restoreVaults, autoSyncTick, resetSyncBackoff } from '@/storage'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: Root,
})

function Root() {
  useEffect(() => {
    restoreVaults()
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
      themes={['meridian', 'one-dark']}
      defaultTheme="meridian"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="meridian_theme"
    >
      <div id="app" className="flex flex-col">
        <Outlet />
      </div>
      <Toaster />
    </ThemeProvider>
  )
}
