import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards against `:root` and `.meridian` (src/index.css) drifting apart.
 *
 * `.meridian` is a verbatim class-scoped restatement of `:root`'s Meridian
 * tokens (needed so a meridian-scoped element renders correctly even while
 * another theme's class is active on <html>). Nothing in the toolchain
 * enforces that the two copies agree — this test parses both custom-property
 * blocks and asserts every token declared in both has the same value, so an
 * edit to one that forgets the other fails here instead of shipping a
 * theme-preview swatch that disagrees with the theme it previews.
 */

const CSS = fs.readFileSync(path.resolve(__dirname, 'index.css'), 'utf-8')

function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector "${selector}" not found in index.css`)
  const openBrace = css.indexOf('{', start)
  const closeBrace = css.indexOf('\n}', openBrace)
  if (closeBrace === -1) throw new Error(`no closing brace found for "${selector}"`)
  return css.slice(openBrace + 1, closeBrace)
}

function parseTokens(block: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const line of block.split('\n')) {
    const m = /^\s*(--[\w-]+):\s*(.+?);\s*(?:\/\*.*\*\/\s*)?$/.exec(line)
    if (m) tokens.set(m[1]!, m[2]!.trim())
  }
  return tokens
}

describe(':root / .meridian token parity', () => {
  const rootTokens = parseTokens(extractBlock(CSS, ':root'))
  const meridianTokens = parseTokens(extractBlock(CSS, '.meridian'))

  it('parses a non-trivial number of tokens from both blocks', () => {
    expect(rootTokens.size).toBeGreaterThan(40)
    expect(meridianTokens.size).toBeGreaterThan(40)
  })

  it('agrees on the value of every token declared in both blocks', () => {
    const mismatches: string[] = []
    for (const [name, meridianValue] of meridianTokens) {
      const rootValue = rootTokens.get(name)
      if (rootValue !== undefined && rootValue !== meridianValue) {
        mismatches.push(`${name}: :root="${rootValue}" vs .meridian="${meridianValue}"`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('has no token in .meridian that :root does not also declare', () => {
    const meridianOnly = [...meridianTokens.keys()].filter(name => !rootTokens.has(name))
    expect(meridianOnly).toEqual([])
  })
})
