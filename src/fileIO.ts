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

// ── File convention (line endings, trailing newline) ────────────
//
// Captured once at parse time and re-applied on save, so an edit to one field
// doesn't rewrite every `\r` in the file (data-integrity survey, finding #8).
// A save never mutates a body's own internal bytes to match this — it only
// governs the STRUCTURAL glue this module itself generates (the frontmatter
// fence, the blank line separating it from the body, the file's final
// newline), which is exactly the part that used to hardcode LF regardless of
// source.

export interface FileConvention {
  /** The file predominantly uses `\r\n`. Detected once, applied to every
   *  Meridian-generated newline; the body's own bytes are never touched. */
  crlf: boolean
  /** The file ends with a newline byte. */
  trailingNewline: boolean
}

/** Meridian's own default for a freshly-created entry with no source file yet. */
const DEFAULT_FILE_CONVENTION: FileConvention = { crlf: false, trailingNewline: true }

// ── Frontmatter split / merge ─────────────────────────────────

/**
 * Strip exactly the blank-line padding `wrapFrontmatter`'s own separator
 * inserts — leading fully-blank lines, and the single trailing newline that
 * terminates the file — without touching indentation on a line that has
 * content, or blank lines the body genuinely contains in its middle or end.
 * `.trim()` used to do this and over-reached: it strips ALL leading/trailing
 * whitespace, including meaningful leading indentation on the body's first
 * line (e.g. an indented code block opening the note).
 */
function stripStructuralPadding(raw: string): { body: string; trailingNewline: boolean } {
  const withoutLeadingBlank = raw.replace(/^(?:[ \t]*\r?\n)+/, '')
  const trailingNewline = /\r?\n$/.test(withoutLeadingBlank)
  const body = trailingNewline ? withoutLeadingBlank.replace(/\r?\n$/, '') : withoutLeadingBlank
  return { body, trailingNewline }
}

/** CRLF-aware frontmatter split — canonical for the whole codebase. */
function splitFrontmatter(content: string): { fm: string; body: string; trailingNewline: boolean } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m) return { fm: m[1]!, ...stripStructuralPadding(m[2]!) }  // both groups are mandatory
  return { fm: content, body: '', trailingNewline: false }
}

/** Wrap serialised YAML fields with --- delimiters and append markdown body. */
export function wrapFrontmatter(
  yamlFields: string,
  body: string,
  convention: FileConvention = DEFAULT_FILE_CONVENTION,
): string {
  const nl = convention.crlf ? '\r\n' : '\n'
  // yamlFields is 100% Meridian-generated (the `yaml` package only ever emits
  // bare `\n`), so a blanket replace here is safe. `body` is never run through
  // this — its own bytes (already whatever convention the source had) are
  // concatenated as-is below.
  const fence = `---${nl}${yamlFields.replace(/\n/g, nl)}${nl}---`
  const withBody = body ? `${fence}${nl}${nl}${body}` : fence
  return convention.trailingNewline ? withBody + nl : withBody
}

// ── File parse ──────────────────────────────────────────────────

/** Parse raw file content to a plain object + body, without any domain typing. */
export function loadFile(
  path: string,
  content: string,
): { rawNode: Record<string, unknown>; body: string; path: string; convention: FileConvention } {
  let fm: string
  let body: string
  let trailingNewline: boolean
  const hasFrontmatter = /^---\r?\n/.test(content)
  if (hasFrontmatter) {
    ;({ fm, body, trailingNewline } = splitFrontmatter(content))
  } else {
    fm = ''
    ;({ body, trailingNewline } = stripStructuralPadding(content))
  }
  const rawNode = fm ? yamlParse(fm) : {}
  const convention: FileConvention = { crlf: /\r\n/.test(content), trailingNewline }
  return { rawNode, body, path, convention }
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

/** Canonical vault path → store slug mapping. Inverse of `slugToPath`. */
export function pathToSlug(path: string): string {
  return path.replace(/\.md$/, '')
}

/** Canonical store slug → vault path mapping. Inverse of `pathToSlug`. */
export function slugToPath(slug: string): string {
  return slug + '.md'
}
