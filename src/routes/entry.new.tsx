import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '../store'
import { useEntryEditor } from '../hooks/useEntryEditor'
import EditorShell from '../components/EditorShell'

export const Route = createFileRoute('/entry/new')({
  component: NewEntryPage,
  validateSearch: (search: Record<string, unknown>): { title?: string } => ({
    title: typeof search.title === 'string' ? search.title : undefined,
  }),
})

function NewEntryPage() {
  const { title } = Route.useSearch()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const hooks = useEntryEditor(null, 'all')

  // Prefill title on first render (entry.title is empty until user types)
  const entry = title && !hooks.entry.title ? { ...hooks.entry, title } : hooks.entry

  return <EditorShell entry={entry} hooks={hooks} items={items} roots={roots} />
}
