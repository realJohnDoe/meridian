import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Keeps GLOSSARY.md honest.
 *
 * The glossary is an index, not an encyclopedia: every entry is one sentence
 * plus a pointer at the authoritative definition in code. That restriction is
 * what makes it checkable — "is this entry still true?" reduces to "does this
 * symbol still resolve?", which is greppable. A rename that misses the
 * glossary fails here instead of silently rotting, which is the failure mode
 * `src/model/AGENTS.md` hit (it documented five functions that no longer
 * existed before this file was added).
 *
 * Pointer syntax, as the last line of an entry:
 *   → `relative/path.ts` · `symbolA`, `symbolB`
 *
 * Paths are relative to src/. Entries with no pointer line (pure
 * disambiguation or prohibition entries) are skipped by the symbol check.
 */

const SRC = path.resolve(__dirname)
const GLOSSARY = path.resolve(__dirname, '../GLOSSARY.md')

interface Pointer {
  term:    string
  file:    string
  symbols: string[]
}

const md = fs.readFileSync(GLOSSARY, 'utf-8')

function parsePointers(text: string): Pointer[] {
  const out: Pointer[] = []
  let term = ''
  let inFence = false
  for (const line of text.split('\n')) {
    // The "How to use" section documents the pointer syntax in a fenced block;
    // without this the example entry is parsed as a real one.
    if (line.trimStart().startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue

    const heading = /^### (.+)$/.exec(line)
    if (heading?.[1]) {
      term = heading[1]
      continue
    }
    const pointer = /^→ `([^`]+)`(?: · (.+))?$/.exec(line.trim())
    if (!pointer?.[1]) continue
    const symbols = [...(pointer[2] ?? '').matchAll(/`([^`]+)`/g)].map(m => m[1]!)
    out.push({ term, file: pointer[1], symbols })
  }
  return out
}

/** Retired names, from the trailing table's left column. */
function parseRetired(text: string): string[] {
  const section = text.split('## Retired names')[1]
  if (!section) return []
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]!)
}

/**
 * Whether `symbol` is *declared* in `source` — a top-level definition, not a
 * mention in a comment or an import. Non-exported declarations count: a
 * glossary entry may legitimately point at a module-private helper (or at a
 * component declared bare and default-exported further down, as AgendaRow is).
 *
 * `default` is optional-but-matched because most view components are written
 * `export default function Foo(` — without it every such component reads as
 * undeclared.
 */
function declares(source: string, symbol: string): boolean {
  const decl = String.raw`^\s*(export\s+)?(default\s+)?(async\s+)?(function|const|let|type|interface|class)\s+${symbol}\b`
  return new RegExp(decl, 'm').test(source)
}

describe('GLOSSARY.md', () => {
  const pointers = parsePointers(md)

  it('parses a plausible number of entries', () => {
    // Guards against the pointer syntax silently changing and every check
    // below vacuously passing on an empty list.
    expect(pointers.length).toBeGreaterThanOrEqual(25)
  })

  it('every entry has at least one symbol', () => {
    const empty = pointers.filter(p => p.symbols.length === 0).map(p => p.term)
    expect(empty, `entries whose pointer names no symbol:\n  ${empty.join('\n  ')}`).toEqual([])
  })

  it('every referenced file exists', () => {
    const missing = pointers
      .filter(p => !fs.existsSync(path.join(SRC, p.file)))
      .map(p => `${p.term} → ${p.file}`)
    expect(missing, `glossary points at files that no longer exist:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('every referenced symbol still resolves', () => {
    const dead: string[] = []
    for (const p of pointers) {
      const full = path.join(SRC, p.file)
      if (!fs.existsSync(full)) continue // reported by the test above
      const source = fs.readFileSync(full, 'utf-8')
      for (const symbol of p.symbols) {
        if (!declares(source, symbol)) dead.push(`${p.term} → ${p.file} · ${symbol}`)
      }
    }
    expect(dead, `glossary names symbols with no definition:\n  ${dead.join('\n  ')}`).toEqual([])
  })

  it('no retired name has come back', () => {
    const retired = parseRetired(md)
    expect(retired.length).toBeGreaterThan(0)

    const sources = collectSources(SRC)
    const resurrected: string[] = []
    for (const name of retired) {
      const hit = sources.find(f => declares(fs.readFileSync(f, 'utf-8'), name))
      if (hit) resurrected.push(`${name} — now defined in ${path.relative(SRC, hit)}`)
    }
    expect(
      resurrected,
      `names listed as retired are defined again; either rename them or drop them from the table:\n  ${resurrected.join('\n  ')}`,
    ).toEqual([])
  })
})

function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...collectSources(full))
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}
