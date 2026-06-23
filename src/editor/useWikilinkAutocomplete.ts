import { useState, useCallback, useEffect } from 'react'
import type { Roots, StoreItem } from '@/types'
import { fileEntries } from '@/fileOccurrence'

interface WlPopupPos { top: number; left: number }

export function useWikilinkAutocomplete(
  bodyRef: React.RefObject<HTMLDivElement | null>,
  roots: Roots,
  _items: StoreItem[],
) {
  const [wlMatches,  setWlMatches]  = useState<string[]>([])
  const [wlFocusIdx, setWlFocusIdx] = useState(-1)
  const [wlPopupPos, setWlPopupPos] = useState<WlPopupPos | null>(null)
  const wlOpen = wlMatches.length > 0 && wlPopupPos !== null

  const closeWlPopup = useCallback(() => {
    setWlMatches([])
    setWlPopupPos(null)
  }, [])

  useEffect(() => {
    if (!wlOpen) return
    const handler = (e: MouseEvent) => {
      if (!bodyRef.current?.contains(e.target as Node)) closeWlPopup()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [wlOpen, closeWlPopup, bodyRef])

  const insertWikilink = useCallback((title: string) => {
    closeWlPopup()
    const sel = window.getSelection()
    if (!sel?.rangeCount || !bodyRef.current) return
    const range = sel.getRangeAt(0)
    const preRange = document.createRange()
    preRange.setStart(bodyRef.current, 0)
    try { preRange.setEnd(range.startContainer, range.startOffset) } catch { return }
    const before = preRange.toString()
    if (before.lastIndexOf('[[') === -1) return
    const textNode = range.startContainer
    const pos = range.startOffset
    const fullText = textNode.textContent ?? ''
    const localOpen = fullText.lastIndexOf('[[', pos - 1)
    if (localOpen === -1) return
    textNode.textContent = fullText.slice(0, localOpen) + '[[' + title + ']]' + fullText.slice(pos)
    const newPos = localOpen + title.length + 4
    const newRange = document.createRange()
    newRange.setStart(textNode, Math.min(newPos, (textNode.textContent ?? '').length))
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }, [closeWlPopup, bodyRef])

  function handleBodyInput() {
    if (!bodyRef.current) return
    const sel = window.getSelection()
    if (!sel?.rangeCount) { closeWlPopup(); return }
    const range = sel.getRangeAt(0)
    if (!bodyRef.current.contains(range.startContainer)) { closeWlPopup(); return }
    const preRange = document.createRange()
    preRange.setStart(bodyRef.current, 0)
    try { preRange.setEnd(range.startContainer, range.startOffset) } catch { closeWlPopup(); return }
    const before = preRange.toString()
    const m = before.match(/\[\[([^\]\n]*)$/)
    if (m) {
      const q = m[1].toLowerCase()
      const allTitles = fileEntries(roots).map(e => e.title)
      const matches = q
        ? allTitles.filter(t => t.toLowerCase().includes(q)).slice(0, 8)
        : allTitles.slice(0, 8)
      if (matches.length) {
        setWlMatches(matches)
        setWlFocusIdx(-1)
        const rect = range.getBoundingClientRect()
        setWlPopupPos({ top: rect.bottom + 6, left: Math.max(8, rect.left) })
        return
      }
    }
    closeWlPopup()
  }

  function handleBodyKeyDown(e: React.KeyboardEvent) {
    if (!wlOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setWlFocusIdx(i => Math.min(i + 1, wlMatches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setWlFocusIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && wlFocusIdx >= 0) {
      e.preventDefault()
      insertWikilink(wlMatches[wlFocusIdx])
    } else if (e.key === 'Escape') {
      closeWlPopup()
    }
  }

  return { wlOpen, wlPopupPos, wlMatches, wlFocusIdx, handleBodyInput, handleBodyKeyDown, insertWikilink }
}
