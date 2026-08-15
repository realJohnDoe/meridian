import { describe, it, expect } from 'vitest'
import {
  parseIcs, unfoldLines, parseContentLine, unescapeText, splitList,
  components, prop, propValue, textValue, props, param, calendarName,
} from './icsParse'

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

describe('unfoldLines', () => {
  it('splices a line folded at 75 octets back together', () => {
    const text = 'SUMMARY:This summary is long enough that a conforming encoder folds it a\r\n cross two lines'
    expect(unfoldLines(text)).toEqual([
      'SUMMARY:This summary is long enough that a conforming encoder folds it across two lines',
    ])
  })

  it('unfolds a tab continuation as well as a space', () => {
    expect(unfoldLines('SUMMARY:a\r\n\tb')).toEqual(['SUMMARY:ab'])
  })

  it('splices a fold that lands mid-word with no separator', () => {
    expect(unfoldLines('SUMMARY:Meri\r\n dian')).toEqual(['SUMMARY:Meridian'])
  })

  it('handles bare-LF and bare-CR documents', () => {
    expect(unfoldLines('A:1\nB:2')).toEqual(['A:1', 'B:2'])
    expect(unfoldLines('A:1\rB:2')).toEqual(['A:1', 'B:2'])
  })

  it('drops a UTF-8 BOM', () => {
    expect(unfoldLines('﻿BEGIN:VCALENDAR')).toEqual(['BEGIN:VCALENDAR'])
  })

  it('never treats a leading space on the first line as a continuation', () => {
    expect(unfoldLines(' orphan\r\nA:1')).toEqual([' orphan', 'A:1'])
  })
})

describe('parseContentLine', () => {
  it('parses name and value', () => {
    expect(parseContentLine('SUMMARY:Standup')).toEqual({ name: 'SUMMARY', params: {}, value: 'Standup' })
  })

  it('upper-cases the property and parameter names', () => {
    const p = parseContentLine('dtstart;tzid=Europe/Berlin:20260815T090000')
    expect(p?.name).toBe('DTSTART')
    expect(p?.params).toEqual({ TZID: ['Europe/Berlin'] })
  })

  it('keeps a colon inside a quoted parameter out of the name/value split', () => {
    const p = parseContentLine('ATTENDEE;ALTREP="http://dir.example/bob":mailto:bob@example.com')
    expect(p?.params['ALTREP']).toEqual(['http://dir.example/bob'])
    expect(p?.value).toBe('mailto:bob@example.com')
  })

  it('keeps a semicolon inside a quoted parameter out of the parameter split', () => {
    const p = parseContentLine('ATTENDEE;CN="Doe; Jane";ROLE=REQ-PARTICIPANT:mailto:jane@example.com')
    expect(p?.params['CN']).toEqual(['Doe; Jane'])
    expect(p?.params['ROLE']).toEqual(['REQ-PARTICIPANT'])
  })

  it('keeps every value of a multi-valued parameter', () => {
    const p = parseContentLine('X-THING;MEMBER="a","b":v')
    expect(p?.params['MEMBER']).toEqual(['a', 'b'])
  })

  it('leaves the value escaped for the caller to decode', () => {
    expect(parseContentLine('SUMMARY:Lunch\\, then talk')?.value).toBe('Lunch\\, then talk')
  })

  it('returns null for a line with no colon', () => {
    expect(parseContentLine('TRUNCATED-MID-LI')).toBeNull()
  })
})

describe('unescapeText', () => {
  it('decodes newlines, commas, semicolons and backslashes', () => {
    expect(unescapeText('a\\nb')).toBe('a\nb')
    expect(unescapeText('a\\Nb')).toBe('a\nb')
    expect(unescapeText('Lunch\\, then talk')).toBe('Lunch, then talk')
    expect(unescapeText('a\\;b')).toBe('a;b')
    expect(unescapeText('a\\\\b')).toBe('a\\b')
  })

  it('does not decode a backslash that was itself escaped', () => {
    expect(unescapeText('a\\\\nb')).toBe('a\\nb')
  })

  it('drops a trailing lone backslash rather than emitting it', () => {
    expect(unescapeText('a\\')).toBe('a')
  })
})

describe('splitList', () => {
  it('splits on unescaped commas only', () => {
    expect(splitList('20260101,20260102')).toEqual(['20260101', '20260102'])
    expect(splitList('a\\,b,c')).toEqual(['a\\,b', 'c'])
  })

  it('drops empty entries', () => {
    expect(splitList('a,,b')).toEqual(['a', 'b'])
  })
})

describe('parseIcs', () => {
  it('returns null for something that is not a calendar', () => {
    expect(parseIcs('<!doctype html><html>Sign in</html>')).toBeNull()
    expect(parseIcs('')).toBeNull()
  })

  it('extracts VEVENTs', () => {
    const cal = parseIcs(wrap([
      'BEGIN:VEVENT', 'UID:a@example', 'SUMMARY:One', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b@example', 'SUMMARY:Two', 'END:VEVENT',
    ].join('\r\n')))!

    const events = components(cal, 'VEVENT')
    expect(events.map(e => propValue(e, 'SUMMARY'))).toEqual(['One', 'Two'])
  })

  it('reaches a component nested inside an event', () => {
    const cal = parseIcs(wrap([
      'BEGIN:VEVENT', 'UID:a@example',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n')))!

    expect(components(cal, 'VALARM')).toHaveLength(1)
    // The alarm's properties stay on the alarm, not on the event.
    expect(propValue(components(cal, 'VEVENT')[0]!, 'ACTION')).toBeUndefined()
  })

  it('keeps the events parsed before a truncation', () => {
    // Cut off mid-transfer: no END:VEVENT, no END:VCALENDAR, partial last line.
    const cal = parseIcs([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:a@example', 'SUMMARY:Complete', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b@example', 'SUMM',
    ].join('\r\n'))!

    expect(cal).not.toBeNull()
    const events = components(cal, 'VEVENT')
    expect(events).toHaveLength(2)
    expect(propValue(events[0]!, 'SUMMARY')).toBe('Complete')
    expect(propValue(events[1]!, 'SUMMARY')).toBeUndefined()
  })

  it('does not let a stray END swallow the following events', () => {
    const cal = parseIcs(wrap([
      'BEGIN:VEVENT', 'UID:a@example', 'END:VEVENT', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b@example', 'END:VEVENT',
    ].join('\r\n')))!
    expect(components(cal, 'VEVENT')).toHaveLength(2)
  })

  it('reads X-WR-CALNAME as the calendar name', () => {
    expect(calendarName(parseIcs(wrap('X-WR-CALNAME:Family\\, shared'))!)).toBe('Family, shared')
    expect(calendarName(parseIcs(wrap('VERSION:2.0'))!)).toBeUndefined()
  })

  it('exposes repeated properties, params and text values', () => {
    const event = components(parseIcs(wrap([
      'BEGIN:VEVENT',
      'UID:a@example',
      'SUMMARY:Weekly\\; sync',
      'ATTENDEE;CN=Alice:mailto:alice@example.com',
      'ATTENDEE;CN=Bob:mailto:bob@example.com',
      'END:VEVENT',
    ].join('\r\n')))!, 'VEVENT')[0]!

    expect(textValue(event, 'SUMMARY')).toBe('Weekly; sync')
    expect(props(event, 'ATTENDEE').map(a => param(a, 'CN'))).toEqual(['Alice', 'Bob'])
    expect(prop(event, 'NOPE')).toBeUndefined()
  })
})
