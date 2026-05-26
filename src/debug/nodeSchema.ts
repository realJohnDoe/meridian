import { z } from 'zod'

/**
 * A raw node is an open YAML mapping that may carry:
 *  - `defaults:`  — fields to propagate to children (spec §2)
 *  - `instances:` — list of child nodes (non-inheritable, spec §1.4)
 *  - any other domain-specific fields (schema is open, spec §4)
 */
export type RawNode = {
  defaults?: Record<string, unknown>
  instances?: RawNode[]
  [key: string]: unknown
}

/**
 * Recursive Zod schema for a raw node.
 * Uses z.lazy for the recursive `instances` reference.
 * passthrough() preserves unknown domain fields (spec §4 — open schema).
 */
export const RawNodeSchema: z.ZodType<RawNode> = z.lazy(() =>
  z.object({
    defaults:  z.record(z.string(), z.unknown()).optional(),
    instances: z.array(RawNodeSchema).optional(),
  }).passthrough()
)
