import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import type { Roots } from '@/types'
import { OccurrenceCard } from '@/components'
import { fileEntries } from '@/fileOccurrence'
import { useStore } from '@/store'
import { useResetOnChange, useVisualViewportHeight, useVisualViewportOffsetTop } from '@/hooks'
import { cn } from '@/lib/cn'

export interface WlPopupState {
  query:  string
  from:   number  // doc position of opening [[
  coords: { top: number; bottom: number; left: number; right: number }
}

interface Props {
  popup:   WlPopupState
  roots:   Roots
  view:    EditorView
  onClose: () => void
}

interface Placement {
  left:     number
  maxWidth: number
  top?:     number
  bottom?:  number
}

const MARGIN = 8
const GAP = 6

export default function WikilinkPopup({ popup, roots, view, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState(0)
  const popupRef = useRef<HTMLDivElement>(null)

  const occBySlug = useStore(s => s.fom)

  const q = popup.query.toLowerCase()
  // Memoized so the array reference is stable across renders when roots/query
  // haven't changed — otherwise useResetOnChange below sees a "new" array on
  // every render and setFocusIdx loops forever (React error #301).
  const matches = useMemo(
    () => fileEntries(roots).filter(e => !q || e.title.toLowerCase().includes(q)).slice(0, 8),
    [roots, q],
  )

  useResetOnChange([matches], () => setFocusIdx(0))

  function insertWikilink(title: string) {
    const to = view.state.selection.main.head
    view.dispatch({
      changes: { from: popup.from, to, insert: `[[${title}]]` },
      selection: { anchor: popup.from + title.length + 4 },
    })
    view.focus()
    onClose()
  }

  // Intercept arrow/enter/escape in capture phase so CM6 doesn't consume them
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation()
        setFocusIdx(i => Math.min(i + 1, matches.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        setFocusIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const m = matches[focusIdx]
        if (m) { e.preventDefault(); e.stopPropagation(); insertWikilink(m.title) }
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); onClose()
      }
    }
    view.contentDOM.addEventListener('keydown', handler, true)
    return () => view.contentDOM.removeEventListener('keydown', handler, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, focusIdx, view, popup.from])

  // Close on click outside the popup
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.wl-popup')) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Keep the popup inside the viewport: open below the cursor by default,
  // flip above when there isn't room, and clamp horizontally so it never
  // runs off the right edge. Mirrors useFloatingCombobox's flip/clamp
  // approach, anchored to a point (the cursor coords) instead of an element.
  const viewportHeight    = useVisualViewportHeight()
  const viewportOffsetTop = useVisualViewportOffsetTop()
  const [placement, setPlacement] = useState<Placement>(() => ({
    left:     Math.max(MARGIN, popup.coords.left),
    top:      popup.coords.bottom + GAP,
    maxWidth: window.innerWidth - MARGIN * 2,
  }))

  useLayoutEffect(() => {
    const el = popupRef.current
    if (!el) return
    function recompute() {
      const rect = el!.getBoundingClientRect()
      const visibleTop    = viewportOffsetTop ?? 0
      const visibleBottom = visibleTop + (viewportHeight ?? window.innerHeight)

      const left = Math.min(
        Math.max(MARGIN, popup.coords.left),
        Math.max(MARGIN, window.innerWidth - MARGIN - rect.width),
      )

      const spaceBelow = visibleBottom - popup.coords.bottom - GAP
      const spaceAbove = popup.coords.top - visibleTop - GAP
      const opensBelow = spaceBelow >= rect.height || spaceBelow >= spaceAbove

      setPlacement({
        left,
        maxWidth: window.innerWidth - MARGIN * 2,
        ...(opensBelow
          ? { top: popup.coords.bottom + GAP }
          : { bottom: window.innerHeight - popup.coords.top + GAP }),
      })
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    window.addEventListener('resize', recompute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [popup.coords.top, popup.coords.bottom, popup.coords.left, viewportHeight, viewportOffsetTop])

  const style = {
    position: 'fixed' as const,
    zIndex: 45,
    ...placement,
  }

  return createPortal(
    // onMouseDown preventDefault keeps focus in the editor while clicking a card
    <div
      ref={popupRef}
      role="listbox"
      aria-label="Wikilink suggestions"
      // Not in the tab order — arrow-key navigation is handled globally via
      // the CodeMirror contentDOM listener above, so the popup itself never
      // needs to receive focus directly.
      tabIndex={-1}
      className="wl-popup flex flex-col gap-1 p-1.5 bg-popover border border-input rounded-[var(--radius)] shadow-[0_8px_32px_rgba(0,0,0,.4)] min-w-64 max-h-96 overflow-y-auto"
      style={style}
      onMouseDown={e => e.preventDefault()}
    >
      {matches.length === 0 && (
        <div className="px-3.5 py-2 text-sm text-muted-foreground">No matches</div>
      )}
      {matches.map((e, i) => {
        const occ = occBySlug.get(e.fileSlug)
        const isFocused = i === focusIdx
        const wrapCls = `rounded-lg transition-colors ${isFocused ? 'ring-2 ring-ring ring-offset-0' : ''}`
        return occ ? (
          <div key={e.fileSlug} className={wrapCls} onMouseEnter={() => setFocusIdx(i)}>
            <OccurrenceCard
              occ={occ}
              leadingIcon="kind"
              showTime="none"
              showTagsParticipants={false}
              onOpen={() => insertWikilink(e.title)}
              onToggleDone={() => {}}
            />
          </div>
        ) : (
          <button
            key={e.fileSlug}
            type="button"
            role="option"
            aria-selected={isFocused}
            tabIndex={-1}
            className={cn('w-full text-left px-3.5 py-2 text-sm text-secondary-foreground cursor-pointer rounded-md hover:bg-accent', isFocused && 'bg-accent')}
            onMouseDown={() => insertWikilink(e.title)}
            onMouseEnter={() => setFocusIdx(i)}
          >
            {e.title}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
