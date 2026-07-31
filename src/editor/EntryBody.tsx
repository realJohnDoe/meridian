import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Roots, StoreItem } from '@/types'
import {
  rootsField, setRootsEffect,
  itemsField, setItemsEffect,
  createWikilinkExtension, wikilinkTheme,
} from './cm/wikilinkDecorations'
import { createTaskExtension, taskTheme } from './cm/taskDecorations'
import { markdownLanguage, markdownHighlight, markdownLivePreview, markdownListDecos, markdownListTheme } from './cm/markdownFormatting'
import { emptyPlaceholder, emptyPlaceholderTheme } from './cm/emptyPlaceholder'
import { emptyLineCaret, emptyLineCaretTheme } from './cm/emptyLineCaret'
import WikilinkPopup, { type WlPopupState } from './WikilinkPopup'

interface Props {
  body:             string
  roots:            Roots
  items:            StoreItem[]
  viewRef:          React.MutableRefObject<EditorView | null>
  onOpenWikilink?:  (ref: string) => void
  onChange?:        (body: string) => void
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
  // Rendered markdown link on non-cursor lines
  '.cm-md-link': {
    color: 'var(--primary)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    textDecorationColor: 'color-mix(in oklab, var(--primary), transparent 40%)',
    cursor: 'pointer',
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

export default function EntryBody({ body, roots, items, viewRef, onOpenWikilink, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [wlPopup, setWlPopup] = useState<WlPopupState | null>(null)
  const closePopup = () => setWlPopup(null)

  // Mirrors viewRef.current into state so the WikilinkPopup mount condition
  // below can read it during render without accessing the ref directly.
  const [view, setView] = useState<EditorView | null>(null)

  // Stable refs so CM6 plugins always read the latest callbacks without remounting
  const onOpenRef   = useRef<(ref: string) => void>(onOpenWikilink ?? (() => {}))
  const onChangeRef = useRef<(body: string) => void>(onChange ?? (() => {}))
  useEffect(() => { onOpenRef.current   = onOpenWikilink ?? (() => {}) }, [onOpenWikilink])
  useEffect(() => { onChangeRef.current = onChange ?? (() => {}) }, [onChange])

  // Seed values for the CM6 mount effect below. These are only ever read to
  // build the initial EditorState, so capturing them at mount is the intended
  // semantics — useRef ignores its argument after the first render, which
  // states that in code instead of via an exhaustive-deps suppression. The
  // distinction matters beyond style: any react-hooks suppression inside a
  // component makes the React Compiler skip optimizing the whole component
  // ("skipped optimizing this component because one or more React ESLint rules
  // were disabled"), so a one-line suppression silently cost this entire file
  // its memoization.
  const seedRef = useRef({ body, roots, items })

  // Mount CM6 EditorView once per component lifetime (key= on parent handles remounts)
  useEffect(() => {
    if (!containerRef.current) return
    const { body: seedBody, roots: seedRoots, items: seedItems } = seedRef.current

    const state = EditorState.create({
      doc: seedBody,
      extensions: [
        markdownLanguage,
        markdownHighlight,
        markdownListTheme,
        markdownListDecos,
        markdownLivePreview,
        // Wikilink state fields (must be registered before the decoration plugin)
        rootsField.init(() => seedRoots),
        itemsField.init(() => seedItems),
        createWikilinkExtension(onOpenRef),
        wikilinkTheme,
        createTaskExtension(),
        taskTheme,
        editorTheme,
        drawSelection(),
        emptyLineCaret,
        emptyLineCaretTheme,
        emptyPlaceholder,
        emptyPlaceholderTheme('Add a description…'),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false' }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Drive the [[…]] autocomplete popup and report body changes
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString().trimEnd())
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
    setView(view)

    return () => {
      view.destroy()
      viewRef.current = null
      setView(null)
    }
    // viewRef is listed rather than seeded above because the effect writes
    // through it (including in cleanup) — same convention as the setRoots/
    // setItems effects below. It's a ref object from the parent, so it's
    // stable and this stays mount-only in practice.
  }, [viewRef])

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
        // text-base below sm: iOS Safari auto-zooms on focus of editable content under 16px
        className="mt-1 text-base sm:text-sm leading-[1.85] text-secondary-foreground border border-input rounded-[var(--radius-md)] focus-within:ring-2 focus-within:ring-ring"
      />
      {wlPopup && view && (
        <WikilinkPopup
          popup={wlPopup}
          roots={roots}
          view={view}
          onClose={closePopup}
        />
      )}
    </>
  )
}
