// Dev-only large-vault generator for performance testing.
//
// Produces a deterministic vault in the same markdown+frontmatter format the
// ExampleBackend uses, so it flows through the real parse → expand → render
// path just like a hand-authored vault. Enable in a dev session by running:
//
//   localStorage.setItem('meridian_bigvault', '300')
//
// The value may also be a JSON object, which is how the two scaling units are
// told apart — file count and occurrence count move together in the default
// mix (every recurring series expands to ~200 occurrences over the agenda
// window), so holding one fixed while the other varies is the only way to
// attribute a cost to one of them:
//
//   localStorage.setItem('meridian_bigvault', '{"count":1000,"recurringShare":0}')
//
// `recurringShare` is the fraction of files that get a weekly repeat rule
// (default 0.15 — the historical mix, which every earlier measurement used).
// At 0 the vault has exactly as many occurrences as it has files.
//
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

/** Fraction of generated files carrying a weekly repeat rule. */
const DEFAULT_RECURRING_SHARE = 0.15

export interface BigVaultOptions {
  /**
   * Fraction of files that become a recurring series (0–1). Lower it to grow
   * the vault in files without growing it in occurrences; see the header.
   */
  recurringShare?: number
}

/**
 * Generate `count` files at plausible heavy-use scale: a mix of recurring
 * series, dated tasks, one-off events, undated backlog tasks, and plain
 * notes, cross-linked with wikilinks so backlink resolution is exercised too.
 */
export function generateBigVault(
  count: number,
  { recurringShare = DEFAULT_RECURRING_SHARE }: BigVaultOptions = {},
): Array<{ id: string; content: string }> {
  const rng = makeRng(20240711)
  // Branch thresholds, with the recurring slice sized by `recurringShare` and
  // the remaining kinds keeping their relative proportions, so lowering the
  // share changes the occurrence count without also changing the mix of
  // tasks/events/notes underneath it.
  const rest = 1 - recurringShare
  const tDated   = recurringShare + rest * (0.40 / 0.85)
  const tEvent   = recurringShare + rest * (0.65 / 0.85)
  const tBacklog = recurringShare + rest * (0.75 / 0.85)
  const slugs: string[] = []
  for (let i = 0; i < count; i++) {
    const w1 = WORDS[Math.floor(rng() * WORDS.length)]
    const w2 = WORDS[Math.floor(rng() * WORDS.length)]
    slugs.push(`${w1}-${w2}-${i}`)
  }

  const entries: Array<{ id: string; content: string }> = []
  for (let i = 0; i < count; i++) {
    const slug = slugs[i]!  // slugs was filled with exactly `count` entries above
    const r = rng()
    const title = slug.split('-').slice(0, 2).map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ') + ` ${i}`

    // 2–4 wikilinks to other random files (exercises backlinks/resolveWikilink).
    const linkCount = 2 + Math.floor(rng() * 3)
    const links: string[] = []
    for (let k = 0; k < linkCount; k++) {
      const target = slugs[Math.floor(rng() * count)]
      if (target !== slug) links.push(`  - "[[${target}]]"`)
    }
    const itemsBlock = links.length ? `items:\n${links.join('\n')}\n` : ''
    const body = `\nBody text for ${title}. See [[${slugs[(i + 1) % count]}]] and [[${slugs[(i + 7) % count]}]].\n`

    if (r < recurringShare) {
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
    } else if (r < tDated) {
      // Dated task spread across the window.
      const off = -300 + Math.floor(rng() * 390)
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}date: "${d(off)}"\ndone: ${rng() < 0.4}\npriority: ${PRIORITIES[Math.floor(rng() * 3)]}\n---\n${body}`,
      })
    } else if (r < tEvent) {
      // One-off dated event.
      const off = -200 + Math.floor(rng() * 290)
      entries.push({
        id: slug,
        content: `---\ntitle: ${title}\n${itemsBlock}date: "${d(off)}"\ntime: "${8 + Math.floor(rng() * 9)}:00"\nduration: ${rng() < 0.5 ? '1h' : '30m'}\nparticipants: [${PARTICIPANTS[Math.floor(rng() * PARTICIPANTS.length)]}, ${PARTICIPANTS[Math.floor(rng() * PARTICIPANTS.length)]}]\n---\n${body}`,
      })
    } else if (r < tBacklog) {
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
