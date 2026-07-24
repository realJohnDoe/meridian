import { createRouter, RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import './index.css'
import { routeTree } from './routeTree.gen'
import { AppErrorFallback } from '@/components'

// After a PWA update the old chunk hashes are gone from the cache. Reload so
// the new SW serves the updated bundles instead of crashing on a stale import.
window.addEventListener('vite:preloadError', () => { window.location.reload() })

export const router = createRouter({
  routeTree,
  basepath: '/meridian',
  // Every route match (including root) is wrapped in its own CatchBoundary,
  // so this single fallback catches render-time throws app-wide instead of
  // white-screening the PWA — see AppErrorFallback.
  defaultErrorComponent: AppErrorFallback,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
)
