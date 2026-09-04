import type { Occurrence } from '@/types'

/**
 * The view's occurrence filter, as the pure builders below it see it.
 *
 * `useCalendarFilter` composes the live one out of the user's participant and
 * vault hiding preferences; `buildAgendaSections` and `computeOverduePool`
 * both take it as a parameter rather than reading the store themselves, which
 * is what keeps them pure and testable (their tests pass `occs => occs`).
 *
 * It lives in its own leaf module for that "both" — it used to be declared in
 * `agendaSections.ts`, which `overduePool.ts` then had to import back for it,
 * while `agendaSections.ts` imports `OverdueGroup` the other way. Two modules
 * naming each other's types is still a cycle (invariant 4 counts type edges),
 * and the fix for a shared contract is to move it below both, not to pick one
 * of them to own it.
 */
export type FilterOccs = (occs: Occurrence[]) => Occurrence[]
