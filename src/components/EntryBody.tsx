import type React from 'react'
import KindIcon from './KindIcon'
import type { Roots, StoreItem } from '../types'
import { isSeries } from '../types'
import { useWikilinkAutocomplete } from '../hooks/useWikilinkAutocomplete'

interface Props {
  bodyRef: React.RefObject<HTMLDivElement | null>
  bodyKey: string
  roots:   Roots
  items:   StoreItem[]
}

export default function EntryBody({ bodyRef, bodyKey, roots, items }: Props) {
  const { wlOpen, wlPopupPos, wlMatches, wlFocusIdx, handleBodyInput, handleBodyKeyDown, insertWikilink } =
    useWikilinkAutocomplete(bodyRef, roots, items)

  return (
    <>
      <div
        key={bodyKey}
        ref={bodyRef}
        className="entry-body"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={handleBodyInput}
        onKeyDown={handleBodyKeyDown}
      />

      {wlOpen && wlPopupPos && (
        <div className="wl-popup show" style={{ top: wlPopupPos.top, left: wlPopupPos.left }}>
          {wlMatches.map((t, i) => {
            const rootFileSlug = [...roots.entries()].find(([, r]) => r.title === t)?.[0]
            const matchItem = rootFileSlug ? items.find(it => it.fileSlug === rootFileSlug && !isSeries(it)) : undefined
            return (
              <div
                key={t}
                className={`wl-item${i === wlFocusIdx ? ' focused' : ''}`}
                onMouseDown={e => { e.preventDefault(); insertWikilink(t) }}
              >
                <KindIcon item={matchItem} size={13} />
                {t}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
