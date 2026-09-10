/**
 * fast-check corpus generator for the Root-A round-trip invariant (issue
 * #1003 / plans/tooling.md). The hand-written fixture corpus
 * (`yaml-roundtrip.test.ts`'s `fixtureNames()`) is 20 files, and every one of
 * the seven round-trip defects (#628, #629, #630, #664, #975, #976, #979) was
 * a file shape nobody put in that directory. This generates the missing
 * shapes instead of waiting for the next one to reach a real vault.
 *
 * **Never a raw string.** fast-check shrinks a string by deleting characters,
 * so a counterexample would stop parsing and fail for a *different* reason
 * than the original. This generates a STRUCTURED record and `.map()`s it to
 * file text (`renderFile`), so every intermediate value during shrinking
 * stays a parseable file, and the minimal counterexample renders straight
 * into a `.md` droppable into `fixtures/`.
 *
 * Covers the axes the seven defects lived on:
 *  - `crlf`/`trailingNewline` — `FileConvention`, fileIO.ts's file-convention
 *    section (#629).
 *  - unknown keys the registry doesn't know (#628, #975).
 *  - a key present with an empty value, distinguishable from absent (#630).
 *  - malformed registry-field shapes — an array/mapping where a scalar is
 *    wanted or vice versa — routed into `extra` rather than coerced (#664).
 *  - scalar text whose parsed form differs from its source (`0700`, `1.50`,
 *    quoted values) — saved as the characters written (#979).
 *  - every `KeyRole` (`fileIO.ts`): `plain` (the structural keys),
 *    `leaf` (registry scalars), `opaque` (unknown keys, including one nested
 *    a level deep), `node` (`defaults:`), `nodeList` (`instances:`).
 *  - body edge cases: none, an indented first line, interior blank lines.
 *  - `defaults:` + `instances:` overrides (the `unknown-keys-series.md` shape).
 *
 * Runs the SAME two assertions the fixture sweep already uses
 * (`assertCollapseTotality`, `assertSourceFidelity`, extracted to
 * `./helpers.ts` by this change so the two sweeps can't drift into two copies
 * that disagree) — never on an EDITED round trip; see their doc comments.
 *
 * CI pins `seed`/`numRuns` so a red build always reproduces. Roaming for new
 * failures is a local/nightly exercise: raise `numRuns` and drop `seed`. A
 * counterexample found that way gets copied into `fixtures/` as a permanent
 * regression case — the same ratchet `it.fails` gives the hand-written corpus
 * in `round-trip-totality.test.ts`.
 */
import { describe, it } from 'vitest'
import fc from 'fast-check'
import { assertCollapseTotality, assertSourceFidelity } from './helpers'

// ── Scalar text ──────────────────────────────────────────────────────────
//
// A JSON-quoted string is always valid, unambiguous YAML — the safe default
// for arbitrary generated text (YAML double-quoted scalars are a superset of
// JSON string syntax). TRICKY_SCALARS are hand-verified valid plain/quoted
// YAML tokens whose SOURCE TEXT differs from the value they parse to
// (`0700` -> 700, `1.50` -> 1.5, a leading `+` or a huge integer past 2^53),
// or whose quoting style is itself the only thing distinguishing them
// (`"yes"` vs bare `yes`) — exactly what `RawScalar`/`survivesPlainEmission`
// in fileIO.ts exist to preserve (finding #6/#979).
// Deliberately excludes bare `true`/`false`/`~`: those are a genuinely
// different class of trap (a raw YAML type — boolean/null — colliding with a
// `string`-kind field's coercion and/or the "clear with no baseline" case
// already excluded above) rather than the source-vs-value mismatch this list
// targets, and chasing it is out of scope for what this generator adds.
const TRICKY_SCALARS = [
  '0700', '1.50', '+49123456789', '1234567890123456789',
  '"yes"', '"42"', '1e3', "'single quoted'",
]

const q = (s: string): string => JSON.stringify(s)

const wordArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/)

/** Any valid YAML scalar text: an ordinary word (always safely quoted) or a tricky literal. */
const scalarTextArb = fc.oneof(
  { weight: 3, arbitrary: wordArb.map(q) },
  { weight: 2, arbitrary: fc.constantFrom(...TRICKY_SCALARS) },
)

