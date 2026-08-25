import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Keeps the flow shell's pane markers axis-explicit.
 *
 * `data-shell-pane` marks a wrapper the flow shell has to release (see
 * hooks/use-shell-mode.ts). The chain of them alternates between row and
 * column flex parents, and the two need opposite treatment: on a column pane
 * the flex sizing *is* the height cap and must be overridden; on a row pane it
 * sizes the width and must be left alone. A rule that overrides flex on a row
 * pane pins it to its content width, and since the flow shell no longer clips,
 * the app column then ends short of the screen edge with the backdrop beside
 * it — the exact bug this file exists to prevent coming back.
 *
 * The fixed shell hides that class of mistake completely (overflow:hidden
 * clips it away), so it cannot be caught by looking at the default routes, and
 * jsdom has no layout engine to catch it in a render test. Asserting the
 * marker discipline at the source level is what is actually checkable.
 */

const SRC = path.resolve(__dirname)
const CSS = path.join(SRC, 'index.css')

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return tsxFiles(p)
    return e.isFile() && p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : []
  })
}

describe('flow-shell pane markers', () => {
  it('gives every data-shell-pane an explicit row/col axis', () => {
    const bare: string[] = []
    for (const file of tsxFiles(SRC)) {
      const src = fs.readFileSync(file, 'utf-8')
      for (const [i, line] of src.split('\n').entries()) {
        if (!line.includes('data-shell-pane')) continue
        if (/data-shell-pane=("|\{')(row|col)\1?"?/.test(line)) continue
        if (/data-shell-pane="(row|col)"/.test(line)) continue
        bare.push(`${path.relative(SRC, file)}:${i + 1}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('never styles data-shell-pane without qualifying the axis', () => {
    const css = fs.readFileSync(CSS, 'utf-8')
    // A selector like `[data-shell-pane]` with no ="row"/="col" would apply one
    // set of overrides to both axes — the original bug.
    const blanket = css
      .split('\n')
      .map((line, i) => [line, i + 1] as const)
      .filter(([line]) => /\[data-shell-pane\]/.test(line))
      .map(([, n]) => `index.css:${n}`)
    expect(blanket).toEqual([])
  })

  it('styles both axes, so neither is silently unhandled', () => {
    const css = fs.readFileSync(CSS, 'utf-8')
    expect(css).toMatch(/\[data-shell-pane="row"\]/)
    expect(css).toMatch(/\[data-shell-pane="col"\]/)
  })
})
