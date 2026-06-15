import type React from 'react'
import KindIcon from '@/components/KindIcon'
import type { Roots, StoreItem } from '../types'
import { isSeries } from '../types'
import { useWikilinkAutocomplete } from './useWikilinkAutocomplete'
import { cn } from '@/lib/utils'

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
        data-placeholder="Add a description…"
        className={[
          'min-h-40 text-secondary-foreground text-sm leading-[1.85] outline-none caret-primary',
          'whitespace-pre-wrap break-words relative',
          'rounded-md border border-input bg-transparent px-3 py-2',
          'focus:ring-2 focus:ring-ring focus:ring-offset-0',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none',
          '[&_.wl]:text-primary [&_.wl]:border-b [&_.wl]:border-[var(--event-border)] [&_.wl]:cursor-pointer',
          '[&_.wl-broken]:text-destructive [&_.wl-broken]:border-b [&_.wl-broken]:border-[color-mix(in_oklab,var(--destructive),transparent_70%)]',
        ].join(' ')}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={handleBodyInput}
        onKeyDown={handleBodyKeyDown}
      />

      {wlOpen && wlPopupPos && (
        <div
          className="fixed bg-popover border border-input rounded-[var(--radius)] shadow-[0_8px_32px_rgba(0,0,0,.4)] z-[45] min-w-[210px] max-h-[200px] overflow-y-auto"
          style={{ top: wlPopupPos.top, left: wlPopupPos.left }}
        >
          {wlMatches.map((t, i) => {
            const rootFileSlug = [...roots.entries()].find(([, r]) => r.title === t)?.[0]
            const matchItem = rootFileSlug ? items.find(it => it.fileSlug === rootFileSlug && !isSeries(it)) : undefined
            return (
              <div
                key={t}
                className={cn(
                  'px-3.5 py-2 cursor-pointer text-sm text-secondary-foreground transition-colors flex items-center gap-2 hover:bg-accent',
                  i === wlFocusIdx && 'bg-accent',
                )}
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
