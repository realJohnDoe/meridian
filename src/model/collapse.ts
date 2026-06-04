import type { StoreItem, InlineMetadata, AppMetadata } from '../types'
import { isSeries, INLINE_FIELDS, inlineFieldEqual, inlineFieldEmpty } from '../types'
import type { OccurrenceEntry } from './expansion'

type AnyOcc = OccurrenceEntry<AppMetadata>

/**
 * Convert all StoreItems for one fileSlug into a YAML-serializable object.
 * Implements reverse-inheritance: fields that instances override are hoisted
 * into a `defaults:` block so generated occurrences inherit the right base.
 *
 * Single-series algorithm:
 * - All InlineMetadata fields go into `defaults:` so every generated occurrence
 *   inherits them. Only structural fields (date, time, repeat) stay at root.
 * - Each instance stores only fields that differ from the series metadata.
 *
 * Multi-series / multi-item algorithm (split-series pattern):
 * - Fields shared across all sibling series and standalones → file root defaults.
 * - Each series only stores diverging values.
 */
export function collapseToYaml(items: StoreItem[]): Record<string, unknown> {
  if (items.length === 0) return {}

  const series = items.filter(isSeries)
  // Root-level standalones: non-series items with no ownerId (direct children of the file root).
  // Items with ownerId are children of a specific series — they appear in seriesBlocks, not here.
  const standalones = items.filter(i => !isSeries(i) && !(i as { ownerId?: string }).ownerId)

  // ── Single series with no standalones (most common case) ──────────────────
  if (series.length === 1 && standalones.length === 0) {
    const s = series[0]
    const children = items.filter(i => !isSeries(i) && (i as { ownerId?: string }).ownerId === s.id)

    if (children.length === 0) {
      // Simple series node
      return {
        ...metadataToYaml(s.metadata),
        date:   s.date,
        ...(s.time ? { time: s.time } : {}),
        repeat: s.repeat,
      }
    }

    // Series with explicit instances.
    //
    // All metadata goes into `defaults:` so every generated occurrence inherits
    // it. Only structural fields (date, time, repeat) live at the series root.
    // Each instance stores only the fields that differ from the series metadata.
    const occs = children as AnyOcc[]

    const instances = occs.map(c => {
      if (c.excluded) return { date: c.date, excluded: true }
      const diff = diffMetadata(c.metadata, s.metadata)
      const inst: Record<string, unknown> = { date: c.date }
      if (c.time) inst.time = c.time
      Object.assign(inst, metadataToYaml(diff as Partial<InlineMetadata>))
      return inst
    })

    const defaultsYaml = metadataToYaml(s.metadata)
    const result: Record<string, unknown> = {}
    if (Object.keys(defaultsYaml).length > 0) result.defaults = defaultsYaml
    result.date   = s.date
    if (s.time)  result.time   = s.time
    result.repeat = s.repeat
    if (instances.length > 0) result.instances = instances
    return result
  }

  // ── Single standalone occurrence (no series, one root-level item) ───────────
  if (series.length === 0 && standalones.length === 1) {
    const s = standalones[0]
    return {
      ...metadataToYaml(s.metadata),
      date: s.date,
      ...(s.time ? { time: s.time } : {}),
    }
  }

  // ── Multiple items — build container with root defaults + instances ────────

  // Collect per-series default blocks (step 1)
  const seriesBlocks: Array<{ series: StoreItem; defaults: Partial<InlineMetadata>; instances: Array<{ date: string; time?: string | null; diff: Partial<InlineMetadata>; excluded?: boolean }> }> = series.map(s => {
    const children = items.filter(i => !isSeries(i) && (i as AnyOcc).ownerId === s.id) as AnyOcc[]
    const nonExcluded = children.filter(c => !c.excluded)
    const shared = nonExcluded.length > 0 ? computeSharedFields(nonExcluded.map(c => c.metadata)) : {} as Partial<InlineMetadata>
    const childInsts = children.map(c => ({
      date: c.date,
      time: c.time,
      excluded: c.excluded,
      diff: diffMetadata(c.metadata, shared) as Partial<InlineMetadata>,
    }))
    return { series: s, defaults: shared, instances: childInsts }
  })

  // Step 2: find common fields across all series' own metadata AND root-level standalones.
  // Fields shared by every series (e.g. title, tags) become root defaults.
  // Using series.metadata (not b.defaults) ensures we capture the series' own fields,
  // not just the shared fields of their override children (which is empty for series with
  // no explicit overrides, causing title/tags to be missed).
  const allForRootDefaults: Partial<InlineMetadata>[] = [
    ...seriesBlocks.map(b => b.series.metadata),
    ...standalones.map(s => s.metadata),
  ]
  const rootDefaults = allForRootDefaults.length > 0 ? computeSharedFields(allForRootDefaults) : {} as Partial<InlineMetadata>

  // Build instances array
  const allInstances: Record<string, unknown>[] = []

  for (const block of seriesBlocks) {
    const s = block.series as (typeof series)[number]
    const seriesDiff = diffMetadata(s.metadata, rootDefaults)
    const seriesDefaultsDiff = diffMetadata(block.defaults, rootDefaults)

    const inst: Record<string, unknown> = {
      date:   s.date,
      ...(s.time ? { time: s.time } : {}),
      repeat: s.repeat,
      ...metadataToYaml(seriesDiff as Partial<InlineMetadata>),
    }
    if (Object.keys(seriesDefaultsDiff).length > 0) {
      inst.defaults = metadataToYaml(seriesDefaultsDiff as Partial<InlineMetadata>)
    }
    if (block.instances.length > 0) {
      inst.instances = block.instances.map(ci => {
        if (ci.excluded) return { date: ci.date, excluded: true }
        const child: Record<string, unknown> = { date: ci.date }
        if (ci.time) child.time = ci.time
        Object.assign(child, metadataToYaml(ci.diff))
        return child
      })
    }
    allInstances.push(inst)
  }

  for (const s of standalones) {
    const diff = diffMetadata(s.metadata, rootDefaults)
    allInstances.push({
      date: s.date,
      ...(s.time ? { time: s.time } : {}),
      ...metadataToYaml(diff as Partial<InlineMetadata>),
    })
  }

  const result: Record<string, unknown> = {}
  if (Object.keys(rootDefaults).length > 0) {
    result.defaults = metadataToYaml(rootDefaults as Partial<InlineMetadata>)
  }
  result.instances = allInstances
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert InlineMetadata fields to a plain YAML-serializable object. */
function metadataToYaml(m: Partial<InlineMetadata>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const spec of INLINE_FIELDS) {
    const v = m[spec.key]
    if (!inlineFieldEmpty(spec.kind, v)) result[spec.key] = v
  }
  return result
}

/** Find fields that have the same value across all metadata objects. */
function computeSharedFields(metas: Partial<InlineMetadata>[]): Partial<InlineMetadata> {
  if (metas.length === 0) return {}
  const shared: Partial<InlineMetadata> = {}
  for (const spec of INLINE_FIELDS) {
    const first = metas[0][spec.key]
    if (first === undefined) continue
    if (metas.every(m => inlineFieldEqual(spec.kind, m[spec.key], first)))
      (shared as Record<string, unknown>)[spec.key] = first
  }
  return shared
}

/** Return fields from `meta` that differ from (or are absent from) `defaults`. */
function diffMetadata(meta: Partial<InlineMetadata>, defaults: Partial<InlineMetadata>): Partial<InlineMetadata> {
  const diff: Partial<InlineMetadata> = {}
  for (const spec of INLINE_FIELDS) {
    const v = meta[spec.key]
    if (v === undefined) continue
    if (!inlineFieldEqual(spec.kind, v, defaults[spec.key]))
      (diff as Record<string, unknown>)[spec.key] = v
  }
  return diff
}
