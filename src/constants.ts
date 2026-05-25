// ── Shared constants ─────────────────────────────────────────────────────────
// Single source of truth for values used across multiple modules.

/** Midnight of the current calendar day. Computed once at startup. */
export const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)
