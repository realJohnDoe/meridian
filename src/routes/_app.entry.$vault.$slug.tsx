import { lazy, Suspense, useMemo } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useFileOccurrenceMap, useEntryAccess } from '@/hooks'
import { useEntryEditor } from '@/editor'
import { expandRange } from '@/model'
import { isEditScope } from '@/types'
import { entryKey as makeEntryKey } from '@/fileIO'
import { IconButton } from '@/components/primitives/icon-button'
import { EntrySkeleton } from '@/components/primitives/entry-skeleton'
import { EntryTopbar } from './-entryTopbar'
import type { Occurrence, EditScope } from '@/types'
import type { VaultRef } from '@/vaultRef'

const EntryEditor = lazy(() => import('@/editor').then(m => ({ default: m.EntryEditor })))
const EntryViewOnly = lazy(() => import('@/editor').then(m => ({ default: m.EntryViewOnly })))

export const Route = createFileRoute('/_app/entry/$vault/$slug')({
  component: EntrySlugPage,
  validateSearch: (s: Record<string, unknown>): { date?: string; scope?: EditScope; id?: string } => ({
    date:  typeof s.date  === 'string' ? s.date  : undefined,
    scope: isEditScope(s.scope) ? s.scope : undefined,
    id:    typeof s.id    === 'string' ? s.id    : undefined,
  }),
})

function EditableEntry({ occ, scope }: { occ: Occurrence; scope?: EditScope }) {
  const items          = useStore(s => s.items)
  const roots          = useStore(s => s.roots)
  const favorites      = useStore(s => s.favorites)
  const toggleFavorite = useStore(s => s.toggleFavorite)

  const isFavorited = favorites.includes(occ.entryKey)
  const hooks = useEntryEditor(occ, scope ?? 'single')

  return (
    <>
      <EntryTopbar
        isFavorited={isFavorited}
        onToggleFavorite={() => toggleFavorite(occ.entryKey)}
        onDelete={hooks.handleDelete}
        onBack={hooks.handleClose}
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EntryEditor hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

// A view-only vault (an iCal subscription) has no source to write back to, so
// there's nothing here that autosaves, deletes, or moves — just the plain
// read view (see EntryViewOnly) and the favorite toggle, which still makes
// sense for a subscribed event. Kept as its own component, not a branch
// inside EditableEntry, so it never calls useEntryEditor's mutator-heavy hook
// at all — see hooks/useEntryAccess.
function ViewOnlyEntry({ occ, vault }: { occ: Occurrence; vault: VaultRef }) {
  const items          = useStore(s => s.items)
  const roots          = useStore(s => s.roots)
  const favorites      = useStore(s => s.favorites)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const router         = useRouter()
  const navigate       = useNavigate()

  const isFavorited = favorites.includes(occ.entryKey)
  const onBack = () => {
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/' })
  }

  return (
    <>
      <EntryTopbar
        isFavorited={isFavorited}
        onToggleFavorite={() => toggleFavorite(occ.entryKey)}
        onBack={onBack}
        hideDelete
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EntryViewOnly occ={occ} vault={vault} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

function EntryReady({ occ, scope }: { occ: Occurrence; scope?: EditScope }) {
  const access = useEntryAccess(occ)
  if (access.mode === 'view-only') return <ViewOnlyEntry occ={occ} vault={access.vault} />
  return <EditableEntry occ={occ} scope={scope} />
}

function EntrySlugPage() {
  const { vault, slug }  = Route.useParams()
  const { date, scope, id } = Route.useSearch()
  const navigate         = useNavigate()

  const items        = useStore(s => s.items)
  const roots        = useStore(s => s.roots)
  const fom          = useFileOccurrenceMap()
  const vaultLoading = useStore(s => s.vaultLoading)

  // The URL's two segments recomposed into the identity the store is keyed by.
  const entryKey = makeEntryKey(vault, slug)

  const occ = useMemo((): Occurrence | null => {
    if (date) {
      const d = new Date(date + 'T00:00:00')
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const candidates = expandRange(items, roots, d, next).filter(o => o.entryKey === entryKey)
      // Two occurrences of the same file can land on the same date (e.g. two
      // override instances with no time) — `id` picks the exact one that was
      // opened; without it (older links, or none matching) fall back to the
      // first candidate, same as before `id` existed.
      const found = (id ? candidates.find(o => o.id === id) : undefined) ?? candidates[0]
      if (found) return found
    }
    return fom.get(entryKey) ?? null
  }, [fom, items, roots, entryKey, date, id])

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

  return <EntryReady key={`${entryKey}-${date ?? ''}-${id ?? ''}-${scope ?? ''}`} occ={occ} scope={scope} />
}
