// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { fixEmptyLineCursor } from './emptyLineCursorFix'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views.length = 0
  vi.restoreAllMocks()
})

function mkView(doc: string): EditorView {
  const state = EditorState.create({ doc })
  const view = new EditorView({ state })
  document.body.appendChild(view.dom)
  views.push(view)
  return view
}

// Stubs the invisible glyph-measuring probe (a <span>M</span>) to a fixed
// height, simulating jsdom's lack of real text layout.
function mockGlyphHeight(px: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.tagName === 'SPAN' && this.textContent === 'M' ? px : 0
    return { height, width: 0, top: 0, bottom: height, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) }
  })
}

function mkCursor(view: EditorView, heightPx: number): HTMLElement {
  const cursor = document.createElement('div')
  cursor.className = 'cm-cursor'
  cursor.style.height = `${heightPx}px`
  view.dom.appendChild(cursor)
  return cursor
}

describe('fixEmptyLineCursor', () => {
  it('clamps an oversized cursor on an empty line down to the measured glyph height', () => {
    const view = mkView('')
    mockGlyphHeight(18)
    const cursor = mkCursor(view, 25.89) // simulates Firefox's <br>-derived height

    fixEmptyLineCursor(view)

    expect(cursor.style.height).toBe('18px')
  })

  it('leaves the cursor alone when it is already close to the glyph height', () => {
    const view = mkView('')
    mockGlyphHeight(18)
    const cursor = mkCursor(view, 18.36) // Chrome/Safari's already-correct height

    fixEmptyLineCursor(view)

    expect(cursor.style.height).toBe('18.36px')
  })

  it('does nothing once the line has content', () => {
    const view = mkView('a')
    mockGlyphHeight(18)
    const cursor = mkCursor(view, 25.89)

    fixEmptyLineCursor(view)

    expect(cursor.style.height).toBe('25.89px')
  })

  it('does nothing when there is no cursor element to correct', () => {
    const view = mkView('')
    mockGlyphHeight(18)

    expect(() => fixEmptyLineCursor(view)).not.toThrow()
  })
})
