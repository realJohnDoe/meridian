import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useStore } from '../store'
import { useEntryEditor } from '../hooks/useEntryEditor'
import { expandRange } from '../model/expansion'
import { fileOccurrenceMap } from '../presentation'
import EditorShell from '../components/EditorShell'
import type { Occurrence, StoreItem, Roots } from '../types'

export const Route = createFileRoute('/entry/$fileSlug')({
  component: EntryPage,
  validateSearch: (search: Record<string, unknown>): { date?: string; scope?: string } => ({
    date:  typeof search.date  === 'string' ? search.date  : undefined,
    scope: typeof search.scope === 'string' ? search.scope : undefined,
  }),
})

function EntryPage() {
  const { fileSlug } = Route.useParams()
  const { date, scope = 'single' } = Route.useSearch()

  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const occ = useMemo((): Occurrence | null => {
    if (date) {
      const d = new Date(date + 'T00:00:00')
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const found = expandRange(items, roots, d, next).find(o => o.fileSlug === fileSlug)
      if (found) return found
    }
    return fileOccurrenceMap(items, roots).get(fileSlug) ?? null
  }, [items, roots, fileSlug, date])

  // Re-mount the editor (and its local state) when navigating between entries.
  return <EditorView key={`${fileSlug}-${date ?? ''}`} occ={occ} scope={scope} items={items} roots={roots} />
}

function EditorView({ occ, scope, items, roots }: {
  occ: Occurrence | null
  scope: string
  items: StoreItem[]
  roots: Roots
}) {
  const hooks = useEntryEditor(occ, scope)
  return <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
}
