// ── ICS (RFC 5545) tokenizer ─────────────────────────────────────────────────
// Pure text → component tree. No Meridian concepts appear here; mapping an ICS
// component onto an entry is `icsToEntries.ts`'s job, and turning an RRULE into
// a `Repeat` is `rruleToRepeat.ts`'s.
//
// Hand-rolled rather than taken from a dependency, matching how the repo already
// hand-rolls its YAML round-trip semantics: `ical.js` is large for what is used
// here, and `node-ical` is Node-only.

/** One `NAME;PARAM=value:VALUE` content line. */
export interface IcsProperty {
  /** Upper-cased, e.g. `DTSTART`. */
  name: string
  /**
   * Upper-cased parameter names to their values. Multi-valued parameters
   * (`MEMBER="a","b"`) keep every value; the common case is a single one.
   */
  params: Record<string, string[]>
  /**
   * The value exactly as it appeared, still escaped. TEXT-typed values must go
   * through `unescapeText`; structured ones (DTSTART, RRULE, …) must not — the
   * `\` in a date-time is a syntax error, not an escape, and unescaping first
   * would quietly mangle a malformed feed instead of failing on it.
   */
  value: string
}

export interface IcsComponent {
  /** Upper-cased, e.g. `VEVENT`. */
  name: string
  props: IcsProperty[]
  children: IcsComponent[]
}

/**
 * Undo RFC 5545 line folding.
 *
 * A folded line is a line break followed by exactly one space or tab; the
 * whitespace is part of the fold, not of the value. Encoders fold at 75 octets,
 * which can land mid-word, so unfolding has to splice with no separator at all.
 *
 * All three line endings are accepted. CRLF is what the spec requires, but
 * bare-LF feeds are common enough in the wild (and produced by several
 * self-hosted servers) that rejecting them would be rejecting real calendars.
 */
export function unfoldLines(text: string): string[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const out: string[] = []
  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out.filter(l => l.length > 0)
}

/**
 * Split on separators that are not backslash-escaped.
 *
 * Used for both multi-value TEXT properties (`CATEGORIES:a,b`) and parameter
 * lists. A quoted parameter value may legally contain the separator, so
 * `respectQuotes` suspends splitting inside `"…"`.
 */
function splitUnescaped(value: string, separator: string, respectQuotes = false): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) {
      current += ch + value[i + 1]
      i++
      continue
    }
    if (respectQuotes && ch === '"') { quoted = !quoted; current += ch; continue }
    if (ch === separator && !quoted) { out.push(current); current = ''; continue }
    current += ch ?? ''
  }
  out.push(current)
  return out
}

/** Split a multi-value TEXT/date property value (`EXDATE:a,b`) on unescaped commas. */
export function splitList(value: string): string[] {
  return splitUnescaped(value, ',').map(v => v.trim()).filter(v => v.length > 0)
}

/**
 * Decode a TEXT value: `\n`/`\N` are newlines, and `\,` `\;` `\\` are the
 * literal characters. Applied only where the property is TEXT-typed — see
 * `IcsProperty.value`.
 */
export function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch !== '\\') { out += ch ?? ''; continue }
    const next = value[++i]
    if (next === undefined) break // trailing backslash: drop it rather than emit it
    if (next === 'n' || next === 'N') out += '\n'
    else out += next
  }
  return out
}

/** Strip the optional surrounding quotes from a parameter value. */
function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value
}

/**
 * Parse one unfolded content line, or `null` if it has no `:` at all (a
 * truncated final line, or junk the encoder emitted).
 *
 * The name/params section ends at the first colon that is not inside a quoted
 * parameter value — quoting exists precisely so a parameter can contain one,
 * which `ALTREP="http://x/y"` does routinely.
 */
export function parseContentLine(line: string): IcsProperty | null {
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ':' && !quoted) { colon = i; break }
  }
  if (colon === -1) return null

  const head  = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [rawName, ...rawParams] = splitUnescaped(head, ';', true)
  const name = (rawName ?? '').trim().toUpperCase()
  if (name.length === 0) return null

  const params: Record<string, string[]> = {}
  for (const raw of rawParams) {
    const eq = raw.indexOf('=')
    if (eq === -1) continue
    const key = raw.slice(0, eq).trim().toUpperCase()
    if (key.length === 0) continue
    params[key] = splitUnescaped(raw.slice(eq + 1), ',', true).map(unquote)
  }
  return { name, params, value }
}

/**
 * Parse a whole `.ics` document into its VCALENDAR component, or `null` when
 * the text is not a calendar at all — which is the common failure the user
 * actually hits: a URL that serves an HTML sign-in page instead of a feed.
 *
 * A truncated document (BEGIN with no matching END, a feed cut off mid-transfer)
 * yields everything parsed up to the cut rather than nothing. Half a calendar is
 * strictly better than none: the events before the truncation are complete and
 * correct, and the alternative is an empty vault with no explanation.
 */
export function parseIcs(text: string): IcsComponent | null {
  const root: IcsComponent = { name: 'VCALENDAR', props: [], children: [] }
  const stack: IcsComponent[] = []
  let sawCalendar = false

  for (const line of unfoldLines(text)) {
    const prop = parseContentLine(line)
    if (!prop) continue

    if (prop.name === 'BEGIN') {
      const name = prop.value.trim().toUpperCase()
      if (name === 'VCALENDAR' && stack.length === 0) { sawCalendar = true; stack.push(root); continue }
      const child: IcsComponent = { name, props: [], children: [] }
      ;(stack[stack.length - 1] ?? root).children.push(child)
      stack.push(child)
      continue
    }
    if (prop.name === 'END') {
      // Pop unconditionally rather than matching names: a feed with a stray or
      // mismatched END is malformed either way, and staying inside the
      // component would silently attach every following event to it.
      stack.pop()
      continue
    }
    ;(stack[stack.length - 1] ?? root).props.push(prop)
  }

  return sawCalendar ? root : null
}

// ── Lookup helpers ───────────────────────────────────────────────────────────

/** Every property with this name, in document order. */
export function props(component: IcsComponent, name: string): IcsProperty[] {
  return component.props.filter(p => p.name === name.toUpperCase())
}

/** The first property with this name, or undefined. */
export function prop(component: IcsComponent, name: string): IcsProperty | undefined {
  return component.props.find(p => p.name === name.toUpperCase())
}

/** The first property's raw value, or undefined. */
export function propValue(component: IcsComponent, name: string): string | undefined {
  return prop(component, name)?.value
}

/** The first property's value decoded as TEXT, or undefined. */
export function textValue(component: IcsComponent, name: string): string | undefined {
  const raw = propValue(component, name)
  return raw === undefined ? undefined : unescapeText(raw)
}

/** A property's first value for `name`, or undefined. */
export function param(property: IcsProperty, name: string): string | undefined {
  return property.params[name.toUpperCase()]?.[0]
}

/**
 * Every component of this name anywhere in the tree.
 *
 * Recursive because VEVENTs are children of VCALENDAR but a search for VALARM
 * has to reach inside them — and because some exporters nest components a level
 * deeper than the spec suggests.
 */
export function components(root: IcsComponent, name: string): IcsComponent[] {
  const want = name.toUpperCase()
  const out: IcsComponent[] = []
  const walk = (c: IcsComponent) => {
    for (const child of c.children) {
      if (child.name === want) out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

/** The calendar's display name, from `X-WR-CALNAME` — what most providers set. */
export function calendarName(root: IcsComponent): string | undefined {
  const name = textValue(root, 'X-WR-CALNAME')?.trim()
  return name && name.length > 0 ? name : undefined
}
