// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { startPerfJournal, perfJournalCount, perfJournalDump, clearPerfJournal, recordRender as record } from './perfJournal'

type Callback = (list: { getEntries: () => unknown[] }) => void
const observers = new Map<string, Callback>()

class FakeObserver {
  static supportedEntryTypes = ['event', 'long-animation-frame']
  constructor(private cb: Callback) {}
  observe({ type }: { type: string }) { observers.set(type, this.cb) }
}

function emit(type: string, ...entries: unknown[]) {
  observers.get(type)!({ getEntries: () => entries })
}

const event = (o: Partial<PerformanceEventTiming>) => ({
  name: 'pointerdown', interactionId: 1, startTime: 0, duration: 200,
  processingStart: 30, processingEnd: 130, target: null, ...o,
})

beforeEach(() => {
  clearPerfJournal()
  observers.clear()
  vi.stubGlobal('PerformanceObserver', FakeObserver)
  startPerfJournal()
})

/** React's onRender passes baseDuration and startTime between the duration and the commit time. */
const recordRender = (id: string, phase: string, duration: number, commitTime: number) =>
  record(id, phase, duration, 0, 0, commitTime)

describe('perfJournal', () => {
  it('records a slow interaction split into input, handler and paint time', () => {
    emit('event', event({}))
    expect(perfJournalDump()).toContain('pointerdown 200ms = input 30ms + handlers 100ms + paint 70ms')
  })

  it('describes the target by tag and role, never by its text', () => {
    const target = document.createElement('div')
    target.setAttribute('role', 'checkbox')
    target.textContent = 'private note title'
    emit('event', event({ target }))
    expect(perfJournalDump()).toContain('on div role=checkbox at /')
    expect(perfJournalDump()).not.toContain('private')
  })

  it('merges the entries of one interaction, so a click handler is not counted as paint', () => {
    emit('event',
      event({ name: 'pointerdown', startTime: 0, duration: 400, processingStart: 20, processingEnd: 25 }),
      event({ name: 'click', startTime: 60, duration: 340, processingStart: 70, processingEnd: 350 }))
    expect(perfJournalCount()).toBe(1)
    expect(perfJournalDump()).toContain('pointerdown+click 400ms = input 20ms + handlers 330ms + paint 50ms')
  })

  it('ignores fast events and non-interactions', () => {
    emit('event', event({ duration: 50 }), event({ interactionId: 0 }))
    expect(perfJournalCount()).toBe(0)
  })

  it('records a long frame with its slowest scripts', () => {
    emit('long-animation-frame', {
      startTime: 0, duration: 180, blockingDuration: 130,
      scripts: [
        { duration: 20, sourceFunctionName: 'small', invoker: '', sourceURL: 'https://x/a.js' },
        { duration: 150, sourceFunctionName: 'parseVault', invoker: '', sourceURL: 'https://x/assets/index-abc.js?v=1' },
      ],
    })
    expect(perfJournalDump()).toContain('frame        180ms blocking 130ms  parseVault (index-abc.js) 150ms; small (a.js) 20ms')
  })

  it('caps the ring', () => {
    for (let i = 1; i <= 150; i++) emit('event', event({ interactionId: i }))
    expect(perfJournalCount()).toBe(100)
  })

  describe('React render attribution', () => {
    it('lists the renders committed inside the interaction, not outside it', () => {
      recordRender('app-page', 'update', 9, 500)
      recordRender('entry-page', 'update', 71, 60)
      recordRender('root', 'update', 84, 61)
      emit('event', event({ name: 'click', startTime: 50, duration: 120 }))
      const dump = perfJournalDump()
      expect(dump).toContain('← entry-page update 71ms, root update 84ms · other 36ms')
      expect(dump).not.toContain('app-page')
    })

    it('subtracts only root renders, so nested ids are not counted twice', () => {
      recordRender('entry-page', 'update', 70, 60)
      recordRender('root', 'update', 80, 61)
      recordRender('app-page', 'update', 30, 62)
      emit('event', event({ startTime: 50, duration: 200 }))
      expect(perfJournalDump()).toContain('other 120ms')
    })

    it('says so when nothing rendered, and never reports a negative remainder', () => {
      emit('event', event({ interactionId: 1, startTime: 0, duration: 120 }))
      expect(perfJournalDump()).toContain('← no render · other 120ms')
      recordRender('root', 'update', 500, 10)
      emit('event', event({ interactionId: 2, startTime: 0, duration: 120 }))
      expect(perfJournalDump()).toContain('other 0ms')
    })

    it('recomputes the attribution when a later entry widens the interaction', () => {
      emit('event', event({ name: 'pointerdown', startTime: 0, duration: 120 }))
      recordRender('root', 'update', 80, 200)
      emit('event', event({ name: 'click', startTime: 100, duration: 150 }))
      expect(perfJournalDump()).toContain('root update 80ms · other 170ms')
    })
  })
})
