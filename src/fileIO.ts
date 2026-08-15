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

// ── Entry key ─────────────────────────────────────────────────
//
// An entry's identity is `(vault, slug)`. `Roots` is a Map and JS Maps compare
// object keys by reference, so a tuple can never be a lookup key — hence a
// composite string. It lives here, beside pathToSlug/slugToPath, because this
// module already owns the path↔slug mapping and is a root resident `model/`
// may import (architecture invariant 1).

declare const EntryKeyBrand: unique symbol

/**
 * In-memory identity of an entry: `${vaultId}::${fileSlug}`. Branded so a bare
 * string cannot be passed where a key is required — the bare-slug-vs-key mix-up
 * is a compile error, not a runtime bug. Never written to a file; files and URLs
 * carry the two halves separately. Mirrors the Dexie cache's own
 * `vp(vaultId, path)` composite key.
 */
export type EntryKey = string & { readonly [EntryKeyBrand]: true }

/**
 * The separator. Two colons rather than one because a vault id is a slug or a
 * UUID (neither can contain `:`) while a file slug is a vault-relative path
 * that theoretically can — so the FIRST occurrence always ends the vault id,
 * and everything after it is the slug verbatim. `parseEntryKey` relies on that.
 */
const KEY_SEP = '::'

export function entryKey(vaultId: string, fileSlug: string): EntryKey {
  return (vaultId + KEY_SEP + fileSlug) as EntryKey
}

/**
 * Split a key back into its halves. A string with no separator is treated as a
 * bare slug in an unknown vault (`vaultId: ''`) rather than throwing: keys reach
 * this from localStorage and URLs, where a value written by an older build can
 * still turn up. Callers that care use the empty vaultId as the "unmigrated"
 * signal — see `store.ts`'s favourites migration.
 */
export function parseEntryKey(key: EntryKey): { vaultId: string; fileSlug: string } {
  const i = key.indexOf(KEY_SEP)
  if (i === -1) return { vaultId: '', fileSlug: key }
  return { vaultId: key.slice(0, i), fileSlug: key.slice(i + KEY_SEP.length) }
}

/** Which vault the entry belongs to. */
export function keyVaultId(key: EntryKey): string {
  return parseEntryKey(key).vaultId
}

/** The bare, file-level slug — what `[[wikilinks]]` and the URL carry. */
export function keySlug(key: EntryKey): string {
  return parseEntryKey(key).fileSlug
}

/** True when `s` already carries a vault half. Used by the one-time migrations. */
export function isEntryKey(s: string): s is EntryKey {
  return s.includes(KEY_SEP)
}

/** Vault path → key, for the vault that path was read from. */
export function pathToKey(vaultId: string, path: string): EntryKey {
  return entryKey(vaultId, pathToSlug(path))
}

/** Key → the path inside its own vault. Drops the vault half. */
export function keyToPath(key: EntryKey): string {
  return slugToPath(keySlug(key))
}