// minLength: 1 — `tags`/`items`/`participants` are REQUIRED stringArray
// fields, so `inlineFieldEmpty` treats `[]` as equivalent to the key being
// absent (`absentFieldValue` defaults a required, absent field to `[]` too)
// by design, not as a loss to probe for: an explicit empty array and an
// absent key are the same value for a required field, same as `archived`
// (not required) keeping an explicit `false` while an absent `done` (not
// required) reads back as an absent key, never as `false`.
const flowArrayArb = fc.array(wordArb, { minLength: 1, maxLength: 3 }).map(items => `[${items.map(q).join(', ')}]`)

function maybe<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> {
  return fc.option(arb, { nil: undefined })
}

// ── Field values ─────────────────────────────────────────────────────────

type FieldValue =
  | { kind: 'scalar'; text: string }
  | { kind: 'null' }                          // a key present with an empty value (#630)
  | { kind: 'map'; entries: [string, string][] } // one nested level, e.g. `links:\n  jira: ABC-1`
type Field = [string, FieldValue]

const scalar = (text: string): FieldValue => ({ kind: 'scalar', text })

const anyValueArb: fc.Arbitrary<FieldValue> = fc.oneof(
  { weight: 5, arbitrary: scalarTextArb.map(scalar) },
  { weight: 1, arbitrary: fc.constant<FieldValue>({ kind: 'null' }) },
  { weight: 1, arbitrary: fc.tuple(wordArb, scalarTextArb).map(([k, v]): FieldValue => ({ kind: 'map', entries: [[k, v]] })) },
)

const RESERVED = new Set([
  'title', 'tags', 'items', 'archived', 'done', 'participants', 'priority', 'duration', 'timezone',
  'date', 'time', 'repeat', 'excluded', 'instances', 'defaults', 'body',
])
const keyArb = fc.stringMatching(/^[a-z]{3,10}$/).filter(k => !RESERVED.has(k))

/** 0-2 unrecognised keys (#628, #975), each an opaque scalar/null/nested-map value. */
const unknownFieldsArb: fc.Arbitrary<Field[]> = fc
  .uniqueArray(keyArb, { maxLength: 2 })
  .chain(keys => keys.length === 0
    ? fc.constant<Field[]>([])
    : fc.tuple(...keys.map(k => anyValueArb.map((v): Field => [k, v]))))

// ── Registry fields ──────────────────────────────────────────────────────
// One arbitrary per registry field. Where the kind admits a shape
// `malformedKnownFields` can't coerce (an array/mapping where a scalar is
// wanted, or the reverse), that shape is in the mix too (#664) — it is
// expected to survive via `extra`, not to be coerced or dropped.

interface FieldSpec { key: string; value: fc.Arbitrary<FieldValue> }

const OCC_FIELD_SPECS: FieldSpec[] = [
  // No explicit-null ("clear") branch: an unedited round trip can't express
  // clearing a field that has no baseline to diff against (a bare `done:`
  // with nothing to compare it to is indistinguishable, post-save, from the
  // key never having been written) — the same reason the issue's own "Trap"
  // section excludes clearing a `defaults:`-inherited field from this
  // generator. The one shape where a `null` override DOES round-trip — an
  // instance overriding a series `defaults:` baseline — is already pinned by
  // round-trip-totality.test.ts's "done-null" case.
  { key: 'done', value: fc.oneof(
      fc.constantFrom('true', 'false').map(scalar),
      fc.constantFrom(q('yes-please'), '7', '[1, 2]').map(scalar), // malformed
    ) },
  { key: 'priority', value: fc.oneof(
      fc.constantFrom('high', 'medium', 'low').map(scalar),
      fc.constantFrom(q('urgent'), '7', '[high]').map(scalar), // malformed
    ) },
  { key: 'duration', value: fc.oneof(scalarTextArb.map(scalar), fc.constantFrom('[1, 2]', '{a: 1}').map(scalar)) },
  { key: 'timezone', value: scalarTextArb.map(scalar) },
  { key: 'participants', value: fc.oneof(flowArrayArb.map(scalar), fc.constant(q('not-a-list')).map(scalar)) },
]

