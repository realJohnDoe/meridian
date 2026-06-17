import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Roots, StoreItem } from '../types'
import {
  rootsField, setRootsEffect,
  itemsField, setItemsEffect,
  createWikilinkExtension, wikilinkTheme,
} from './cm/wikilinkDecorations'
import { createTaskExtension, taskTheme } from './cm/taskDecorations'
import { markdownLanguage, markdownHighlight, markdownLivePreview, markdownListDecos, markdownListTheme } from './cm/markdownFormatting'
import WikilinkPopup, { type WlPopupState } from './WikilinkPopup'

interface Props {
  body:             string
  roots:            Roots
  items:            StoreItem[]
  viewRef:          React.MutableRefObject<EditorView | null>
  onOpenWikilink?:  (ref: string) => void
  onPromoteTask?:   (title: string, done: boolean) => string | null
}

const editorTheme = EditorView.theme({
  '&': {
    background: 'transparent',
    outline: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
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
    minHeight: '10rem',
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
  // Raw wikilink text shown when cursor is on the line
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

export default function EntryBody({ body, roots, items, viewRef, onOpenWikilink, onPromoteTask }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [wlPopup, setWlPopup] = useState<WlPopupState | null>(null)
  const closePopup = useCallback(() => setWlPopup(null), [])

  // Stable ref so the CM6 plugin always reads the latest callback without remounting
  const onOpenRef = useRef<(ref: string) => void>(onOpenWikilink ?? (() => {}))
  useEffect(() => { onOpenRef.current = onOpenWikilink ?? (() => {}) }, [onOpenWikilink])

  const onPromoteTaskRef = useRef(onPromoteTask)
  useEffect(() => { onPromoteTaskRef.current = onPromoteTask }, [onPromoteTask])

  // Promote callback invoked by TaskCardWidget: creates the item then replaces the line
  const onPromoteRef = useRef(
    (text: string, done: boolean, lineFrom: number, lineTo: number, edView: EditorView) => {
      const slug = onPromoteTaskRef.current?.(text, done)
      if (slug) {
        edView.dispatch({ changes: { from: lineFrom, to: lineTo, insert: `- [[${slug}]]` } })
      }
    },
  )

  // Mount CM6 EditorView once per component lifetime (key= on parent handles remounts)
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: body,
      extensions: [
        markdownLanguage,
        markdownHighlight,
        markdownListTheme,
        markdownListDecos,
        markdownLivePreview,
        // Wikilink state fields (must be registered before the decoration plugin)
        rootsField.init(() => roots),
        itemsField.init(() => items),
        createWikilinkExtension(onOpenRef),
        wikilinkTheme,
        createTaskExtension(onPromoteRef),
        taskTheme,
        editorTheme,
        placeholder('Add a description…'),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false' }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Drive the [[…]] autocomplete popup
        EditorView.updateListener.of(update => {
          if (!update.docChanged && !update.selectionSet) return
          const sel = update.state.selection.main
          if (!sel.empty) { setWlPopup(null); return }
          const before = update.state.doc.sliceString(0, sel.head)
          const m = before.match(/\[\[[^\]\n]*$/)
          if (!m) { setWlPopup(null); return }
          const coords = update.view.coordsAtPos(sel.head)
          if (!coords) { setWlPopup(null); return }
          setWlPopup({ query: m[0].slice(2), from: sel.head - m[0].length, coords })
        }),
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

  // Keep roots in sync without remounting
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setRootsEffect.of(roots) })
  }, [roots, viewRef])

  // Keep items in sync without remounting
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setItemsEffect.of(items) })
  }, [items, viewRef])

  return (
    <>
      <div
        ref={containerRef}
        className="mt-1 text-sm leading-[1.85] text-secondary-foreground border border-input rounded-[var(--radius-md)] focus-within:ring-2 focus-within:ring-ring"
      />
      {wlPopup && viewRef.current && (
        <WikilinkPopup
          popup={wlPopup}
          roots={roots}
          items={items}
          view={viewRef.current}
          onClose={closePopup}
        />
      )}
    </>
  )
}
