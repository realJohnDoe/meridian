import { lazy, Suspense, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useFileOccurrenceMap } from '@/hooks'
import { useEntryEditor } from '@/editor'
import { expandRange } from '@/model'
import { isEditScope } from '@/types'
import { IconButton } from '@/components/primitives/icon-button'
import { EntrySkeleton } from '@/components/primitives/entry-skeleton'
import { EntryTopbar } from './-entryTopbar'
import type { Occurrence, EditScope } from '@/types'

const EntryEditor = lazy(() => import('@/editor').then(m => ({ default: m.EntryEditor })))

export const Route = createFileRoute('/_app/entry/$slug')({
  component: EntrySlugPage,
  validateSearch: (s: Record<string, unknown>): { date?: string; scope?: EditScope } => ({
    date:  typeof s.date  === 'string' ? s.date  : undefined,
    scope: isEditScope(s.scope) ? s.scope : undefined,
  }),
})

function EntryReady({ occ, scope }: { occ: Occurrence; scope?: EditScope }) {
  const items          = useStore(s => s.items)
  const roots          = useStore(s => s.roots)
  const favorites      = useStore(s => s.favorites)
  const toggleFavorite = useStore(s => s.toggleFavorite)

  const isFavorited = favorites.includes(occ.fileSlug)
  const hooks = useEntryEditor(occ, scope ?? 'single')

  return (
    <>
      <EntryTopbar
        isFavorited={isFavorited}
        onToggleFavorite={() => toggleFavorite(occ.fileSlug)}
        onDelete={hooks.handleDelete}
        onBack={hooks.handleClose}
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EntryEditor hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

function EntrySlugPage() {
  const { slug }        = Route.useParams()
  const { date, scope } = Route.useSearch()
  const navigate        = useNavigate()

  const items        = useStore(s => s.items)
  const roots        = useStore(s => s.roots)
  const fom          = useFileOccurrenceMap()
  const vaultLoading = useStore(s => s.vaultLoading)

  const occ = useMemo((): Occurrence | null => {
    if (date) {
      const d = new Date(date + 'T00:00:00')
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const found = expandRange(items, roots, d, next).find(o => o.fileSlug === slug)
      if (found) return found
    }
    return fom.get(slug) ?? null
  }, [fom, items, roots, slug, date])

  if (vaultLoading && !occ) return <EntrySkeleton />
  if (!occ) return (
    <div className="flex flex-col px-3.5 pt-4 lg:max-w-3xl lg:mx-auto w-full">
      <IconButton variant="ghost" className="text-dim mb-4 self-start"
        label="Back to agenda"
        onClick={() => navigate({ to: '/' })}>
        <ArrowLeft size={18} />
      </IconButton>
      <p className="text-muted-foreground text-sm">Item not found.</p>
    </div>
  )

  return <EntryReady key={`${slug}-${date ?? ''}-${scope ?? ''}`} occ={occ} scope={scope} />
}