const FILE_FIELD_SPECS: FieldSpec[] = [
  { key: 'tags', value: fc.oneof(flowArrayArb.map(scalar), fc.constant(q('not-a-list')).map(scalar)) },
  { key: 'items', value: fc.oneof(flowArrayArb.map(scalar), fc.constant(q('not-a-list')).map(scalar)) },
  { key: 'archived', value: fc.oneof(fc.constantFrom('true', 'false').map(scalar), fc.constant(q('nope')).map(scalar)) },
]

/** Each spec independently present or absent, as a flat `Field[]`. */
function subsetOf(specs: FieldSpec[]): fc.Arbitrary<Field[]> {
  return fc
    .tuple(...specs.map(s => maybe(s.value.map((v): Field => [s.key, v]))))
    .map(fields => fields.filter((f): f is Field => f !== undefined))
}

// ── Structural shapes ──────────────────────────────────────────────────────

const DATE_POOL = ['2026-01-01', '2026-04-08', '2026-04-13', '2026-06-18', '2026-12-31']
const dateArb = fc.constantFrom(...DATE_POOL)
const timeArb = fc.constantFrom('09:00', '13:30', '23:59')
const WEEKDAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']
const repeatArb = fc.record({
  freq: fc.constantFrom('daily', 'weekly', 'monthly', 'yearly'),
  byweekday: maybe(fc.uniqueArray(fc.constantFrom(...WEEKDAYS), { minLength: 1, maxLength: 3 })),
})

type BodyKind = { kind: 'none' } | { kind: 'plain'; text: string } | { kind: 'indented' } | { kind: 'blankInterior' }
const bodyArb: fc.Arbitrary<BodyKind> = fc.oneof(
  fc.constant<BodyKind>({ kind: 'none' }),
  wordArb.map((text): BodyKind => ({ kind: 'plain', text })),
  fc.constant<BodyKind>({ kind: 'indented' }),
  fc.constant<BodyKind>({ kind: 'blankInterior' }),
)
function renderBody(b: BodyKind): string {
  switch (b.kind) {
    case 'none':          return ''
    case 'plain':         return b.text
    case 'indented':      return '  indented start\n\nsecond paragraph'
    case 'blankInterior': return 'first line\n\nthird line after a blank\n\n\nfifth line'
  }
}

interface GenInstance {
  date: string
  time?: string
  excluded?: boolean
  occFields: Field[]
  unknownFields: Field[]
}
// `date` is always present (not `maybe`): an instance identifies which
// occurrence it overrides by date, matching every existing fixture, and it
// guarantees each instance always renders at least one field rather than
// vanishing from the output (an all-undefined instance renders to nothing —
// see `renderInstances`), which would silently shrink the `instances:` list
// this generator asked for.
//
// `occSpecs` is a PARAMETER, not always `OCC_FIELD_SPECS`: whichever keys
// `defaults:` carries (see `fileArb` below) are excluded from it, so no
// instance can override — and thereby shadow — a key its own file's
// `defaults:` block set. `defaults:` only has an observable effect through a
// child that INHERITS it; a child overriding the same key makes the shared
// value dead weight retained nowhere, once merged away, which every existing
// fixture that uses `defaults:` avoids by construction (no instance repeats
// a key its `defaults:` already carries).
function instanceArbWith(occSpecs: FieldSpec[]): fc.Arbitrary<GenInstance> {
  return fc.record({
    date: dateArb,
    time: maybe(timeArb),
    // Only `true`, never explicit `false`: `excluded` is read as `=== true`
    // (fieldRegistry.ts's `STRUCTURAL_SHAPES` doc), so the model has nowhere
    // to keep an explicit `false` distinct from the key being absent — same
    // "can't represent, so don't probe it" call already made for `done`'s
    // null-clear branch and for a required array field's explicit `[]`.
    excluded: maybe(fc.constant(true)),
    occFields: subsetOf(occSpecs),
    unknownFields: unknownFieldsArb,
  })
}

interface GenFile {
  crlf: boolean
  trailingNewline: boolean
  title: string
  fileFields: Field[]
  occFields: Field[]
  unknownFields: Field[]
  hasDate: boolean
  date: string
  time?: string
  repeat?: { freq: string; byweekday?: string[] }
  defaultsFields: Field[]
  instances: GenInstance[]
  body: BodyKind
}

