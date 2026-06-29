import { lazy, Suspense, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createFileRoute, useRouter, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useEntryEditor } from '@/editor/useEntryEditor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTopbarSlot } from './-topbarSlot'

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

export const Route = createFileRoute('/_app/entry/new')({
  component: NewEntryPage,
  validateSearch: (s: Record<string, unknown>): { title?: string } => ({
    title: typeof s.title === 'string' ? s.title : undefined,
  }),
})

function NewEntryTopbar({ title, onClose }: { title: string; onClose: () => void }) {
  const slotEl = useTopbarSlot()
  if (!slotEl) return null
  return createPortal(
    <div className="flex items-center gap-2 w-full lg:max-w-[720px] lg:mx-auto px-3.5">
      <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0" onClick={onClose}>
        <ArrowLeft size={18} />
      </Button>
      <span className="flex-1 font-[family-name:var(--disp)] italic text-sm text-foreground truncate">
        {title || 'New entry'}
      </span>
    </div>,
    slotEl,
  )
}

function NewEntryReady({ title }: { title?: string }) {
  const items  = useStore(s => s.items)
  const roots  = useStore(s => s.roots)
  const router = useRouter()
  const navigate = useNavigate()

  const handleClose = () => {
    if (window.history.length > 1) router.history.back()
    else navigate({ to: '/' })
  }

  const hooks = useEntryEditor(null, 'all', title)

  return (
    <>
      <NewEntryTopbar title={hooks.entry.title} onClose={handleClose} />
      <Suspense fallback={<EntrySkeleton />}>
        <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

function NewEntryPage() {
  const { title } = Route.useSearch()
  // Stable key so the entry doesn't reset if search params change
  const key = useMemo(() => `new-${title ?? ''}`, [])  // eslint-disable-line react-hooks/exhaustive-deps
  return <NewEntryReady key={key} title={title} />
}
