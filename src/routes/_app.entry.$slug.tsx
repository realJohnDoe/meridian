import { lazy, Suspense, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createFileRoute, useRouter, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Heart, Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import { useEntryEditor } from '@/editor/useEntryEditor'
import { expandRange } from '@/model'
import { isEditScope } from '@/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'
import { useTopbarSlot } from './-topbarSlot'
import type { Occurrence, EditScope } from '@/types'

const EditorShell = lazy(() => import('@/editor').then(m => ({ default: m.EditorShell })))

function EntrySkeleton() {
  return (
    <div className="flex-1 flex flex-col gap-3 px-3.5 pt-5 lg:max-w-[720px] lg:mx-auto w-full">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}

export const Route = createFileRoute('/_app/entry/$slug')({
  component: EntrySlugPage,
  validateSearch: (s: Record<string, unknown>): { date?: string; scope?: EditScope } => ({
    date:  typeof s.date  === 'string' ? s.date  : undefined,
    scope: isEditScope(s.scope) ? s.scope : undefined,
  }),
})

interface TopbarProps {
  title: string
  isFavorited: boolean
  onClose: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}

function EntryTopbar({ title, isFavorited, onClose, onToggleFavorite, onDelete }: TopbarProps) {
  const slotEl = useTopbarSlot()
  if (!slotEl) return null
  return createPortal(
    <div className="flex items-center gap-2 w-full lg:max-w-[720px] lg:mx-auto px-3.5">
      <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={onClose}>
        <ArrowLeft size={18} />
      </Button>
      <span className="flex-1 font-[family-name:var(--disp)] italic text-sm text-foreground truncate">
        {title}
      </span>
      <Button
        variant="ghost" size="icon"
        className={cn('rounded-full shrink-0', isFavorited ? 'text-rose-400' : 'text-dim')}
        onClick={onToggleFavorite}
        title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={18} className={isFavorited ? 'fill-current' : ''} />
      </Button>
      <Button variant="ghost" size="icon" className="rounded-full shrink-0 text-destructive" onClick={onDelete} title="Delete">
        <Trash2 size={18} />
      </Button>
    </div>,
    slotEl,
  )
}

function EntryReady({ occ, scope }: { occ: Occurrence; scope?: EditScope }) {
  const items         = useStore(s => s.items)
  const roots         = useStore(s => s.roots)
  const favorites     = useStore(s => s.favorites)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const router        = useRouter()
  const navigate      = useNavigate()

  const isFavorited = favorites.includes(occ.fileSlug)
  const handleClose = () => {
    if (window.history.length > 1) router.history.back()
    else navigate({ to: '/' })
  }

  const hooks = useEntryEditor(occ, scope ?? 'single')

  return (
    <>
      <EntryTopbar
        title={hooks.entry.title}
        isFavorited={isFavorited}
        onClose={handleClose}
        onToggleFavorite={() => toggleFavorite(occ.fileSlug)}
        onDelete={hooks.handleDelete}
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

function EntrySlugPage() {
  const { slug }              = Route.useParams()
  const { date, scope }       = Route.useSearch()
  const navigate              = useNavigate()

  const items        = useStore(s => s.items)
  const roots        = useStore(s => s.roots)
  const fom          = useStore(s => s.fom)
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
    <div className="flex flex-col px-3.5 pt-4 lg:max-w-[720px] lg:mx-auto w-full">
      <Button variant="ghost" size="icon" className="rounded-full text-dim mb-4 self-start"
        onClick={() => { if (window.history.length > 1) navigate({ to: '/' }); else navigate({ to: '/' }) }}>
        <ArrowLeft size={18} />
      </Button>
      <p className="text-muted-foreground text-sm">Item not found.</p>
    </div>
  )

  return <EntryReady key={`${slug}-${date ?? ''}-${scope ?? ''}`} occ={occ} scope={scope} />
}
