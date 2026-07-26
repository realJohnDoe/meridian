// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet, type WidgetType } from '@codemirror/view'
import { forceParsing } from '@codemirror/language'
import {
  markdownLanguage,
  markdownLivePreview,
  markdownListDecos,
} from './markdownFormatting'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views.length = 0
  vi.restoreAllMocks()
})

/**
 * Build a view running both markdown decoration plugins, with a
 * guaranteed-complete syntax tree.
 *
 * `EditorState.create` parses only within a 20 ms budget and keeps whatever
 * partial tree it has when that runs out, so on a loaded machine later lines
 * can be missing. `forceParsing` finishes the parse *and* dispatches the empty
 * transaction that makes the result visible to `syntaxTree(view.state)` — see
 * the note in taskLines.test.ts for why `ensureSyntaxTree` alone is not enough.
 */
function mkView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [markdownLanguage, markdownLivePreview, markdownListDecos],
  })
  const view = new EditorView({ state })
  document.body.appendChild(view.dom)
  views.push(view)
  forceParsing(view, view.state.doc.length, Infinity)
  return view
}

type Range = {
  from: number
  to: number
  text: string
  widget?: WidgetType
  class?: string
  style?: string
}

function rangesOf(decos: DecorationSet, view: EditorView): Range[] {
  const out: Range[] = []
  decos.between(0, view.state.doc.length, (from, to, deco) => {
    const spec = deco.spec as {
      widget?: WidgetType
      class?: string
      attributes?: { style?: string }
    }
    out.push({
      from,
      to,
      text: view.state.doc.sliceString(from, to),
      widget: spec.widget,
      class: spec.class,
      style: spec.attributes?.style,
    })
  })
  return out
}

/** Replace/hide decorations from the live-preview plugin. */
function hideRanges(view: EditorView): Range[] {
  return rangesOf(view.plugin(markdownLivePreview)!.decorations, view)
}

/** Line decorations from the list-indent plugin. */
function lineRanges(view: EditorView): Range[] {
  return rangesOf(view.plugin(markdownListDecos)!.decorations, view)
}

describe('markdownLivePreview — syntax mark hiding', () => {
  it('hides a heading mark along with the space that follows it', () => {
    const view = mkView('# Heading')
    expect(hideRanges(view)).toEqual([
      expect.objectContaining({ from: 0, to: 2, text: '# ', widget: undefined }),
    ])
  })

  it('hides only the marks when a heading has no trailing space', () => {
    const view = mkView('#')
    // `node.to === line.to`, so the space-consuming branch must not run past
    // the end of the line.
    expect(hideRanges(view)).toEqual([
      expect.objectContaining({ from: 0, to: 1, text: '#' }),
    ])
  })

  it('hides emphasis and code marks but leaves the text between them', () => {
    const view = mkView('**bold** `code`')
    expect(hideRanges(view).map(r => [r.from, r.to, r.text])).toEqual([
      [0, 2, '**'],
      [6, 8, '**'],
      [9, 10, '`'],
      [14, 15, '`'],
    ])
  })

  it('leaves every mark raw on the focused cursor line', () => {
    const view = mkView('# Heading\n**bold**')
    view.focus()
    view.dispatch({ selection: { anchor: 0 } })

    const ranges = hideRanges(view)
    const line2 = view.state.doc.line(2)
    // Line 1 holds the cursor → untouched; line 2 still gets its marks hidden.
    expect(ranges.every(r => r.from >= line2.from)).toBe(true)
    expect(ranges.map(r => r.text)).toEqual(['**', '**'])
  })
})

