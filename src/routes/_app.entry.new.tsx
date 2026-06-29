import { lazy, Suspense, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createFileRoute } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useStore } from '@/store'
import { useEntryEditor } from '@/editor/useEntryEditor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSidebar } from '@/components/ui/sidebar'
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

function NewEntryTopbar({ title, onSave }: { title: string; onSave: () => void }) {
  const slotEl = useTopbarSlot()
  const { setOpenMobile, isMobile } = useSidebar()
  if (!slotEl) return null
  return createPortal(
    <div className="flex items-center gap-1 w-full lg:max-w-[720px] lg:mx-auto px-3.5">
      {isMobile && (
        <Button variant="ghost" size="icon" className="rounded-full text-dim shrink-0 md:hidden" onClick={() => setOpenMobile(true)} title="Menu">
          <Menu size={18} />
        </Button>
      )}
      <span className="flex-1 font-[family-name:var(--disp)] italic text-base text-foreground truncate min-w-0">
        {title || 'New entry'}
      </span>
      <Button variant="default" size="sm" onClick={onSave}>Save</Button>
    </div>,
    slotEl,
  )
}

function NewEntryReady({ title }: { title?: string }) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const hooks = useEntryEditor(null, 'all', title)

  return (
    <>
      <NewEntryTopbar
        title={hooks.entry.title}
        onSave={() => hooks.triggerSaveRef.current()}
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

function NewEntryPage() {
  const { title } = Route.useSearch()
  const key = useMemo(() => `new-${title ?? ''}`, [])  // eslint-disable-line react-hooks/exhaustive-deps
  return <NewEntryReady key={key} title={title} />
}
