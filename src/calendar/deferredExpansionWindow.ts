import { dayRange } from '@/model'

// A day far outside any realistic vault content — requested in place of a
// pane's real occurrence-expansion window while it isn't `ready` yet (see
// useReadyAfterMount), standing in for "no occurrences yet" during a pane's
// cheap first paint. Reliably empty, and requested identically by every
// not-ready pane across the app, so after the very first request it's a
// shared cache hit (see useExpandWithMultiday's cacheByWindow) — not fresh
// work on every pane mount.
const EMPTY_WINDOW_DAY = new Date(1900, 0, 1)
export const EMPTY_EXPANSION_WINDOW = dayRange(EMPTY_WINDOW_DAY, EMPTY_WINDOW_DAY)
