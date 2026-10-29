import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Keeps the survey skills wired to their shared conventions.
 *
 * Every `.claude/skills/survey-*` skill defers to `_survey/conventions.md` by
 * relative link. `_survey` has no SKILL.md, so nothing else notices when a
 * rename leaves a link (or a `#anchor` in it) pointing nowhere.
 */

const SKILLS = path.resolve(__dirname, '../.claude/skills')
const CONVENTIONS = path.join(SKILLS, '_survey/conventions.md')

const slug = (heading: string) =>
  heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

const anchors = new Set(
  fs.readFileSync(CONVENTIONS, 'utf-8').split('\n')
    .filter(l => /^#{1,6} /.test(l))
    .map(l => slug(l.replace(/^#+ /, ''))),
)

const surveys = fs.readdirSync(SKILLS).filter(d => d.startsWith('survey-'))

describe('survey skills', () => {
  it('finds the surveys', () => {
    expect(surveys.length).toBeGreaterThan(0)
  })

  it.each(surveys)('%s links resolve', (dir) => {
    const text = fs.readFileSync(path.join(SKILLS, dir, 'SKILL.md'), 'utf-8')
    expect(text).toMatch(new RegExp(`^---\\nname: ${dir}\\n`))
    const links = [...text.matchAll(/\]\((\.[^)\s]+?)(?:#([^)\s]*))?\)/g)]
    expect(links.length).toBeGreaterThan(0)
    for (const [, rel, hash] of links) {
      const target = path.resolve(SKILLS, dir, rel!)
      expect(fs.existsSync(target), `${rel} from ${dir}`).toBe(true)
      if (hash && target === CONVENTIONS) {
        expect(anchors.has(hash), `#${hash} in ${dir}`).toBe(true)
      }
    }
  })
})
