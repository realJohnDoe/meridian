import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, placeholder } from '@codemirror/view'
import type { Roots, StoreItem } from '../types'
import { rootsField, setRootsEffect, wikilinkDecorations } from './cm/wikilinkDecorations'

interface Props {
  body:    string
  roots:   Roots
  items:   StoreItem[]
  viewRef: React.MutableRefObject<EditorView | null>
}

const editorTheme = EditorView.theme({
  '&': {
    fontSize: '0.875rem',
    lineHeight: '1.85',
    minHeight: '10rem',
    background: 'transparent',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--input)',
    outline: 'none',
    color: 'var(--secondary-foreground)',
  },
  '&.cm-focused': {
    outline: 'none',
    boxShadow: '0 0 0 2px var(--ring)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'visible',
  },
  '.cm-content': {
    padding: '0.5rem 0.75rem',
    caretColor: 'var(--primary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-words',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--primary)',
  },
  '.cm-selectionBackground, ::selection': {
    background: 'color-mix(in oklab, var(--primary), transparent 75%) !important',
  },
  '.cm-placeholder': {
    color: 'var(--muted-foreground)',
  },
  // Wikilink marks — visual parity with old [&_.wl] / [&_.wl-broken] classes
  '.wl': {
    color: 'var(--primary)',
    borderBottom: '1px solid var(--event-border)',
    cursor: 'pointer',
  },
  '.wl-broken': {
    color: 'var(--destructive)',
    borderBottom: '1px solid color-mix(in oklab, var(--destructive), transparent 70%)',
  },
})

export default function EntryBody({ body, roots, items: _items, viewRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Mount CM6 EditorView once per component lifetime (key= on parent handles remounts)
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: body,
      extensions: [
        rootsField.init(() => roots),
        wikilinkDecorations,
        editorTheme,
        placeholder('Add a description…'),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false' }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep roots in sync without remounting the editor
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({ effects: setRootsEffect.of(roots) })
    }
  }, [roots, viewRef])

  return <div ref={containerRef} className="mt-1" />
}
