// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { startPerfJournal, perfJournalCount, perfJournalDump, clearPerfJournal } from './perfJournal'

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
})
