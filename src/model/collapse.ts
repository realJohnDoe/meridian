import type { StoreItem, OccurrenceMetadata, FileMetadata } from '../types'
import { isSeries, OCCURRENCE_FIELDS, FILE_LEVEL_SPECS, inlineFieldEqual, inlineFieldEmpty } from '../types'
import type { OccurrenceEntry } from './expansion'

type AnyOcc = OccurrenceEntry<OccurrenceMetadata>

/**
 * Convert all StoreItems for one fileSlug into a YAML-serializable object.
 * Implements reverse-inheritance: fields that instances override are hoisted
 * into a `defaults:` block so generated occurrences inherit the right base.
 *
 * `root` carries the file-level fields (title/tags/topics/body) — emitted at
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
export function collapseToYaml(items: StoreItem[], root?: FileMetadata): Record<string, unknown> {
  if (items.length === 0) return {}

  const fileLevel = root ? fileMetaToYaml(root) : {}

  const series      = items.filter(isSeries)
  const standalones = items.filter(i => !isSeries(i) && !(i as { ownerId?: string }).ownerId)

  // Pair each series with its override children.
  const seriesBlocks = series.map(s => ({
    series:   s,
    children: items.filter(i => !isSeries(i) && (i as AnyOcc).ownerId === s.id) as AnyOcc[],
  }))

  // ── Simple flat cases (no inheritance hierarchy needed) ───────────────────
  // A single item with no override children is emitted as a flat YAML node —
  // metadata at root alongside the structural fields.

  if (series.length === 1 && standalones.length === 0 && seriesBlocks[0].children.length === 0) {
    const s = series[0]
    return { ...fileLevel, ...occMetaToYaml(s.metadata), date: s.date, ...(s.time ? { time: s.time } : {}), repeat: s.repeat }
  }

  if (series.length === 0 && standalones.length === 1) {
    const s = standalones[0] as AnyOcc
    return { ...fileLevel, ...occMetaToYaml(s.metadata), ...(s.date ? { date: s.date } : {}), ...(s.time ? { time: s.time } : {}) }
  }

  // ── Container cases — inheritance hierarchy applies ───────────────────────
  //
  // hoistSharedMetadata() is the single place that decides what is shared
  // (→ root defaults) vs what is unique to each item (→ local defaults).
  // It is domain-agnostic: it knows nothing about dates, repeats, or YAML.
  //
  // Structural fields (date, time, repeat) are handled separately below:
  //   • Single series with instances → structural fields at the file root.
  //   • Multiple series / standalones → structural fields inside instances[].

  const allMetas: Partial<OccurrenceMetadata>[] = [
    ...seriesBlocks.map(b => b.series.metadata),
    ...standalones.map(s => (s as AnyOcc).metadata),
  ]
  const { rootDefaults, localDefaults } = hoistSharedMetadata(allMetas)

  // ── Single series with instances (flat root, no outer instances wrapper) ──
  if (series.length === 1 && standalones.length === 0) {
    const { series: s, children } = seriesBlocks[0]
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

  seriesBlocks.forEach(({ series: s, children }, i) => {
    const ld = occMetaToYaml(localDefaults[i])
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

  standalones.forEach((s, i) => {
    const offset = seriesBlocks.length
    const ld = occMetaToYaml(localDefaults[offset + i])
    allInstances.push({
      ...(s.date ? { date: s.date } : {}),
      ...((s as AnyOcc).time ? { time: (s as AnyOcc).time } : {}),
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

/**
 * Domain-agnostic inheritance helper.
 *
 * Given N metadata objects, partition them into:
 *   - `rootDefaults` — fields shared by every item (→ file-level defaults: block)
 *   - `localDefaults` — per-item fields that diverge from the shared set
 *                       (→ per-series local defaults: block)
 */
function hoistSharedMetadata(metas: Partial<OccurrenceMetadata>[]): {
  rootDefaults: Partial<OccurrenceMetadata>
  localDefaults: Partial<OccurrenceMetadata>[]
} {
  const rootDefaults = computeSharedFields(metas)
  return {
    rootDefaults,
    localDefaults: metas.map(m => diffMetadata(m, rootDefaults)),
  }
}

/**
 * Serialize the override children of a series into a YAML instances array.
 * Each child stores only the fields that differ from the series metadata.
 */
function serializeChildren(
  children: AnyOcc[],
  seriesMeta: Partial<OccurrenceMetadata>,
): Record<string, unknown>[] {
  return children.map(c => {
    if (c.excluded) return { date: c.date, ...(c.time ? { time: c.time } : {}), excluded: true }
    const child: Record<string, unknown> = { date: c.date }
    if (c.time) child.time = c.time
    const diff = diffMetadata(c.metadata, seriesMeta)
    Object.assign(child, occMetaToYaml(diff))
    return child
  })
}

/** Emit file-level fields as a YAML-serializable object. */
function fileMetaToYaml(root: FileMetadata): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of FILE_LEVEL_SPECS) {
    const v = (root as unknown as Record<string, unknown>)[spec.key as string]
    if (!inlineFieldEmpty(spec.kind, v)) out[spec.key] = v
  }
  return out
}

/** Convert OccurrenceMetadata fields to a plain YAML-serializable object. */
function occMetaToYaml(m: Partial<OccurrenceMetadata>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const spec of OCCURRENCE_FIELDS) {
    const v = (m as Record<string, unknown>)[spec.key as string]
    if (!inlineFieldEmpty(spec.kind, v)) result[spec.key] = v
  }
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
  return shared
}

/** Return fields from `meta` that differ from (or are absent from) `defaults`. */
function diffMetadata(meta: Partial<OccurrenceMetadata>, defaults: Partial<OccurrenceMetadata>): Partial<OccurrenceMetadata> {
  const diff: Partial<OccurrenceMetadata> = {}
  for (const spec of OCCURRENCE_FIELDS) {
    const v = (meta as Record<string, unknown>)[spec.key as string]
    if (v === undefined) continue
    if (!inlineFieldEqual(spec.kind, v, (defaults as Record<string, unknown>)[spec.key as string]))
      (diff as Record<string, unknown>)[spec.key] = v
  }
  return diff
}
