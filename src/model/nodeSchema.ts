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
