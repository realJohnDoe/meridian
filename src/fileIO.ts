import { parse as parseYaml } from 'yaml'

// ── YAML parser ───────────────────────────────────────────────

/**
 * Parse YAML frontmatter to a plain object.
 *
 * Backed by the `yaml` package (YAML 1.2 core schema). Bare dates/times stay
 * strings under the core schema, matching how the rest of the app stores them.
 * Non-mapping documents (a bare scalar or sequence) collapse to `{}` — callers
 * always expect a mapping at the frontmatter root.
 */
function yamlParse(text: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(text)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

// ── Frontmatter split / merge ─────────────────────────────────

/** CRLF-aware frontmatter split — canonical for the whole codebase. */
function splitFrontmatter(content: string): { fm: string; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m) return { fm: m[1], body: m[2].trim() }
  return { fm: content, body: '' }
}

/** Wrap serialised YAML fields with --- delimiters and append markdown body. */
export function wrapFrontmatter(yamlFields: string, body: string): string {
  return `---\n${yamlFields}\n---${body ? '\n\n' + body : ''}`
}

// ── File parse ──────────────────────────────────────────────────

/** Parse raw file content to a plain object + body, without any domain typing. */
export function loadFile(
  path: string,
  content: string,
): { rawNode: Record<string, unknown>; body: string; path: string } {
  let fm: string
  let body: string
  const hasFrontmatter = /^---\r?\n/.test(content)
  if (hasFrontmatter) {
    ;({ fm, body } = splitFrontmatter(content))
  } else if (path.endsWith('.md')) {
    fm = ''
    body = content.trim()
  } else {
    fm = content
    body = ''
  }
  const rawNode = fm ? yamlParse(fm) : {}
  return { rawNode, body, path }
}

// ── Filename utility ──────────────────────────────────────────

export function titleToSlug(title: string): string {
  return (title || 'untitled')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled'
}
