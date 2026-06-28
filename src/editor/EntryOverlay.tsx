import { useMemo } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useEntryEditor } from './useEntryEditor'
import { expandRange } from '@/model'
import EditorShell from './EditorShell'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { Occurrence, EditScope } from '@/types'

interface Props {
  editor: string
  edate?: string
  escope?: EditScope
  etitle?: string
}

function LoadingSkeleton() {
  return (
    <>
      <div className="flex items-center gap-2 px-4 h-topbar border-b border-border shrink-0">
        <Skeleton className="h-7 w-7 rounded-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="ml-auto h-7 w-16 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </>
  )
}

function NotFound() {
  const router = useRouter()
  return (
    <div className="flex flex-col px-4 pt-4">
      <Button variant="ghost" size="icon" className="rounded-full text-dim mb-4 self-start" onClick={() => router.history.back()}>
        <ArrowLeft size={18} />
      </Button>
      <p className="text-muted-foreground text-sm">Item not found.</p>
    </div>
  )
}

// Mounted only once a real occurrence is resolved (or for new entries).
// This guarantees useEntryEditor's useState initializer always seeds from real data.
function EditorReady({ occ, editor, escope, etitle }: { occ: Occurrence | null; editor: string; escope?: EditScope; etitle?: string }) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const hooks = useEntryEditor(occ, escope ?? (editor === 'new' ? 'all' : 'single'), etitle)
  return <EditorShell entry={hooks.entry} hooks={hooks} items={items} roots={roots} />
}

function OverlayInner({ editor, edate, escope, etitle }: Props) {
  const items        = useStore(s => s.items)
  const roots        = useStore(s => s.roots)
  const fom          = useStore(s => s.fom)
  const vaultLoading = useStore(s => s.vaultLoading)

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

  if (editor === 'new') return <EditorReady occ={null} editor={editor} escope={escope} etitle={etitle} />
  if (occ)             return <EditorReady occ={occ}  editor={editor} escope={escope} etitle={etitle} />
  if (vaultLoading)    return <LoadingSkeleton />
  return <NotFound />
}

export default function EntryOverlay(props: Props) {
  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col">
      <OverlayInner key={`${props.editor}-${props.edate ?? ''}`} {...props} />
    </div>
  )
}
