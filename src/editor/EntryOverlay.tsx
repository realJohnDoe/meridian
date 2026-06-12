import { useMemo } from 'react'
import { useStore } from '../store'
import { useEntryEditor } from './useEntryEditor'
import { expandRange } from '../model/expansion'
import { fileOccurrenceMap } from '../presentation'
import EditorShell from './EditorShell'
import type { Occurrence, EditScope } from '../types'

const EDIT_SCOPES: EditScope[] = ['single', 'future', 'all', 'add']
export function isEditScope(s: unknown): s is EditScope {
  return typeof s === 'string' && (EDIT_SCOPES as string[]).includes(s)
}

interface Props {
  editor: string
  edate?: string
  escope?: EditScope
  etitle?: string
}

function OverlayInner({ editor, edate, escope, etitle }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const occ = useMemo((): Occurrence | null => {
    if (editor === 'new') return null
    if (edate) {
      const d = new Date(edate + 'T00:00:00')
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const found = expandRange(items, roots, d, next).find(o => o.fileSlug === editor)
      if (found) return found
    }
    return fileOccurrenceMap(items, roots).get(editor) ?? null
  }, [items, roots, editor, edate])

  const hooks = useEntryEditor(occ, escope ?? (editor === 'new' ? 'all' : 'single'), etitle)
  return <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
}

export default function EntryOverlay(props: Props) {
  return (
    <div className="entry-overlay">
      <OverlayInner key={`${props.editor}-${props.edate ?? ''}`} {...props} />
    </div>
  )
}
