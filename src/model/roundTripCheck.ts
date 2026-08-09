/**
 * Runtime guard for the Root-A totality invariant: a file Meridian loads must
 * survive an unedited save with every key/value pair intact.
 *
 * Deliberately minimal. Every leak the data-integrity survey found is fixed and
 * pinned by `__tests__/round-trip-totality.test.ts`, so this is expected to
 * never fire — it exists to catch the *next* one on a real vault, where a
 * fixture corpus can't reach. It reports; it does not repair, block a write, or
 * quarantine anything. If it ever does fire, that is the signal to decide what
 * the richer behaviour should be (refuse the write? mark the file read-only?),
 * with an actual case in hand rather than a hypothetical.
 *
 * **Scope, stated rather than implied.** This is the *source-fidelity* half of
 * the survey's two checks — "did the file lose something it had?", which is
 * sound only on an UNEDITED round trip. The other half, *collapse totality*
 * ("does the store survive its own serialization?"), is not wired up here: it
 * needs id-normalised StoreItem comparison, can only report "something
 * changed" rather than naming a key, and its one uniquely-covered class
 * (finding #2 — an edit's intent not surviving) exists only relative to an
 * `applyEdit` call, so a load-time check cannot see it at all. Both halves stay
 * covered by tests. Deferred on purpose.
 */

import { loadFile } from '@/fileIO'
import { STRUCTURAL_KEYS } from './fieldRegistry'
import { collapseToYaml } from './collapse'
import { saveFile } from './inheritance'
import type { ParseResult } from './storeItems'

/**
 * Every non-structural `key → value` pair anywhere in a parsed frontmatter
 * tree, recursing through `defaults:` and `instances:`. Pairs are stringified
 * so they can be compared as sets: collapse legitimately RELOCATES a key (root
 * ↔ `defaults:`) and changes how many times it appears (one hoisted key ↔ N
 * per-instance copies), so containment is the only invariant that holds — but
 * losing a pair entirely never is.
 */
export function collectKeyValues(node: unknown): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'defaults') { out.push(...collectKeyValues(v)); continue }
    if (k === 'instances') {
      if (Array.isArray(v)) for (const child of v) out.push(...collectKeyValues(child))
      continue
    }
    if (STRUCTURAL_KEYS.has(k)) continue
    out.push(`${k}=${JSON.stringify(v)}`)
  }
  return out
}

/**
 * The `key=value` pairs `content` carries that an unedited save would drop.
 * Empty when the file round-trips — the expected result for every file.
 *
 * Takes the caller's already-computed `parsed` rather than re-parsing, so this
 * costs one serialize plus two frontmatter reads on top of a load that has
 * happened anyway (~0.5 ms/file measured over a 300-file corpus).
 */
export function roundTripLoss(path: string, content: string, parsed: ParseResult): string[] {
  const saved = saveFile(
    collapseToYaml(parsed.items, parsed.root),
    parsed.root.body ?? '',
    parsed.root.fileConvention,
  )
  const before = new Set(collectKeyValues(loadFile(path, content).rawNode))
  const after = new Set(collectKeyValues(loadFile(path, saved).rawNode))
  return [...before].filter(pair => !after.has(pair))
}
