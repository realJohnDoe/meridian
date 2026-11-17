import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Keeps the local survey skills readable by the workshop chooser: each needs
 * `label` and `scope` frontmatter, and none may link a deleted conventions file.
 */

const SKILLS = path.resolve(__dirname, '../.claude/skills')
const surveys = fs.readdirSync(SKILLS).filter(d => d.startsWith('survey-'))

describe('survey skills', () => {
  it('finds the surveys', () => {
    expect(surveys.length).toBeGreaterThan(0)
  })

  it.each(surveys)('%s declares label and scope', (dir) => {
    const text = fs.readFileSync(path.join(SKILLS, dir, 'SKILL.md'), 'utf-8')
    expect(text).toMatch(new RegExp(`^---\\nname: ${dir}\\n`))
    expect(text).toMatch(/^label: \S+$/m)
    expect(text).toMatch(/^scope: \S+/m)
    expect(text).not.toContain('_survey')
  })
})
