import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { initApp, restoreVaults } from '../vault'

export const Route = createRootRoute({
  component: Root,
})

function Root() {
  const errorNotification = useStore(s => s.errorNotification)
  const setErrorNotification = useStore(s => s.setErrorNotification)

  useEffect(() => {
    initApp()
    restoreVaults()
  }, [])

  return (
    <>
      <div id="app">
        <Outlet />
      </div>
      {errorNotification && (
        <div className="error-banner" role="alert">
          <span className="error-banner-msg">{errorNotification}</span>
          <button className="error-banner-close" onClick={() => setErrorNotification(null)}>
            <X size={13} />
          </button>
        </div>
      )}
    </>
  )
}
