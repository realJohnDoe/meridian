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

/**
 * Guards against the failure mode #1039 found: a per-file threshold only
 * fails CI once measured coverage drops *below* it, so nothing stops the gap
 * between the two from growing in the other direction — every test added
 * without a matching floor bump widens the slack, until the floor is no
 * longer guarding anything. 25 of 57 per-file floors (plus all 4 globals) had
 * drifted ≥10 points below measured before this guard existed; `store.ts` was
 * the worst, at 21.1 points of slack. `plans/surveys/health.md`'s Budget calls
 * a floor more than ~10 points under "guarding nothing" — this test makes
 * that threshold machine-checked instead of something only a periodic survey
 * catches.
 *
 * `coverage-summary.json` is a separate reporter output (`json-summary`,
 * enabled above), written only once the full coverage run finishes — a test
 * inside that same run can't read its own run's result. `test:coverage` in
 * package.json therefore re-runs this one file, without `--coverage`, right
 * after the coverage run completes, so the file is always fresh by the time
 * this assertion matters. On a bare `vitest run` (no coverage collected) or
 * the coverage run's own pass, the summary doesn't exist yet and this test is
 * a no-op — there is nothing to compare against.
 */
describe('vitest.config.ts coverage thresholds vs measured coverage', () => {
  it('no floor sits more than 10 points under its measured value', () => {
    const summaryPath = path.join(ROOT, 'coverage', 'coverage-summary.json')
    if (!fs.existsSync(summaryPath)) return

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<
      string,
      Record<string, { pct: number }>
    >
    const thresholds = vitestConfig.test?.coverage?.thresholds ?? {}
    const METRICS = ['statements', 'branches', 'functions', 'lines'] as const
    const MAX_DRIFT = 10

    const drifted: string[] = []

    for (const metric of METRICS) {
      const floor = thresholds[metric]
      const measured = summary.total?.[metric]?.pct
      if (typeof floor === 'number' && typeof measured === 'number' && measured - floor > MAX_DRIFT) {
        drifted.push(`global ${metric}: floor ${floor} vs measured ${measured.toFixed(2)}`)
      }
    }

    for (const [file, perFile] of Object.entries(thresholds)) {
      if (NON_PATH_KEYS.has(file)) continue
      const entry = summary[path.join(ROOT, file)]
      if (!entry) continue // unresolvable keys are the other guard's job, above

      for (const metric of METRICS) {
        const floor = (perFile as Partial<Record<string, number>>)[metric]
        const measured = entry[metric]?.pct
        if (typeof floor === 'number' && typeof measured === 'number' && measured - floor > MAX_DRIFT) {
          drifted.push(`${file} ${metric}: floor ${floor} vs measured ${measured.toFixed(2)}`)
        }
      }
    }

    expect(
      drifted,
      `floors drifted more than ${String(MAX_DRIFT)} points below measured coverage — re-measure ` +
      `(\`pnpm run test:coverage\`) and tighten them a few points under, per the convention in ` +
      `vitest.config.ts's thresholds comment:\n  ${drifted.join('\n  ')}`,
    ).toEqual([])
  })
})
