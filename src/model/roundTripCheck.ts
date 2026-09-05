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
 *
 * **Value keys vs. source keys.** A key Meridian types (a registry field, or a
 * structural key the model reads directly) is compared by its PARSED value:
 * emission for these is deliberately normalised — a numeric-looking title gets
 * quoted, `duration: 90` becomes `duration: "90"` — and flagging that would
 * fire on every ordinary file. Everything else (the `extra` bag) is compared
 * by SOURCE TEXT — the exact characters the user wrote — because nothing there
 * may legitimately be reformatted: an unknown key surviving with a different
 * quoting style, a flipped sign or a rounded integer is exactly as much a loss
 * as the key vanishing outright, and a value-only comparison can't see it
 * (data-integrity survey, finding #5/#6).
 */

import { parseDocument, isMap, isSeq, isScalar, isNode } from 'yaml'
import { OCCURRENCE_FIELDS, FILE_LEVEL_SPECS } from './fieldRegistry'
import { collapseToYaml } from './collapse'
import { saveFile } from './inheritance'
import type { ParseResult } from './storeItems'

/** Same frontmatter fence `fileIO.ts`'s `loadFile` splits on. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?[\s\S]*$/

/**
 * Keys compared by parsed value rather than source text: every registry field
 * (`fieldRegistry.ts`'s `INLINE_FIELDS`, at both levels) plus the structural
 * keys the model reads directly (`date`/`time`/`repeat`/`excluded`) — all of
 * which are re-normalised on every save by design. `instances`/`defaults`, the
 * other two `STRUCTURAL_KEYS`, are not listed here because they never reach
 * this check as a value at all — they are always recursed into below.
 */
const NORMALISED_KEYS: ReadonlySet<string> = new Set([
  'date', 'time', 'repeat', 'excluded',
  ...OCCURRENCE_FIELDS.map(s => s.key as string),
  ...FILE_LEVEL_SPECS.map(s => s.key as string),
])

/**
 * A leaf-preserving stringification of a YAML node: every `Scalar` contributes
 * its raw `.source` (the original characters) instead of its parsed JS value,
 * so a value a save silently reformats — a big integer rounded, a leading
 * zero or `+` dropped, a quoted string unquoted — differs from its own source
 * even though both parse to the same JS value.
 */
function sourceOf(node: unknown): string {
  if (isScalar(node)) return node.source ?? JSON.stringify(node.toJSON())
  if (isMap(node)) return `{${node.items.map(p => `${String(p.key)}:${sourceOf(p.value)}`).join(',')}}`
  if (isSeq(node)) return `[${node.items.map(sourceOf).join(',')}]`
  return JSON.stringify(node)
}

/**
 * Every `key → value` pair anywhere in `content`'s frontmatter, recursing
 * through `defaults:` and `instances:`. Pairs are stringified so they can be
 * compared as sets: collapse legitimately RELOCATES a key (root ↔
 * `defaults:`) and changes how many times it appears (one hoisted key ↔ N
 * per-instance copies), so containment is the only invariant that holds — but
 * losing a pair entirely never is. See the module doc for which half of a
 * pair — value or source — a given key compares by.
 */
export function collectKeyValues(content: string): string[] {
  const m = content.match(FRONTMATTER_RE)
  if (!m) return []
  return collectFromNode(parseDocument(m[1]!).contents)
}

function collectFromNode(node: unknown): string[] {
  if (!isMap(node)) return []
  const out: string[] = []
  for (const pair of node.items) {
    const k = String(pair.key)
    if (k === 'defaults') { out.push(...collectFromNode(pair.value)); continue }
    if (k === 'instances') {
      if (isSeq(pair.value)) for (const child of pair.value.items) out.push(...collectFromNode(child))
      continue
    }
    const rendered = NORMALISED_KEYS.has(k)
      ? JSON.stringify(isNode(pair.value) ? pair.value.toJSON() : pair.value)
      : sourceOf(pair.value)
    out.push(`${k}=${rendered}`)
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
export function roundTripLoss(_path: string, content: string, parsed: ParseResult): string[] {
  const saved = saveFile(
    collapseToYaml(parsed.items, parsed.root),
    parsed.root.body ?? '',
    parsed.root.fileConvention,
  )
  const before = new Set(collectKeyValues(content))
  const after = new Set(collectKeyValues(saved))
  return [...before].filter(pair => !after.has(pair))
}
