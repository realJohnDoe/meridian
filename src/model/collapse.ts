import type { OccurrenceMetadata, FileMetadata, OccurrenceEntry, Entry } from '@/types'
import { isSeries, isStandaloneOcc } from '@/types'
import { OCCURRENCE_FIELDS, FILE_LEVEL_SPECS, STRUCTURAL_KEYS, inlineFieldEqual, inlineFieldEmpty, absentFieldValue, deepEqual } from './fieldRegistry'
import { saveFile } from './inheritance'

type AnyOcc = OccurrenceEntry<OccurrenceMetadata>

/**
 * Convert all StoreItems for one fileSlug into a YAML-serializable object.
 * Implements reverse-inheritance: fields that instances override are hoisted
 * into a `defaults:` block so generated occurrences inherit the right base.
 *
 * `root` carries the file-level fields (title/tags/items/body) — emitted at
 * the top-level root of the YAML, never hoisted into per-occurrence defaults.
 *
 * Single-series algorithm:
 * - All OccurrenceMetadata fields go into `defaults:` so every generated occurrence
 *   inherits them. Only structural fields (date, time, repeat) stay at root.
 * - Each instance stores only fields that differ from the series metadata.
 *
 * Multi-series / multi-item algorithm (split-series pattern):
 * - Fields shared across all sibling series and standalones → file root defaults.
 * - Each series root carries only structural fields (date, time, repeat).
 * - Series-specific metadata goes into the series' local defaults: block.
 * - Override instances diff against the series' full metadata.
 */
