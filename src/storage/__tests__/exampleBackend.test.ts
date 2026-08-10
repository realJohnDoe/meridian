import { describe, it, expect, vi, afterEach } from 'vitest'
import { addDays } from '@/format'
import { fmtISO } from '@/model'

// `ExampleBackend`'s ENTRIES are computed once at module load (see
// exampleBackend.ts's `loadEntries`), so faking the clock alone doesn't
// change them — each case sets the fake date, then resets the module
// registry and re-imports so the fixture is rebuilt against it.
afterEach(() => {
  vi.useRealTimers()
})

/** Dates and done-flags inside a raw entry's `instances:` block, or [] when there is none. */
function parseInstances(content: string): { date: string; done: boolean }[] {
  const match = /^instances:\n([\s\S]*?)\n---/m.exec(content)
  if (!match) return []
  const block = match[1]!
  const dates = [...block.matchAll(/date: "([\d-]+)"/g)].map(m => m[1]!)
  const dones = [...block.matchAll(/done: (true|false)/g)].map(m => m[1] === 'true')
  return dates.map((date, i) => ({ date, done: dones[i]! }))
}

/** Every Mon/Wed/Fri from `anchor` up to (not including) `today`, ascending — computed independently of exampleBackend.ts's own helper. */
function expectedDoneDates(anchor: Date, today: Date): string[] {
  const out: string[] = []
  for (let day = anchor; day < today; day = addDays(day, 1)) {
    if ([1, 3, 5].includes(day.getDay())) out.push(fmtISO(day))
  }
  return out
}

describe('ExampleBackend recurring demo entries', () => {
  // 2026-06-14 is a Sunday; walking forward covers all seven weekdays the
  // demo could be opened on, including the Monday edge case where the
  // series anchor *is* today.
  for (let dow = 0; dow < 7; dow++) {
    it(`ticks every past Mon/Wed/Fri occurrence done, opened on weekday ${dow}`, async () => {
      const today = addDays(new Date(2026, 5, 14), dow)
      const anchor = addDays(today, -((today.getDay() - 1 + 7) % 7))

      vi.useFakeTimers()
      vi.setSystemTime(today)
      vi.resetModules()

      const { ExampleBackend } = await import('../exampleBackend')
      const files = await new ExampleBackend().readAll()
      const expected = expectedDoneDates(anchor, today)

      for (const path of ['team-standup.md', 'morning-run.md']) {
        const file = files.find(f => f.path === path)
        expect(file, `${path} missing from example vault`).toBeDefined()

        const instances = parseInstances(file!.content)
        expect(instances.map(i => i.date)).toEqual(expected)
        expect(instances.every(i => i.done)).toBe(true)

        // The anchor-is-today (Monday) case must omit the key entirely, not
        // emit it with no children — see doneInstances' doc comment.
        if (expected.length === 0) expect(file!.content).not.toContain('instances:')
      }
    })
  }

  it('never leaves an undone occurrence dated before today', async () => {
    const today = new Date(2026, 5, 18) // a Thursday, mid-series
    vi.useFakeTimers()
    vi.setSystemTime(today)
    vi.resetModules()

    const { ExampleBackend } = await import('../exampleBackend')
    const files = await new ExampleBackend().readAll()

    for (const path of ['team-standup.md', 'morning-run.md']) {
      const content = files.find(f => f.path === path)!.content
      const instances = parseInstances(content)
      // Every Mon/Wed/Fri strictly before today (2026-06-18) is ticked done.
      expect(instances.map(i => i.date)).toEqual(['2026-06-15', '2026-06-17'])
      expect(instances.every(i => i.done)).toBe(true)
    }
  })
})
