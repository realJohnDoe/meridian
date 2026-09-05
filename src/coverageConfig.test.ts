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