export function collapseToYaml(items: Entry['items'], root?: FileMetadata): Record<string, unknown> {
  // No `items.length === 0` branch: it used to emit the root's file-level
  // fields alone, so that a root with no occurrences was written rather than
  // blanked. `Entry['items']` is non-empty, so that entry cannot exist and no
  // caller can reach here with nothing — the debugger's own preview guards on
  // an empty list before it gets this far (`itemsToYaml`).
  const fileLevel = root ? fileMetaToYaml(root) : {}

  const series      = items.filter(isSeries)
  const standalones = items.filter(isStandaloneOcc)

  // Pair each series with its override children.
  const seriesBlocks = series.map(s => ({
    series:   s,
    children: items.filter(i => !isSeries(i) && i.ownerId === s.id) as AnyOcc[],
  }))

  // ── Simple flat cases (no inheritance hierarchy needed) ───────────────────
  // A single item with no override children is emitted as a flat YAML node —
  // metadata at root alongside the structural fields.

  // series.length === 1 guards every [0] below; seriesBlocks is 1:1 with series.
  if (series.length === 1 && standalones.length === 0 && seriesBlocks[0]!.children.length === 0) {
    const s = series[0]!
    return { ...fileLevel, ...occMetaToYaml(s.metadata), date: s.date, ...(s.time ? { time: s.time } : {}), repeat: s.repeat }
  }

  if (series.length === 0 && standalones.length === 1) {
    const s = standalones[0]!
    return { ...fileLevel, ...occMetaToYaml(s.metadata), ...(s.date ? { date: s.date } : {}), ...(s.time ? { time: s.time } : {}) }
  }

  // ── Container cases — inheritance hierarchy applies ───────────────────────
  //
  // computeSharedFields() decides what is shared (→ root defaults); each item
  // is then emitted relative to that baseline, so what is unique to it falls
  // out of the emit rule rather than being computed separately. Both are
  // domain-agnostic: they know nothing about dates, repeats, or YAML.
  //
  // Structural fields (date, time, repeat) are handled separately below:
  //   • Single series with instances → structural fields at the file root.
  //   • Multiple series / standalones → structural fields inside instances[].

  const allMetas: Partial<OccurrenceMetadata>[] = [
    ...seriesBlocks.map(b => b.series.metadata),
    ...standalones.map(s => s.metadata),
  ]
  const rootDefaults = computeSharedFields(allMetas)

  // ── Single series with instances (flat root, no outer instances wrapper) ──
  if (series.length === 1 && standalones.length === 0) {
    const { series: s, children } = seriesBlocks[0]!
    const instances = serializeChildren(children, s.metadata)
    const result: Record<string, unknown> = {}
    Object.assign(result, fileLevel)
    const rd = occMetaToYaml(rootDefaults)
    if (Object.keys(rd).length > 0) result.defaults = rd
    result.date   = s.date
    if (s.time)  result.time   = s.time
    result.repeat = s.repeat
    if (instances.length > 0) result.instances = instances
    return result
  }

  // ── Multiple series / standalones (container: root defaults + instances[]) ─
  const allInstances: Record<string, unknown>[] = []

  seriesBlocks.forEach(({ series: s, children }) => {
    const ld = occMetaToYaml(s.metadata, rootDefaults)
    const inst: Record<string, unknown> = {
      date:   s.date,
      ...(s.time ? { time: s.time } : {}),
      repeat: s.repeat,
    }
    if (Object.keys(ld).length > 0) inst.defaults = ld
    const childInstances = serializeChildren(children, s.metadata)
    if (childInstances.length > 0) inst.instances = childInstances
    allInstances.push(inst)
  })

  standalones.forEach(s => {
    const ld = occMetaToYaml(s.metadata, rootDefaults)
    allInstances.push({
      ...(s.date ? { date: s.date } : {}),
      ...(s.time ? { time: s.time } : {}),
      ...ld,
    })
  })

  const result: Record<string, unknown> = {}
  Object.assign(result, fileLevel)
  const rd = occMetaToYaml(rootDefaults)
  if (Object.keys(rd).length > 0) result.defaults = rd
  result.instances = allInstances
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// `hoistSharedMetadata` used to live here, returning `rootDefaults` plus a
// parallel `localDefaults` array of per-item diffs. The diff half is gone:
// each item is now emitted with `occMetaToYaml(item.metadata, rootDefaults)`,
// which makes the same decision without materialising an intermediate object
// that had to be kept 1:1 with `allMetas` by index. What's left is
// `computeSharedFields` on its own, called directly.

/**
 * Serialize the override children of a series into a YAML instances array.
 * Each child stores only the fields that differ from the series metadata.
 *
 * An excluded child is still diffed against `seriesMeta` like any other override
 * — exclusion only suppresses the occurrence from expansion (see `makeOcc` in
 * expansion.ts), it does not erase whatever the user had already written on that
 * instance (a note, a link, a completed `done`). Un-excluding it must bring that
 * back, not resurface a blank slot.
 */
function serializeChildren(
  children: AnyOcc[],
  seriesMeta: Partial<OccurrenceMetadata>,
): Record<string, unknown>[] {
  return children.map(c => {
    const child: Record<string, unknown> = { date: c.date }
    if (c.time) child.time = c.time
    if (c.excluded) child.excluded = true
    Object.assign(child, occMetaToYaml(c.metadata, seriesMeta))
    return child
  })
}

/**
 * Copy a metadata bag's unknown keys onto the emitted node, skipping any the
 * baseline already supplies with an equal value (`deepEqual`, since an unknown
 * key can hold a nested mapping or sequence that `===` cannot compare).
 *
 * Structural keys are skipped defensively — the parse side can never put one in
 * the bag, but a hand-built StoreItem (tests, the debug view) could, and letting
 * one through would overwrite the schedule this node is emitting.
 *
 * `baselineExtra` is `undefined` for a node that inherits nothing, which makes
 * every key differ and so emits the whole bag — the behaviour every caller had
 * before this took a baseline at all.
 */
function emitExtra(
  extra: Record<string, unknown> | undefined,
  baselineExtra: Record<string, unknown> | undefined,
  out: Record<string, unknown>,
): void {
  if (!extra) return
  for (const [k, v] of Object.entries(extra)) {
    if (STRUCTURAL_KEYS.has(k)) continue
    if (baselineExtra && deepEqual(v, baselineExtra[k])) continue
    out[k] = v
  }
}

/** Emit file-level fields as a YAML-serializable object. */
function fileMetaToYaml(root: FileMetadata): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of FILE_LEVEL_SPECS) {
    // A registry key present in `extra` was written in a shape the model can't
    // represent; the raw value wins so it round-trips (the typed field holds the
    // ''/[] fallback, which inlineFieldEmpty does not always suppress).
    if (root.extra && spec.key in root.extra) continue
    const v = (root as unknown as Record<string, unknown>)[spec.key as string]
    if (!inlineFieldEmpty(spec.kind, v)) out[spec.key] = v
  }
  // No baseline: a file has exactly one root, so file-level fields inherit from
  // nothing and every unknown key on it is emitted. Deliberately still using
  // `inlineFieldEmpty` above rather than the relational rule occurrence fields
  // now use — switching it would also stop emitting `title: ""` for a
  // frontmatter-less note, which is finding #8's repro (c) and a separate
  // product question about whether Meridian should touch such files at all.
  emitExtra(root.extra, undefined, out)
  return out
}

