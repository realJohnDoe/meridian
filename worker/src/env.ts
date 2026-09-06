/**
 * The Worker's bindings, as the handlers consume them.
 *
 * Hand-written rather than taken from `worker-configuration.d.ts`'s generated
 * global `Env`, for two reasons that both still hold: `wrangler types` only
 * sees what `wrangler.toml` declares, so it knows nothing about
 * `GITHUB_CLIENT_SECRET` (set out of band via `wrangler secret put`); and
 * naming the bindings here is what lets a test hand a handler a plain object
 * instead of standing up the Workers runtime.
 *
 * Its own module rather than living beside one of the handlers: both
 * `oauthToken.ts` and `icalFetch.ts` now need it, and having the calendar
 * proxy import a type from the OAuth handler would be a dependency pointing
 * the wrong way between two siblings that are otherwise unrelated.
 */
export interface Env {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  /**
   * Per-IP request budget for `/ical`, declared as a `[[ratelimits]]` binding
   * in `wrangler.toml`. `RateLimit` is an ambient type from the generated
   * `worker-configuration.d.ts`.
   */
  ICAL_RATE_LIMIT: RateLimit
}
