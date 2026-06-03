import type { StoreItem, InlineMetadata } from '../types'
import { isSeries } from '../types'

/**
 * Convert all StoreItems for one fileSlug into a YAML-serializable object.
 * Implements reverse-inheritance: shared fields are hoisted to a defaults block.
 *
 * Algorithm (bottom-up):
 * 1. Leaf level — for each RepeatPattern, collect its explicit OccurrenceEntry
 *    children (ownerId === series.id). Find the largest common subset of
 *    InlineMetadata fields across all children → series defaults block.
 *    Each child only stores fields that differ from those defaults.
 * 2. Series level — compare only the defaults blocks computed in step 1 across
 *    all sibling RepeatPatterns. Common subset → file root defaults block.
 *    Each series only stores diverging defaults.
 * 3. Root structure: if multiple items → root is only defaults+instances, no direct
 *    date/time/repeat. If exactly one item → root represents it directly.
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

    // Series with explicit instances
    const nonExcluded = children.filter(c => !c.excluded)
    const sharedDefaults = computeSharedFields(nonExcluded.map(c => c.metadata))
    const instances = children.map(c => {
      if (c.excluded) return { date: c.date, excluded: true }
      const diff = diffMetadata(c.metadata, sharedDefaults)
      const inst: Record<string, unknown> = { date: c.date }
      if (c.time) inst.time = c.time
      Object.assign(inst, metadataToYaml(diff as Partial<InlineMetadata>))
      return inst
    })

    const result: Record<string, unknown> = {
      ...metadataToYaml(s.metadata),
      date:   s.date,
      ...(s.time ? { time: s.time } : {}),
      repeat: s.repeat,
    }
    if (Object.keys(sharedDefaults).length > 0) {
      result.defaults = metadataToYaml(sharedDefaults as Partial<InlineMetadata>)
    }
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
    const children = items.filter(i => !isSeries(i) && (i as { ownerId?: string }).ownerId === s.id)
    const nonExcluded = children.filter(c => !(c as { excluded?: boolean }).excluded)
    const shared = nonExcluded.length > 0 ? computeSharedFields(nonExcluded.map(c => c.metadata)) : {} as Partial<InlineMetadata>
    const childInsts = children.map(c => ({
      date: c.date,
      time: c.time,
      excluded: (c as { excluded?: boolean }).excluded,
      diff: diffMetadata(c.metadata, shared) as Partial<InlineMetadata>,
    }))
    return { series: s, defaults: shared, instances: childInsts }
  })

  // Step 2: find common fields across series defaults blocks AND root-level standalones.
  // Standalones have no children so their own metadata IS their effective leaf value.
  // Anything not in a series' defaults is already known to vary, so only defaults are
  // consulted for series (per the plan); standalones participate directly with their metadata.
  const allForRootDefaults: Partial<InlineMetadata>[] = [
    ...seriesBlocks.map(b => b.defaults),
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
  if (m.title !== undefined)    result.title    = m.title
  if (m.done  !== undefined)    result.done     = m.done
  if (m.tags  !== undefined && m.tags.length > 0) result.tags = m.tags
  if (m.priority !== undefined) result.priority = m.priority
  if (m.duration !== undefined) result.duration = m.duration
  if (m.timezone !== undefined) result.timezone = m.timezone
  return result
}

/** Find fields that have the same value across all metadata objects. */
function computeSharedFields(metas: Partial<InlineMetadata>[]): Partial<InlineMetadata> {
  if (metas.length === 0) return {}
  const keys: (keyof InlineMetadata)[] = ['title', 'done', 'tags', 'priority', 'duration', 'timezone']
  const shared: Partial<InlineMetadata> = {}
  for (const key of keys) {
    const first = metas[0][key]
    if (first === undefined) continue
    const allSame = metas.every(m => {
      const v = m[key]
      if (key === 'tags') return JSON.stringify(v) === JSON.stringify(first)
      return v === first
    })
    if (allSame) (shared as Record<string, unknown>)[key] = first
  }
  return shared
}

/** Return fields from `meta` that differ from (or are absent from) `defaults`. */
function diffMetadata(meta: Partial<InlineMetadata>, defaults: Partial<InlineMetadata>): Partial<InlineMetadata> {
  const diff: Partial<InlineMetadata> = {}
  const keys: (keyof InlineMetadata)[] = ['title', 'done', 'tags', 'priority', 'duration', 'timezone']
  for (const key of keys) {
    const v = meta[key]
    if (v === undefined) continue
    const d = defaults[key]
    if (key === 'tags') {
      if (JSON.stringify(v) !== JSON.stringify(d)) (diff as Record<string, unknown>)[key] = v
    } else {
      if (v !== d) (diff as Record<string, unknown>)[key] = v
    }
  }
  return diff
}