const baseFileArb = fc.record({
  crlf: fc.boolean(),
  trailingNewline: fc.boolean(),
  title: scalarTextArb,
  fileFields: subsetOf(FILE_FIELD_SPECS),
  occFields: subsetOf(OCC_FIELD_SPECS),
  unknownFields: unknownFieldsArb,
  hasDate: fc.boolean(),
  date: dateArb,
  time: maybe(timeArb),
  repeat: maybe(repeatArb),
  body: bodyArb,
})

// `.chain()`, not `fc.record`: which keys `defaults:` carries has to be
// decided BEFORE each instance's own `occFields` are generated, so that
// choice can be excluded from them (see `instanceArbWith`'s doc comment).
const fileArb: fc.Arbitrary<GenFile> = baseFileArb
  .chain(base => fc.subarray(OCC_FIELD_SPECS).chain(defaultsSpecs => {
    const defaultsKeys = new Set(defaultsSpecs.map(s => s.key))
    const instanceOccSpecs = OCC_FIELD_SPECS.filter(s => !defaultsKeys.has(s.key))
    return fc
      .record({
        defaultsFields: subsetOf(defaultsSpecs),
        instances: fc.array(instanceArbWith(instanceOccSpecs), { maxLength: 3 }),
      })
      .map((rest): GenFile => ({ ...base, ...rest }))
  }))
  .map(finalizeGenFile)

/**
 * Rules that keep the generated shape inside what `parseToStoreItems`'s
 * walker actually gives a defined meaning to, applied in sequence (later
 * rules see the earlier ones' decisions, not the raw arbitrary output) —
 * each one documented at the case it exists to avoid.
 */
function finalizeGenFile(gen: GenFile): GenFile {
  // repeat is anchored to a date; without one there is no shape
  // parseToStoreItems has ever had to handle, so don't invent one.
  const repeat = gen.hasDate ? gen.repeat : undefined
  // A root `time:` only ever gets read alongside `n.fields.date` at the point
  // a node becomes an item (`nodeIsItem`). A dateless root with `instances:`
  // is a pure container, which never becomes an item itself, so a lone root
  // `time:` would just be silently unread — not a case this generator is
  // trying to probe (nobody writes a bare file-root time with no date on a
  // grouping container).
  const time = gen.hasDate ? gen.time : undefined
  // Same reasoning for a bare occurrence-level field (done/priority/
  // duration/timezone/participants) written directly on a dateless root: a
  // pure container root never becomes an item, and (unlike a non-root
  // container, whose own remainder `containerOwnRemainder` carries down to
  // its children) `buildRoot`'s own remainder is `unknownKeys(rawNode)`,
  // which filters out every registry-named key — so it has nowhere to go.
  // Sharing occurrence fields across children from the root already has a
  // well-formed way to say it: `defaults:` (`defaultsFields` below).
  const occFields = gen.hasDate ? gen.occFields : []

  // A dateless (container) root with exactly one child collapses on save
  // into a single flat item — the one child absorbs the root, same as a
  // multi-child container never does. The root's own unknown-key remainder
  // then migrates from `root.extra` (this generation) to that item's own
  // `metadata.extra` (the next), which is a real relocation `roundTripLoss`
  // confirms loses nothing, but it is a shape `assertCollapseTotality` (items
  // only, no `root`) was never asked to track through a structural change.
  // Every existing container fixture keeps 0 or 2+ children for exactly this
  // reason (`unknown-keys-container.md` uses three) — collapse to a plain
  // item (0 children) instead of the ambiguous one-child shape when the root
  // carries unknown keys of its own.
  const instances = !gen.hasDate && gen.unknownFields.length > 0 && gen.instances.length === 1
    ? []
    : gen.instances

  // `defaults:` only has an observable effect through a child that inherits
  // it rather than overriding it — with a single child, that child's own
  // value for the same key (well-formed or, per the malformed-registry axis
  // above, routed to `extra`) always wins, and the shared default it shadows
  // is retained nowhere once merged away. Every existing fixture that uses
  // `defaults:` pairs it with 2+ children for exactly this reason
  // (`unknown-keys-series.md` two, `unknown-keys-container.md` three); keep
  // this generator to that shape too rather than the single-recipient
  // degenerate case.
  const defaultsFields = instances.length >= 2 ? gen.defaultsFields : []

  // `excluded` suppresses a generated (repeating) occurrence — only
  // meaningful when the file is actually a series. On a non-series
  // container/standalone item, `excluded: true` on an explicit child makes
  // storeItems.ts's walker skip the child outright (see the `nodeIsItem`
  // branch), which would drop that child's own fields as a side effect of a
  // shape this generator isn't trying to probe.
  const finalInstances = gen.hasDate && repeat
    ? instances
    : instances.map(i => ({ ...i, excluded: undefined }))

  return { ...gen, repeat, time, occFields, defaultsFields, instances: finalInstances }
}