describe('markdownLivePreview — list markers', () => {
  it.each(['-', '*', '+'])('replaces the %s bullet with a bullet widget', mark => {
    const view = mkView(`${mark} item`)
    const [deco, ...rest] = hideRanges(view)

    expect(rest).toEqual([])
    expect([deco!.from, deco!.to]).toEqual([0, 1])
    // The marker is replaced by a decorative bullet, hidden from screen readers
    // since the list semantics already convey it.
    const dom = deco!.widget!.toDOM(view)
    expect(dom.textContent).toBe('•')
    expect(dom.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps an ordered marker but boxes it at one digit width', () => {
    const view = mkView('1. item')
    const [deco] = hideRanges(view)

    // The trailing space is consumed too, so the gap comes solely from the
    // marker box.
    expect([deco!.from, deco!.to, deco!.text]).toEqual([0, 3, '1. '])
    const dom = deco!.widget!.toDOM(view)
    expect(dom.textContent).toBe('1.')
    expect(dom.className).toBe('cm-ol-marker')
    expect(dom.style.width).toBe('calc(1ch + 0.45em)')
  })

  it('widens the marker box for a two-digit ordered marker', () => {
    const view = mkView('10. item')
    const [deco] = hideRanges(view)

    expect([deco!.from, deco!.to, deco!.text]).toEqual([0, 4, '10. '])
    const dom = deco!.widget!.toDOM(view)
    expect(dom.textContent).toBe('10.')
    // Two digits → two `ch` of width, so 1–9 and 10–99 each align as a group.
    expect(dom.style.width).toBe('calc(2ch + 0.45em)')
  })

  it('drops the bullet on a task line so only the checkbox shows', () => {
    const view = mkView('- [ ] task')
    const [deco, ...rest] = hideRanges(view)

    // taskDecorations owns the checkbox widget; this plugin hides the marker
    // and the space after it rather than drawing a competing bullet.
    expect(rest).toEqual([])
    expect([deco!.from, deco!.to, deco!.text]).toEqual([0, 2, '- '])
    expect(deco!.widget).toBeUndefined()
  })
})

describe('markdownLivePreview — links', () => {
  it('replaces an inline link with a widget showing its label', () => {
    const view = mkView('[text](https://example.com)')
    const [deco, ...rest] = hideRanges(view)

    // The whole node is replaced, so the URL and brackets never render.
    expect(rest).toEqual([])
    expect([deco!.from, deco!.to]).toEqual([0, view.state.doc.length])
    const dom = deco!.widget!.toDOM(view)
    expect(dom.textContent).toBe('text')
    expect(dom.className).toBe('cm-md-link')
  })

  it('falls back to the URL as the label when the link text is empty', () => {
    const view = mkView('[](https://example.com)')
    const [deco] = hideRanges(view)
    expect(deco!.widget!.toDOM(view).textContent).toBe('https://example.com')
  })

  it('leaves a bare [text] reference untouched when it has no URL', () => {
    const view = mkView('[text]')
    expect(hideRanges(view)).toEqual([])
  })

  it('renders a bare URL autolink as a link widget', () => {
    const view = mkView('https://example.com')
    const [deco] = hideRanges(view)
    expect([deco!.from, deco!.to]).toEqual([0, view.state.doc.length])
    expect(deco!.widget!.toDOM(view).textContent).toBe('https://example.com')
  })

  it('opens a bare email autolink through mailto:', () => {
    const view = mkView('foo@bar.com')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const dom = hideRanges(view)[0]!.widget!.toDOM(view)

    dom.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }))
    expect(open).toHaveBeenCalledWith('mailto:foo@bar.com', '_blank', 'noopener,noreferrer')
  })

  it('prefixes a schemeless www autolink with https:', () => {
    const view = mkView('www.example.com')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const dom = hideRanges(view)[0]!.widget!.toDOM(view)

    dom.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }))
    expect(open).toHaveBeenCalledWith('https://www.example.com', '_blank', 'noopener,noreferrer')
  })

  it('refuses to open a javascript: URL but still swallows the event', () => {
    const view = mkView('[x](javascript:alert(1))')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const dom = hideRanges(view)[0]!.widget!.toDOM(view)

    const event = new MouseEvent('mousedown', { cancelable: true })
    dom.dispatchEvent(event)

    // Only http(s)/mailto are navigable; the click is still consumed so CM6
    // doesn't place a cursor inside the replaced range.
    expect(open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('markdownListDecos — hanging indent', () => {
  it('marks an unordered item line for a fixed hanging indent', () => {
    const view = mkView('- item')
    expect(lineRanges(view)).toEqual([
      expect.objectContaining({ from: 0, to: 0, class: 'cm-ul-item' }),
    ])
  })

  it('sizes the ordered item indent to the marker width', () => {
    const view = mkView('1. one\n10. ten')
    const [first, second] = lineRanges(view)

    expect(first!.class).toBe('cm-ol-item')
    expect(first!.style).toBe('padding-left:calc(1ch + 0.45em);text-indent:calc(-1ch - 0.45em)')
    // The wider marker pushes its text one column further right.
    expect(second!.class).toBe('cm-ol-item')
    expect(second!.style).toBe('padding-left:calc(2ch + 0.45em);text-indent:calc(-2ch - 0.45em)')
  })

  it('applies the line class regardless of where the cursor is', () => {
    const view = mkView('- item')
    view.focus()
    view.dispatch({ selection: { anchor: 2 } })
    // Indentation is cursor-independent, unlike the mark-hiding plugin.
    expect(lineRanges(view).map(r => r.class)).toEqual(['cm-ul-item'])
  })
})

describe('decoration plugins rebuild on update', () => {
  it('picks up a marker added by a document change', () => {
    const view = mkView('item')
    expect(lineRanges(view)).toEqual([])
    expect(hideRanges(view)).toEqual([])

    view.dispatch({ changes: { from: 0, to: 0, insert: '- ' } })
    forceParsing(view, view.state.doc.length, Infinity)

    expect(lineRanges(view).map(r => r.class)).toEqual(['cm-ul-item'])
    expect(hideRanges(view).map(r => r.text)).toEqual(['-'])
  })

  it('restores the raw marks when the cursor moves onto the line', () => {
    const view = mkView('# one\n# two')
    view.focus()
    view.dispatch({ selection: { anchor: 0 } })
    expect(hideRanges(view)).toHaveLength(1)

    // Moving off line 1 and onto line 2 swaps which line stays raw.
    const line2 = view.state.doc.line(2)
    view.dispatch({ selection: { anchor: line2.from } })
    const ranges = hideRanges(view)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.from).toBe(0)
  })
})
