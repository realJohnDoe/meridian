/**
 * Meridian's Cloudflare Worker (`worker/`).
 *
 * Hoisted out of `githubOAuth.ts` once the calendar proxy became a second
 * caller: `/oauth/token` exchanges GitHub codes, `/ical` fetches subscription
 * feeds the browser cannot reach directly (calendar providers serve them
 * without CORS headers). One constant so the two can never drift apart.
 */
export const WORKER_ORIGIN = 'https://meridian-oauth.realjohndoe.workers.dev'
