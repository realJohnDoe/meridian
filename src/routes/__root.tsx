import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { restoreVaults } from '@/storage/vaultRegistry'
import { autoSyncTick } from '@/storage/sync'
import { initStorageCallbacks } from '@/storage/storageCallbacks'
import { bridgeCallbacks } from '@/storeBridge'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: Root,
})

function Root() {
  useEffect(() => {
    initStorageCallbacks(bridgeCallbacks)
    restoreVaults()
    const intervalId = setInterval(autoSyncTick, 60_000)
    const onOnline = () => autoSyncTick()
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
    <>
      <div id="app" className="flex flex-col">
        <Outlet />
      </div>
      <Toaster />
    </>
  )
}