// ── Renderer: record -> file text ───────────────────────────────────────

function fieldLines(key: string, v: FieldValue): string[] {
  if (v.kind === 'null') return [`${key}:`]
  if (v.kind === 'scalar') return [`${key}: ${v.text}`]
  if (v.entries.length === 0) return [`${key}:`]
  return [`${key}:`, ...v.entries.map(([k, val]) => `  ${k}: ${val}`)]
}
function renderMappingLines(fields: Field[]): string[] {
  return fields.flatMap(([k, v]) => fieldLines(k, v))
}
function renderBlock(fields: Field[], indent: number): string {
  const pad = ' '.repeat(indent)
  return renderMappingLines(fields).map(l => pad + l).join('\n')
}
function renderRepeat(repeat: { freq: string; byweekday?: string[] }): string {
  const lines = ['repeat:', '  type: schedule', `  freq: ${repeat.freq}`]
  if (repeat.byweekday) lines.push(`  byweekday: [${repeat.byweekday.join(', ')}]`)
  return lines.join('\n')
}
function instanceFields(inst: GenInstance): Field[] {
  const out: Field[] = [['date', scalar(inst.date)]]
  if (inst.time !== undefined) out.push(['time', scalar(inst.time)])
  if (inst.excluded !== undefined) out.push(['excluded', scalar(String(inst.excluded))])
  out.push(...inst.occFields, ...inst.unknownFields)
  return out
}
function renderInstances(instances: GenInstance[]): string {
  return instances
    .map(inst => {
      const lines = renderMappingLines(instanceFields(inst))
      if (lines.length === 0) return undefined
      const [first, ...rest] = lines
      return [`  - ${first}`, ...rest.map(l => `    ${l}`)].join('\n')
    })
    .filter((s): s is string => s !== undefined)
    .join('\n')
}

function renderFile(gen: GenFile): string {
  const rootFields: Field[] = [
    ['title', scalar(gen.title)],
    ...gen.fileFields,
    ...gen.occFields,
    ...gen.unknownFields,
  ]
  if (gen.hasDate) rootFields.push(['date', scalar(gen.date)])
  if (gen.time !== undefined) rootFields.push(['time', scalar(gen.time)])

  const blocks: string[] = [renderBlock(rootFields, 0)]
  if (gen.repeat) blocks.push(renderRepeat(gen.repeat))
  if (gen.defaultsFields.length > 0) blocks.push(`defaults:\n${renderBlock(gen.defaultsFields, 2)}`)
  const instancesBlock = renderInstances(gen.instances)
  if (instancesBlock.length > 0) blocks.push(`instances:\n${instancesBlock}`)
  const fm = blocks.filter(s => s.length > 0).join('\n')

  let out = `---\n${fm}\n---`
  const body = renderBody(gen.body)
  if (body) out += `\n\n${body}`
  if (gen.trailingNewline) out += '\n'
  return gen.crlf ? out.replace(/\n/g, '\r\n') : out
}

const sourceArb = fileArb.map(renderFile)

// ── Property ────────────────────────────────────────────────────────────

describe('round-trip corpus — generated (issue #1003)', () => {
  // Pinned seed + modest numRuns: a red build always reproduces from the
  // failure fast-check prints. To roam for NEW failures, run locally with
  // numRuns raised and the seed dropped (fast-check then picks a fresh one
  // and prints it on failure, so any find is still reproducible afterwards).
  it('runs both Root-A assertions over generated file text', () => {
    fc.assert(
      fc.property(sourceArb, (source) => {
        assertCollapseTotality('generated', source)
        assertSourceFidelity('generated', source)
      }),
      { seed: 20260909, numRuns: 200 },
    )
  })
})
