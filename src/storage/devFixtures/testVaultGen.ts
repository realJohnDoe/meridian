// Dev-only large-vault generator for performance testing.
//
// Produces a deterministic vault in the same markdown+frontmatter format the
// ExampleBackend uses, so it flows through the real parse → expand → render
// path just like a hand-authored vault. Enable in a dev session by running:
//
//   localStorage.setItem('meridian_bigvault', '300')
//
// then (re)loading the Tutorial vault — see ExampleBackend.loadEntries().
// Only wired up when import.meta.env.DEV is true, so this — and its call
// site — are dead-code-eliminated from production builds.
import { startOfToday } from 'date-fns'
import { fmtISO } from '@/model'
import { addDays } from '@/format'

function d(offset: number): string {
  return fmtISO(addDays(startOfToday(), offset))
}

// Small deterministic PRNG (mulberry32) so runs are reproducible.
function makeRng(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ['project', 'review', 'meeting', 'notes', 'plan', 'budget', 'design', 'sync',
  'report', 'draft', 'roadmap', 'sprint', 'retro', 'demo', 'research', 'spec', 'audit',
  'launch', 'hiring', 'onboarding', 'invoice', 'travel', 'call', 'followup', 'proposal']
const PARTICIPANTS = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi']
const PRIORITIES = ['high', 'medium', 'low']

/**
 * Generate `count` files at plausible heavy-use scale: a mix of recurring
 * series, dated tasks, one-off events, undated backlog tasks, and plain
 * notes, cross-linked with wikilinks so backlink resolution is exercised too.
 */
export function generateBigVault(count: number): Array<{ id: string; content: string }> {
  const rng = makeRng(20240711)
  const slugs: string[] = []
  for (let i = 0; i < count; i++) {
    const w1 = WORDS[Math.floor(rng() * WORDS.length)]
    const w2 = WORDS[Math.floor(rng() * WORDS.length)]
    slugs.push(`${w1}-${w2}-${i}`)
  }

  const entries: Array<{ id: string; content: string }> = []
  for (let i = 0; i < count; i++) {
    const slug = slugs[i]
    const r = rng()
    const title = slug.split('-').slice(0, 2).map(s => s[0].toUpperCase() + s.slice(1)).join(' ') + ` ${i}`

    // 2–4 wikilinks to other random files (exercises backlinks/resolveWikilink).
    const linkCount = 2 + Math.floor(rng() * 3)
    const links: string[] = []
    for (let k = 0; k < linkCount; k++) {
      const target = slugs[Math.floor(rng() * count)]
      if (target !== slug) links.push(`  - "[[${target}]]"`)
    }
    const itemsBlock = links.length ? `items:\n${links.join('\n')}\n` : ''
    const body = `\nBody text for ${title}. See [[${slugs[(i + 1) % count]}]] and [[${slugs[(i + 7) % count]}]].\n`

    if (r < 0.15) {
      // Recurring weekly event/task series → many expanded occurrences.
      const anchor = d(-350 + Math.floor(rng() * 20))
      const isTask = rng() < 0.5
      const extra = isTask
        ? `done: false\npriority: ${PRIORITIES[Math.floor(rng() * 3)]}\n`
        : `time: "09:00"\nduration: 30m\nparticipants: [${PARTICIPANTS[Math.floor(rng() * PARTICIPANTS.length)]}]\n`
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}date: "${anchor}"\n${extra}repeat:\n  type: schedule\n  freq: weekly\n  byweekday: [mo, we, fr]\ndefaults:\n  done: false\n---\n${body}`,
      })
    } else if (r < 0.55) {
      // Dated task spread across the window.
      const off = -300 + Math.floor(rng() * 390)
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}date: "${d(off)}"\ndone: ${rng() < 0.4}\npriority: ${PRIORITIES[Math.floor(rng() * 3)]}\n---\n${body}`,
      })
    } else if (r < 0.8) {
      // One-off dated event.
      const off = -200 + Math.floor(rng() * 290)
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}date: "${d(off)}"\ntime: "${8 + Math.floor(rng() * 9)}:00"\nduration: ${rng() < 0.5 ? '1h' : '30m'}\nparticipants: [${PARTICIPANTS[Math.floor(rng() * PARTICIPANTS.length)]}, ${PARTICIPANTS[Math.floor(rng() * PARTICIPANTS.length)]}]\n---\n${body}`,
      })
    } else if (r < 0.9) {
      // Undated backlog task.
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}done: ${rng() < 0.3}\npriority: ${PRIORITIES[Math.floor(rng() * 3)]}\n---\n${body}`,
      })
    } else {
      // Plain note.
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}---\n${body}`,
      })
    }
  }
  return entries
}
