import { parseToStoreItems, roundTripLoss, type ParseResult } from '@/model'
import { pathToKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { runInIdleBatches } from '@/lib/idle'
import type { Entries } from '@/types'
import { warn } from './notifications'

/** A file that failed to parse, keyed by its path (see `ParseFailure.key` for the store key). */
export interface ParseFailure {
  path:    string
  key:     EntryKey
  message: string
}

/** A file that loads fine but would lose frontmatter on save — see `roundTripLoss`. */
interface RoundTripLoss {
  path: string
  /** The `key=value` pairs a save would drop. Never empty. */
  lost: string[]
}

/**
 * Run the round-trip guard over every successfully-parsed file, spread across
 * idle periods, and report anything it finds.
 *
 * Split out of the `parseFiles` loop because it dominated it: on a 300-file
 * vault the guard measured 75% of the total parse cost (and 70 of its 92 ms was
 * the two extra `loadFile` calls it makes internally), all of it blocking the
 * agenda's first paint. Coverage is unchanged — every file is still checked,
 * and `reportRoundTripLosses` still toasts — only the timing moved.
 *
 * Deliberately not cancellable from the outside: a sweep that started for a
 * vault which has since been switched away still reports a genuine defect in a
 * real file, and the check is a pure function of the (path, content, parsed)
 * triple it captured, so a later vault change cannot make its verdict wrong.
 */
function auditRoundTrip(parsed: Array<{ path: string; content: string; result: ParseResult }>): void {
  const lossy: RoundTripLoss[] = []
  runInIdleBatches(
    parsed,
    ({ path, content, result }) => {
      const lost = roundTripLoss(path, content, result)
      if (lost.length > 0) {
        lossy.push({ path, lost })
        console.warn('[vault] save would drop frontmatter from', path, lost)
      }
    },
    () => { reportRoundTripLosses(lossy) },
  )
}

export function parseFiles(
  files: Array<{ path: string; content: string }>,
  vaultId: string,
): { entries: Entries; failures: ParseFailure[]; auditRoundTrip: () => void } {
  const entries: Entries = new Map()
  const failures: ParseFailure[] = []
  const parsed: Array<{ path: string; content: string; result: ParseResult }> = []
  for (const { path, content } of files) {
    try {
      const result = parseToStoreItems(path, content, vaultId)
      entries.set(result.key, result)
      // The round-trip guard is deferred (see auditRoundTrip above), but the
      // parse it needs is kept here rather than redone: it is only sound on an
      // UNEDITED round trip — after an edit, an intentional change reads as a
      // "loss" — so it must see the file exactly as it was loaded.
      parsed.push({ path, content, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failures.push({ path, key: pathToKey(vaultId, path), message })
      console.warn('[vault] parse failed for', path, e)
    }
  }
  return { entries, failures, auditRoundTrip: () => { auditRoundTrip(parsed) } }
}

/**
 * Surface parse failures to the user. A `console.warn` alone (the old
 * behaviour) is invisible in a PWA with no open devtools — this is the one
 * user-visible signal that a hand-edited file silently dropped out of the
 * vault. Called after every full load and every reconcile merge that touches
 * a file which fails to parse.
 */
export function reportParseFailures(failures: ParseFailure[]): void {
  if (failures.length === 0) return
  const [first] = failures
  if (first && failures.length === 1) {
    warn(`Couldn't read ${first.path} — ${first.message}`)
    return
  }
  warn(`Couldn't read ${failures.length} files: ${failures.map(f => f.path).join(', ')}`)
}

/** Keys already reported this session, so a re-load or a reconcile touching the
 *  same file doesn't re-toast. Session-scoped by design: a reload is a fresh
 *  chance to notice, and this never grows beyond the number of affected files
 *  (expected: zero). */
const _reportedLossy = new Set<string>()

/**
 * Surface a file that loads fine but would lose frontmatter on save. Called
 * only by `auditRoundTrip` above, once its idle sweep finishes — the parse path
 * no longer reports losses inline, so this is module-private.
 *
 * This is a Meridian bug, not something the user did wrong — every known cause
 * is fixed and test-pinned — so the message says so and asks for a report
 * rather than offering a fix. Deliberately just a warning: it does not block
 * the write or quarantine the file. If this ever actually fires, that is the
 * point to decide whether it should. See `roundTripCheck.ts`.
 */
function reportRoundTripLosses(lossy: RoundTripLoss[]): void {
  const fresh = lossy.filter(l => !_reportedLossy.has(l.path))
  if (fresh.length === 0) return
  for (const l of fresh) _reportedLossy.add(l.path)

  const [first] = fresh
  if (first && fresh.length === 1) {
    // Cap the key list: a pathological file shouldn't produce a wall of text.
    const keys = first.lost.slice(0, 3).join(', ')
    const more = first.lost.length > 3 ? `, +${first.lost.length - 3} more` : ''
    warn(`Editing ${first.path} in Meridian would drop frontmatter (${keys}${more}). This is a bug — please report it.`)
    return
  }
  warn(`Editing these ${fresh.length} files in Meridian would drop frontmatter: ${fresh.map(f => f.path).join(', ')}. This is a bug — please report it.`)
}
