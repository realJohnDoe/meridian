/**
 * What the old origin's last service worker does on activation. The installed
 * PWA serves the old app from Workbox's precache until its service worker is
 * replaced, so `sw.js` stays served, and this one removes itself: it deletes
 * the caches keyed to its scope (Workbox names them `…-${scope}`; the Cache
 * Storage is shared with the other sites on the origin), unregisters, and
 * reloads its open windows, which then load the teardown page from the network.
 */
export interface RetiringWorker {
  registration: Pick<ServiceWorkerRegistration, 'scope' | 'unregister'>
  caches: Pick<CacheStorage, 'keys' | 'delete'>
  clients: { matchAll(options: { type: 'window' }): Promise<readonly { url: string; navigate(url: string): Promise<unknown> }[]> }
}

export async function retireWorker(sw: RetiringWorker): Promise<void> {
  const { scope } = sw.registration
  const names = await sw.caches.keys()
  await Promise.all(names.filter(n => n.includes(scope)).map(n => sw.caches.delete(n)))
  await sw.registration.unregister()
  const windows = await sw.clients.matchAll({ type: 'window' })
  await Promise.all(windows.map(w => w.navigate(w.url)))
}
