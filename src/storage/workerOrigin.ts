/**
 * Meridian's Cloudflare Worker (`worker/`).
 *
 * Hoisted out of `githubOAuth.ts` once the calendar proxy became a second
 * caller: `/oauth/token` exchanges GitHub codes, `/ical` fetches subscription
 * feeds the browser cannot reach directly (calendar providers serve them
 * without CORS headers). One constant so the two can never drift apart.
 *
 * Empty by default: the `meridian` Worker serves the app too, so its endpoints
 * are same-origin. The GitHub Pages build points it at the `legacy` Worker.
 */
export const WORKER_ORIGIN: string = import.meta.env.VITE_WORKER_ORIGIN ?? ''
