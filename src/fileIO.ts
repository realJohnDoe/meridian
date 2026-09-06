import { isMap, isNode, isScalar, isSeq, parseDocument, Scalar } from 'yaml'
import type { Document, ParsedNode, ScalarTag, YAMLMap } from 'yaml'
import { stringifyString } from 'yaml/util'

// ── Authored scalars ───────────────────────────────────────────────────────
//
// A save rebuilds the whole file from the store, so every value is re-emitted
// from the JavaScript primitive it parsed to — and a primitive does not
// remember how it was written. `1234567890123456789` comes back rounded to the
// nearest double, `+49123456789` loses its sign, `01234` its leading zero, and
// `"yes"` its quotes (which YAML 1.1 readers — PyYAML, Ruby, js-yaml's default
// schema, Obsidian — then read as boolean `true`). Data-integrity survey,
// finding #6.
//
// `RawScalar` is the fix: a leaf that carries the characters its file actually
// held alongside the value they parse to, so emission can reproduce the source
// instead of re-deriving it. WHICH leaves get one is the caller's call
// (`KeyRoles` below), because the answer is policy and not mechanism: Meridian
// keeps normalising the structural fields it owns, and preserves what it did
// not itself write.

/**
 * One scalar as its file wrote it.
 *
 * `value` is what the YAML parses to and is what every reader should use
 * (`rawScalarValue` unwraps one); `source`/`style` exist only so `rawScalarTag`
 * can put the original characters back on the way out.
 *
 * The style field is `style` rather than `type` deliberately. These travel
 * through `inheritance.ts`'s field-agnostic merge, which reads any object
 * carrying a `type` key as a tagged union to merge *into* (`isSumType`) — so a
 * field named `type` here would have two of these quietly merged into a plain
 * object holding neither one's source. `mergeValue` guards the case as well;
 * this just removes the trap rather than relying on the guard alone.
 */
export class RawScalar {
  constructor(
    readonly source: string,
    readonly style:  Scalar.Type | undefined,
    readonly value:  unknown,
  ) {}
}

/** True for a scalar carrying its own source — see `RawScalar`. */
export function isRawScalar(v: unknown): v is RawScalar {
  return v instanceof RawScalar
}

/** The parsed value behind `v`, for readers that don't care how it was written. */
export function rawScalarValue(v: unknown): unknown {
  return isRawScalar(v) ? v.value : v
}

/**
 * The `yaml` custom tag that writes a `RawScalar` back out as itself.
 * `serializeRawNode` registers it; nothing else needs to know it exists.
 */
export const rawScalarTag: ScalarTag = {
  tag: 'tag:meridian.app,2026:raw-scalar',
  // `default: true` is what keeps the tag name *out* of the output: the
  // stringifier only prefixes a value with its tag when that tag is not the
  // default for the value. Nothing ever parses this tag back — it is
  // registered on the write side only — so `resolve` exists to satisfy
  // `ScalarTag` and is unreachable.
  default:  true,
  identify: isRawScalar,
  resolve:  (value: string) => value,
  stringify(item, ctx, onComment, onChompKeep) {
    const raw = item.value as RawScalar
    // A plain scalar's source IS its bytes, and it is the only form the
    // stringifier cannot rebuild from the value — which is exactly the set of
    // losses this exists for (`01234`, `+49…`, `1e3`, an integer past 2⁵³).
    // The parser folds a multi-line plain scalar into a single-line source, so
    // the newline guard is belt-and-braces rather than a live case.
    if ((raw.style === undefined || raw.style === Scalar.PLAIN) && !raw.source.includes('\n')) return raw.source
    // A quoted or block scalar resolves its own syntax away: `"yes"` parses to
    // `yes` and its `source` says `yes` too, so here it is the *style* that has
    // to be reproduced, not the characters. Handing that to the normal string
    // stringifier is also what keeps a block scalar indented for wherever it
    // lands, which raw text could not be.
    const styled = new Scalar(raw.value)
    styled.type = raw.style
    return stringifyString(styled, ctx, onComment, onChompKeep)
  },
}

// ── YAML parser ────────────────────────────────────────────────────────────

/**
 * What one key's value is, and so how much of its formatting survives a save.
 *
 *  - `plain`    — re-emitted from the parsed value: today's behaviour, and
 *                 deliberate for the fields Meridian itself writes.
 *  - `leaf`     — a typed field: preserved when its value is a scalar, so an
 *                 untouched one keeps the form the user wrote. A collection
 *                 (`tags:`, `items:`) falls back to `plain`.
 *  - `opaque`   — a key Meridian has no name for: every scalar anywhere in the
 *                 subtree is preserved, since nothing in it may legitimately
 *                 be reformatted.
 *  - `node` /   — a nested node (`defaults:`) or a list of them (`instances:`);
 *    `nodeList`   recursed into, applying the roles again at each level.
 */
export type KeyRole = 'plain' | 'leaf' | 'opaque' | 'node' | 'nodeList'

/**
 * The role of each key at one node level. The vocabulary this expresses lives
 * in `model/` (`fieldRegistry.ts`'s `yamlKeyRole`), which is why it arrives as
 * a parameter rather than a table here: `fileIO.ts` is a root resident that
 * `model/` imports, so it cannot import the vocabulary back (architecture
 * invariant 1).
 *
 * Defaulting to all-`plain` is what keeps every caller with no opinion —
 * `merge.ts`'s three-way load, the inheritance debugger — on exactly the
 * behaviour it had before any of this existed.
 */
