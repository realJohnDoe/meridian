import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vitestConfig from '../vitest.config'

/**
 * Guards against the failure mode health-ui-results.md finding #7 found:
 * `vitest.config.ts`'s per-file coverage thresholds are keyed by literal
 * path, and a moved/renamed file leaves its key silently inert (v8's
 * coverage provider skips unresolvable threshold keys with no warning and
 * exit code 0) rather than failing loudly. Modeled on glossary.test.ts,
 * which catches the same class of rot for GLOSSARY.md's pointers.
 */

const ROOT = path.resolve(__dirname, '..')
const NON_PATH_KEYS = new Set(['statements', 'branches', 'functions', 'lines'])

describe('vitest.config.ts coverage thresholds', () => {
  it('every per-file threshold key resolves to an existing file', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds ?? {}
    const keys = Object.keys(thresholds).filter(k => !NON_PATH_KEYS.has(k))
    expect(keys.length).toBeGreaterThan(0)

    const missing = keys.filter(k => !fs.existsSync(path.join(ROOT, k)))
    expect(missing, `threshold keys pointing at files that no longer exist:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})

/**
 * Guards the other half of the same config, which nothing watched before:
 * the coverage `exclude` list. A threshold key that stops resolving fails
 * open (above); an exclusion glob fails open in the opposite direction — it
 * keeps matching, and silently swallows whatever grows underneath it.
 *
 * The `src/routes/` exclusions are justified in the config by one specific
 * claim: those files "wire a component to a path and little else". That claim
 * is checkable. It had already been broken twice — first by an `_app*` glob
 * that swallowed the 569-line `_app.tsx` (health-ui-results.md finding #6),
 * then by an `_entry*.tsx` glob that swallowed `_entry.entry.$vault.$slug.tsx`
 * (134 lines of URL→occurrence resolution, at 0% coverage and invisible) and
 * `_entry.entry.new.tsx` (124 lines of draft-resume logic). Both were fixed by
 * listing the real registration files individually; this stops the third one.
 *
 * Only `src/routes/` is checked. `src/components/ui/**` is excluded on
 * authorship (files the shadcn CLI wrote), not on size, so a large file there
 * is exactly what the exclusion is for.
 */
describe('vitest.config.ts coverage exclusions', () => {
  it('every excluded src/routes/ file is small enough to be registration', () => {
    const MAX_LINES = 100
    const exclude = vitestConfig.test?.coverage?.exclude ?? []
    const patterns = exclude.filter(p => p.startsWith('src/routes/'))
    expect(patterns.length).toBeGreaterThan(0)

    const oversized = patterns
      .flatMap(p => fs.globSync(p, { cwd: ROOT }))
      .map(rel => [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length] as const)
      .filter(([, lines]) => lines > MAX_LINES)
      .map(([rel, lines]) => `${rel} (${String(lines)} lines)`)

    expect(
      oversized,
      `excluded from coverage but too big to be route registration — either it is\n` +
      `logic that belongs in the report, or the exclusion needs a different reason:\n  ` +
      oversized.join('\n  '),
    ).toEqual([])
  })
})
