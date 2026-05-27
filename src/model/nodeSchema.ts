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
 * Only the fields the model layer reads are declared; everything else passes
 * through via passthrough() so domain fields don't need to be enumerated here.
 */
export const RawNodeSchema: z.ZodType<RawNode> = z.lazy(() =>
  z.object({
    // Used by inheritance resolution
    defaults:  z.record(z.string(), z.unknown()).optional(),
    instances: z.array(RawNodeSchema).optional(),
    // Used by expansion (repeat detection + single-date emission)
    repeat: z.record(z.string(), z.unknown()).optional(),
    date:   z.string().optional(),
  }).passthrough()
)