/**
 * Emit a node's occurrence metadata as YAML, relative to what it inherits.
 *
 * **One rule, at every emit site: a key is omitted only when omitting it would
 * round-trip.** If leaving `duration` out means the next parse reads back the
 * same value this node holds — because the baseline supplies it, or because
 * the field's absent-value default already matches — the key is noise and is
 * dropped. Otherwise it is written, *including when the value is "nothing"*:
 * an occurrence that cleared a `participants:` list its series still carries
 * must say `participants: []`, and one that stopped being a task must say
 * `done: null`, or the next parse silently re-inherits the old value
 * (data-integrity survey, finding #2a).
 *
 * `baseline` is whatever this node inherits: the series metadata for an
 * override child, the root `defaults:` block for a series inside a container,
 * and `{}` for a node at the top of its own chain — a flat single item, or a
 * `defaults:` block itself, which inherits from nothing.
 *
 * That last case is why an empty baseline is deliberately **not** a separate
 * mode. `absentFieldValue` makes `participants: []` at a root compare equal to
 * omitting it, so roots stay clean on the same rule that makes an override
 * emit the very same value. The predicate this replaced (`inlineFieldEmpty`,
 * a function of the value alone) could not tell those two apart, which is
 * exactly why a cleared field vanished: it asked "is this empty?" when the
 * question is "would omitting this lose information?".
 */
function occMetaToYaml(
  m: Partial<OccurrenceMetadata>,
  baseline: Partial<OccurrenceMetadata> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const spec of OCCURRENCE_FIELDS) {
    // A registry key parked in `extra` was written in a shape the model can't
    // represent; the raw value wins on emission, so skip the typed field here
    // and let emitExtra below write the original.
    if (m.extra && spec.key in m.extra) continue
    const v = (m as Record<string, unknown>)[spec.key as string]
    const inherited = (baseline as Record<string, unknown>)[spec.key as string]
    const ifOmitted = inherited !== undefined ? inherited : absentFieldValue(spec)
    if (inlineFieldEqual(spec.kind, v, ifOmitted)) continue
    // `undefined` reaching here means the node holds nothing where the baseline
    // holds something — an override that untracked itself. YAML's word for that
    // is `null`, which this format already uses the same way for unknown keys
    // (see unknown-keys.test.ts's "keeps an explicit null and an empty list").
    result[spec.key] = v === undefined ? null : v
  }
  emitExtra(m.extra, baseline.extra, result)
  return result
}

/** Find fields that have the same value across all metadata objects. */
function computeSharedFields(metas: Partial<OccurrenceMetadata>[]): Partial<OccurrenceMetadata> {
  if (metas.length === 0) return {}
  const shared: Partial<OccurrenceMetadata> = {}
  for (const spec of OCCURRENCE_FIELDS) {
    const first = (metas[0] as Record<string, unknown>)[spec.key as string]
    if (first === undefined) continue
    if (metas.every(m => inlineFieldEqual(spec.kind, (m as Record<string, unknown>)[spec.key as string], first)))
      (shared as Record<string, unknown>)[spec.key] = first
  }
  // Unknown keys hoist on the same rule, by structural equality: every item must
  // carry the key with an equal value. Hoisting is an optimisation — a key that
  // fails to hoist stays on each item and still round-trips.
  const sharedExtra: Record<string, unknown> = {}
  for (const [key, first] of Object.entries(metas[0]?.extra ?? {})) {
    if (metas.every(m => m.extra && key in m.extra && deepEqual(m.extra[key], first)))
      sharedExtra[key] = first
  }
  if (Object.keys(sharedExtra).length > 0) shared.extra = sharedExtra
  return shared
}

// `diffMetadata` used to live here: it computed "fields that differ from the
// baseline" as an intermediate object, which `occMetaToYaml` then re-filtered
// through `inlineFieldEmpty` — and that second filter is what dropped a
// deliberately-cleared field, since by then `[]` was indistinguishable from
// "never set". Both steps are now one relational decision inside
// `occMetaToYaml`, which takes the baseline directly. Its `undefined` skip
// (`if (v === undefined) continue`) is likewise gone: that was the other half
// of the same bug, silently discarding an untracked override before it could
// be emitted as `done: null`.

/**
 * One entry's store state as the bytes of its file — `collapseToYaml` plus the
 * body, in the one order that is correct.
 *
 * The pair used to be written out by hand at each of the three places that
 * needed it (the cache write, the cross-vault move, and the model suite's own
 * `serialize` helper, whose comment promised it "mirrors writeEntityToCache").
 * Three copies of a serialization rule agreeing by convention is how a
 * divergence goes unnoticed, and it is what the write path is now handed
 * instead of a key it has to resolve for itself.
 */
export function serializeEntry(items: Entry['items'], root: FileMetadata): string {
  return saveFile(collapseToYaml(items, root), root.body ?? '', root.fileConvention)
}
