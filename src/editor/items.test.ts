import { describe, it, expect } from 'vitest'
import { parseItemEntry, serializeTaskEntry, TASK_ITEM_RE } from './items'

describe('TASK_ITEM_RE', () => {
  it('matches unchecked task', () => {
    expect(TASK_ITEM_RE.test('[ ] buy milk')).toBe(true)
  })

  it('matches checked task with lowercase x', () => {
    expect(TASK_ITEM_RE.test('[x] buy milk')).toBe(true)
  })

  it('matches checked task with uppercase X', () => {
    expect(TASK_ITEM_RE.test('[X] buy milk')).toBe(true)
  })

  it('requires content after the checkbox', () => {
    expect(TASK_ITEM_RE.test('[ ] ')).toBe(false)
    expect(TASK_ITEM_RE.test('[ ]')).toBe(false)
  })

  it('does not match wikilinks', () => {
    expect(TASK_ITEM_RE.test('[[some-note]]')).toBe(false)
  })

  it('captures done char as group 1', () => {
    expect(TASK_ITEM_RE.exec('[ ] text')![1]).toBe(' ')
    expect(TASK_ITEM_RE.exec('[x] text')![1]).toBe('x')
    expect(TASK_ITEM_RE.exec('[X] text')![1]).toBe('X')
  })

  it('captures content as group 2', () => {
    expect(TASK_ITEM_RE.exec('[ ] buy milk')![2]).toBe('buy milk')
  })
})

describe('parseItemEntry', () => {
  it('parses a wikilink entry', () => {
    const entry = parseItemEntry('[[my-note]]')
    expect(entry).toEqual({ kind: 'link', ref: 'my-note', raw: '[[my-note]]' })
  })

  it('parses a wikilink with label (ignores the label, uses slug)', () => {
    const entry = parseItemEntry('[[my-note|Display Name]]')
    expect(entry).toEqual({ kind: 'link', ref: 'my-note', raw: '[[my-note|Display Name]]' })
  })

  it('parses an unchecked task', () => {
    const entry = parseItemEntry('[ ] buy milk')
    expect(entry).toEqual({ kind: 'task', text: 'buy milk', done: false, raw: '[ ] buy milk' })
  })

  it('parses a checked task (lowercase x)', () => {
    const entry = parseItemEntry('[x] buy milk')
    expect(entry).toEqual({ kind: 'task', text: 'buy milk', done: true, raw: '[x] buy milk' })
  })

  it('parses a checked task (uppercase X)', () => {
    const entry = parseItemEntry('[X] buy milk')
    expect(entry).toEqual({ kind: 'task', text: 'buy milk', done: true, raw: '[X] buy milk' })
  })

  it('treats bare strings as unchecked tasks', () => {
    const entry = parseItemEntry('something without a checkbox')
    expect(entry).toEqual({
      kind: 'task',
      text: 'something without a checkbox',
      done: false,
      raw: 'something without a checkbox',
    })
  })

  it('trims whitespace from raw input', () => {
    const entry = parseItemEntry('  [ ] padded  ')
    expect(entry).toMatchObject({ kind: 'task', text: 'padded', done: false })
  })

  it('preserves raw value unchanged', () => {
    const raw = '[ ] buy milk'
    expect(parseItemEntry(raw).raw).toBe(raw)
  })
})

describe('serializeTaskEntry', () => {
  it('serializes unchecked task', () => {
    expect(serializeTaskEntry('buy milk', false)).toBe('[ ] buy milk')
  })

  it('serializes checked task', () => {
    expect(serializeTaskEntry('buy milk', true)).toBe('[x] buy milk')
  })

  it('round-trips with parseItemEntry', () => {
    const roundTrip = (text: string, done: boolean) => {
      const serialized = serializeTaskEntry(text, done)
      const parsed = parseItemEntry(serialized)
      expect(parsed).toMatchObject({ kind: 'task', text, done })
    }
    roundTrip('buy milk', false)
    roundTrip('buy milk', true)
    roundTrip('multi word task with spaces', false)
  })
})
