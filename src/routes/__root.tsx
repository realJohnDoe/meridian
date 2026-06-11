import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { initApp, restoreVaults } from '../vault'
import { Toaster } from '../components/ui/sonner'

export const Route = createRootRoute({
  component: Root,
})

function Root() {
  useEffect(() => {
    initApp()
    restoreVaults()
  }, [])

  return (
    <>
      <div id="app">
        <Outlet />
      </div>
      <Toaster />
    </>
  )
}