export type KeyRoles = (key: string) => KeyRole

const ALL_PLAIN: KeyRoles = () => 'plain'

type ParsedDoc = Document.Parsed<ParsedNode, true>

/**
 * True when re-emitting `node`'s parsed value on its own would reproduce the
 * characters the file held — i.e. when there is nothing to preserve.
 *
 * This is what keeps `RawScalar` rare. The overwhelming majority of values in
 * real frontmatter are plain strings that spell themselves (`owner: alice`, a
 * URL, a sentence), and boxing those would put a wrapper in front of every
 * reader of `extra` for no gain. Only the values a round trip would actually
 * change get one, so a box in the pipeline always *means* something: this
 * value cannot be rebuilt from what it parsed to.
 *
 * Conservative in the safe direction — it may keep a box that turns out to be
 * unnecessary, but never drops one that was needed:
 *
 *  - A non-plain scalar always boxes: `"yes"` and `yes` share a `source`, so
 *    only the style distinguishes them, and only the style can restore them.
 *  - A plain string boxes unless it is spelled exactly as it reads. `01234`
 *    parses to the *number* 1234, so its value never equals its source and it
 *    boxes; `alice` does, and doesn't.
 *  - Everything else (number, boolean, null) boxes unless `String(value)` is
 *    the source, which keeps `true`/`42`/`null` bare while catching `1.0`,
 *    `0x1F`, `+49…`, `~`, and the empty value after a bare `key:`.
 *
 * `__tests__/scalar-fidelity.test.ts` sweeps this against the real serialiser
 * rather than trusting the reasoning above — if the predicate ever says "safe"
 * about a shape the emitter would in fact rewrite, that sweep fails.
 */
function survivesPlainEmission(node: Scalar): boolean {
  if (node.type !== undefined && node.type !== Scalar.PLAIN) return false
  return typeof node.value === 'string'
    ? node.value === node.source
    : String(node.value) === node.source
}

function authoredScalar(node: Scalar): unknown {
  // No source means the node was synthesised rather than parsed, so there is
  // nothing to preserve and the value speaks for itself.
  if (node.source === undefined || survivesPlainEmission(node)) return node.value
  return new RawScalar(node.source, node.type, node.value)
}

/** Plain parsed JS, remembering nothing — what every key used to yield. */
function toValue(node: unknown, doc: ParsedDoc): unknown {
  // `toJS` rather than `toJSON` so an alias resolves against its own document.
  // Aliases expand to copies, which model/AGENTS.md records as a non-goal.
  return isNode(node) ? node.toJS(doc) : null
}

/** Every scalar in the subtree preserved; collections rebuilt as plain JS. */
function toAuthored(node: unknown, doc: ParsedDoc): unknown {
  if (isScalar(node)) return authoredScalar(node)
  if (isSeq(node))    return node.items.map(item => toAuthored(item, doc))
  if (isMap(node))    return mapEntries(node, () => 'opaque', doc)
  return toValue(node, doc)
}

function byRole(node: unknown, role: KeyRole, roles: KeyRoles, doc: ParsedDoc): unknown {
  switch (role) {
    case 'opaque':   return toAuthored(node, doc)
    case 'leaf':     return isScalar(node) ? authoredScalar(node) : toValue(node, doc)
    case 'node':     return isMap(node) ? mapEntries(node, roles, doc) : toValue(node, doc)
    case 'nodeList': return isSeq(node)
      ? node.items.map(item => (isMap(item) ? mapEntries(item, roles, doc) : toValue(item, doc)))
      : toValue(node, doc)
    case 'plain':    return toValue(node, doc)
  }
}

function mapEntries(node: YAMLMap<unknown, unknown>, roles: KeyRoles, doc: ParsedDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const pair of node.items) {
    const key = String(pair.key)
    out[key] = byRole(pair.value, roles(key), roles, doc)
  }
  return out
}

/**
 * Parse YAML frontmatter to a plain object, `roles` deciding which leaves keep
 * the source they were written with (see `KeyRoles`).
 *
 * Backed by the `yaml` package (YAML 1.2 core schema). Bare dates/times stay
 * strings under the core schema, matching how the rest of the app stores them.
 * Non-mapping documents (a bare scalar or sequence) collapse to `{}` — callers
 * always expect a mapping at the frontmatter root.
 *
 * Built on `parseDocument` rather than `parse` because the source characters
 * exist only on the document's own nodes. `parse` is `parseDocument` + `toJS`
 * and throws on the first error, which the check below reproduces exactly: a
 * duplicate key or a second document has to keep throwing, so that the caller
 * keeps routing such a file to `unreadableFiles` instead of loading half of it.
 */
function yamlParse(text: string, roles: KeyRoles): Record<string, unknown> {
  const doc = parseDocument(text)
  const [firstError] = doc.errors
  if (firstError) throw firstError
  return isMap(doc.contents) ? mapEntries(doc.contents, roles, doc) : {}
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
  roles: KeyRoles = ALL_PLAIN,
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
  const rawNode = fm ? yamlParse(fm, roles) : {}
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
