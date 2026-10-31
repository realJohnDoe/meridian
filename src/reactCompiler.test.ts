import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { transformSync } from '@babel/core'
import { reactCompilerPreset } from '@vitejs/plugin-react'

/**
 * babel-plugin-react-compiler silently leaves a component/hook unmemoized when
 * it meets an exhaustive-deps suppression, a destructured default, or a
 * try/finally; build, lint and tests don't notice. This census runs the same
 * preset vite.config.ts uses over first-party source and pins the files that
 * bail out to the documented `useVirtualizer` (incompatible-library) skips.
 */

const SRC = __dirname
const ALLOWED = new Set([
  'calendar/AgendaView.tsx',
  'calendar/OccurrenceList.tsx',
  'search/FileResultsList.tsx',
])

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return ['test-utils', 'debug', 'ui'].includes(e.name) ? [] : sourceFiles(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.gen.ts') ? [p] : []
  })
}

describe('React Compiler census', () => {
  it('only the documented useVirtualizer files fail to compile', () => {
    const failed = new Set<string>()
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      const logger = {
        logEvent(_f: string | null, event: { kind: string }) {
          if (event.kind === 'CompileError') failed.add(rel)
        },
      }
      transformSync(fs.readFileSync(file, 'utf8'), {
        filename: file,
        configFile: false,
        babelrc: false,
        presets: [reactCompilerPreset({ target: '19', logger }).preset],
        parserOpts: { plugins: ['jsx', 'typescript'] },
      })
    }
    expect([...failed].sort()).toEqual([...ALLOWED].sort())
  }, 120_000)
})
