import { teardown } from './teardown'

// The `legacy` Worker: its CORS admits the old origin, the new one's does not.
const LEGACY_WORKER_ORIGIN = 'https://meridian-oauth.realjohndoe.workers.dev'

const status = document.getElementById('status')
const say = (text: string) => { if (status) status.textContent = text }

teardown({
  indexedDB,
  fetch: (...args) => fetch(...args),
  workerOrigin: LEGACY_WORKER_ORIGIN,
  scope: `${location.origin}${import.meta.env.BASE_URL}`,
  serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  localStorage,
}).then(
  result => say(result === 'done'
    ? 'This copy has signed out of GitHub and removed its data from this browser.'
    : 'Could not reach GitHub to sign this copy out. Open this page again when you are online to finish.'),
  (e: unknown) => {
    console.error('[teardown]', e)
    say('Could not remove this copy’s data. Open this page again to retry.')
  },
)
