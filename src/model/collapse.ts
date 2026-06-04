import type { StoreItem, InlineMetadata, AppMetadata } from '../types'
import { isSeries } from '../types'
import type { OccurrenceEntry } from './expansion'

type AnyOcc = OccurrenceEntry<AppMetadata>

/**
 * Convert all StoreItems for one fileSlug into a YAML-serializable object.
 * Implements reverse-inheritance: fields that instances override are hoisted
 * into a `defaults:` block so generated occurrences inherit the right base.
 *
 * Single-series algorithm:
 * - A field goes into `defaults:` if the series has a defined value for it AND
 *   at least one non-excluded instance overrides it (differs from the series).
 *   This keeps the series itself clean (not "owned" by the instance value) while
 *   ensuring generated occurrences inherit the correct default.
 * - Fields no instance touches stay at the series root level.
 * - Each instance stores only fields that differ from the series metadata,
 *   whether those fields are at root or in defaults.
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
    // A field on the series belongs in `defaults:` if at least one non-excluded
    // instance overrides it. Generated occurrences inherit that default; the
    // series itself is NOT considered "done" (or whatever value) just because it
    // defined the default. Fields no instance touches stay at the series root.
    //
    // Instances are always diffed against the full series metadata, so a field
    // that matches the series (whether series-root or defaults) is dropped from
    // the instance — keeping each instance minimal.
    const occs        = children as AnyOcc[]
    const nonExcluded = occs.filter(c => !c.excluded)
    const allKeys: (keyof InlineMetadata)[] = ['title', 'done', 'tags', 'participants', 'priority', 'duration', 'timezone']

    // Keys where the series has a defined value AND some instance differs from it.
    const overriddenKeys = new Set<keyof InlineMetadata>(
      allKeys.filter(key => {
        const sv = s.metadata[key]
        if (sv === undefined) return false
        return nonExcluded.some(c => {
          const iv = c.metadata[key]
          return (key === 'tags' || key === 'participants')
            ? JSON.stringify(iv) !== JSON.stringify(sv)
            : iv !== sv
        })
      }),
    )

    // Split series metadata: overridden fields → defaults:, the rest → root.
    const rootMeta:     Partial<InlineMetadata> = {}
    const defaultsMeta: Partial<InlineMetadata> = {}
    for (const key of allKeys) {
      const v = s.metadata[key]
      if (v === undefined) continue
      if (overriddenKeys.has(key)) (defaultsMeta as Record<string, unknown>)[key] = v
      else                          (rootMeta     as Record<string, unknown>)[key] = v
    }

    const instances = occs.map(c => {
      if (c.excluded) return { date: c.date, excluded: true }
      const diff = diffMetadata(c.metadata, s.metadata)
      const inst: Record<string, unknown> = { date: c.date }
      if (c.time) inst.time = c.time
      Object.assign(inst, metadataToYaml(diff as Partial<InlineMetadata>))
      return inst
    })

    const result: Record<string, unknown> = {
      ...metadataToYaml(rootMeta),
      date:   s.date,
      ...(s.time ? { time: s.time } : {}),
      repeat: s.repeat,
    }
    if (overriddenKeys.size > 0) result.defaults  = metadataToYaml(defaultsMeta)
    if (instances.length > 0)    result.instances = instances
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
  if (m.title !== undefined)    result.title    = m.title
  if (m.done  !== undefined)    result.done     = m.done
  if (m.tags  !== undefined && m.tags.length > 0) result.tags = m.tags
  if (m.participants !== undefined && m.participants.length > 0) result.participants = m.participants
  if (m.priority !== undefined) result.priority = m.priority
  if (m.duration !== undefined) result.duration = m.duration
  if (m.timezone !== undefined) result.timezone = m.timezone
  return result
}

/** Find fields that have the same value across all metadata objects. */
function computeSharedFields(metas: Partial<InlineMetadata>[]): Partial<InlineMetadata> {
  if (metas.length === 0) return {}
  const keys: (keyof InlineMetadata)[] = ['title', 'done', 'tags', 'participants', 'priority', 'duration', 'timezone']
  const shared: Partial<InlineMetadata> = {}
  for (const key of keys) {
    const first = metas[0][key]
    if (first === undefined) continue
    const allSame = metas.every(m => {
      const v = m[key]
      if (key === 'tags' || key === 'participants') return JSON.stringify(v) === JSON.stringify(first)
      return v === first
    })
    if (allSame) (shared as Record<string, unknown>)[key] = first
  }
  return shared
}

/** Return fields from `meta` that differ from (or are absent from) `defaults`. */
function diffMetadata(meta: Partial<InlineMetadata>, defaults: Partial<InlineMetadata>): Partial<InlineMetadata> {
  const diff: Partial<InlineMetadata> = {}
  const keys: (keyof InlineMetadata)[] = ['title', 'done', 'tags', 'participants', 'priority', 'duration', 'timezone']
  for (const key of keys) {
    const v = meta[key]
    if (v === undefined) continue
    const d = defaults[key]
    if (key === 'tags' || key === 'participants') {
      if (JSON.stringify(v) !== JSON.stringify(d)) (diff as Record<string, unknown>)[key] = v
    } else {
      if (v !== d) (diff as Record<string, unknown>)[key] = v
    }
  }
  return diff
}
