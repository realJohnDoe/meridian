// ── MERIDIAN DOMAIN TYPES ────────────────────────────────────────────────────

export type Priority = 'high' | 'medium' | 'low'

export type Weekday = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su'

// ── Repeat ───────────────────────────────────────────────────────────────────

export type RepeatEnd =
  | { type: 'until'; date?: string; time?: string }
  | { type: 'count'; occurrences: number }

export interface ScheduledRepeat {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  byweekday?: Weekday[]
  bymonthday?: number[]
  bysetpos?: number
  interval?: number
  end?: RepeatEnd
}

export type Repeat =
  | { type: 'schedule'; scheduled: ScheduledRepeat }
  | { type: 'after_completion'; interval: string }

// ── Node ─────────────────────────────────────────────────────────────────────

/** Per-occurrence override stored inside a Node's `instances` array. */
export interface Instance {
  date: string
  time?: string
  done?: boolean
  excluded?: boolean
  title?: string
  body?: string
  tags?: string[]
  duration?: string
  priority?: Priority
  /** Used for 'future' scope child node that starts a new series. */
  repeat?: Repeat
}

export interface Multiday {
  start: string
  end: string
}

/** Canonical data structure — maps 1:1 to a YAML file on disk. */
export interface Node {
  id: string
  title: string
  body?: string
  date?: string
  time?: string
  duration?: string
  done?: boolean
  tags?: string[]
  priority?: Priority
  repeat?: Repeat
  instances?: Instance[]
  multiday?: Multiday
  timezone?: string
  /** Runtime-cached resolved file path — not persisted to YAML. */
  _path?: string
}

// ── Occurrence ───────────────────────────────────────────────────────────────

/**
 * An expanded occurrence produced by expandNode / expandRange.
 * Flat view of a single instance of a Node on a specific date.
 */
export interface Occurrence {
  title: string
  date: string
  time?: string | null
  timezone?: string
  jsTime: Date
  duration?: string
  done?: boolean
  priority?: Priority
  tags: string[]
  type: 'event' | 'task' | 'note'
  body?: string
  multiday?: Multiday
  recur?: boolean
  repeat?: Repeat
  _nodeId: string
  _node: Node
  /** Fallback id, mirrors _node.id for convenience. */
  id?: string
  /** True when this row is a multiday banner duplicate. */
  _isBanner?: boolean
  /** Computed duration in hours (set during day-view layout). */
  _dh?: number
  /** Computed end timestamp in ms (set during day-view layout). */
  _endMs?: number
}

// ── Dialog / Editor helpers ───────────────────────────────────────────────────

export interface Scheduled {
  date: string
  time: string
}
