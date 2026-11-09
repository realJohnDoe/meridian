import { lazy, type ComponentType } from 'react'

/**
 * `React.lazy` for a component in a code-split chunk, minus the error flash
 * after a PWA update.
 *
 * Once the new service worker takes over, `cleanupOutdatedCaches` has dropped
 * the old build's chunks, so a page still running the old build fails its next
 * lazy import. `main.tsx`'s `vite:preloadError` listener reloads the page for
 * exactly that, but a plain `lazy()` also rejects, and the route's error
 * boundary paints "Something went wrong" until the reload lands. Never
 * settling instead keeps the Suspense fallback up for those few hundred ms.
 * Relies on that listener: every failed dynamic import goes through Vite's
 * preload helper, which fires it before the rejection reaches us.
 */
export function lazyChunk<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(() => load().then(c => ({ default: c }), () => new Promise<never>(() => {})))
}
