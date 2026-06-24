import { useMemo } from 'react'
import { useStore } from '@/store'
import { useEntryEditor } from './useEntryEditor'
import { expandRange } from '@/model/expansion'
import EditorShell from './EditorShell'
import type { Occurrence, EditScope } from '@/types'

interface Props {
  editor: string
  edate?: string
  escope?: EditScope
  etitle?: string
}

function OverlayInner({ editor, edate, escope, etitle }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const fom   = useStore(s => s.fom)

  const occ = useMemo((): Occurrence | null => {
    if (editor === 'new') return null
    if (edate) {
      const d = new Date(edate + 'T00:00:00')
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const found = expandRange(items, roots, d, next).find(o => o.fileSlug === editor)
      if (found) return found
    }
    return fom.get(editor) ?? null
  }, [fom, items, roots, editor, edate])

  const hooks = useEntryEditor(occ, escope ?? (editor === 'new' ? 'all' : 'single'), etitle)
  return <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
}

export default function EntryOverlay(props: Props) {
  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col">
      <OverlayInner key={`${props.editor}-${props.edate ?? ''}`} {...props} />
    </div>
  )
}
