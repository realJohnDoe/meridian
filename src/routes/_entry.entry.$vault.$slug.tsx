import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useFileOccurrenceMap, useEntryAccess } from '@/hooks'
import { useEntryEditor } from '@/editor'
import { expandRange, firstOccurrenceFrom } from '@/model'
import { isEditScope, isSeries } from '@/types'
import { entryKey as makeEntryKey } from '@/fileIO'
import { entryRoute } from '@/entryRoute'
import { IconButton } from '@/components/primitives/icon-button'
import { EntrySkeleton } from '@/components/primitives/entry-skeleton'
import { EntryTopbar } from './-entryTopbar'
import type { Occurrence, EditScope, StoreItem, Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import type { VaultRef } from '@/vaultRef'

const EntryEditor = lazy(() => import('@/editor').then(m => ({ default: m.EntryEditor })))
const EntryViewOnly = lazy(() => import('@/editor').then(m => ({ default: m.EntryViewOnly })))

export const Route = createFileRoute('/_entry/entry/$vault/$slug')({
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

/** `entryKey`'s occurrences on `date`. */
function occurrencesOn(items: StoreItem[], roots: Roots, entryKey: EntryKey, date: string): Occurrence[] {
  const d = new Date(date + 'T00:00:00')
  const next = new Date(d); next.setDate(next.getDate() + 1)
  return expandRange(items, roots, d, next).filter(o => o.entryKey === entryKey)
}

/** `entryKey`'s first occurrence on or after `date`, looking up to a year ahead. */
function firstFrom(items: StoreItem[], roots: Roots, entryKey: EntryKey, date: string): Occurrence | undefined {
  const from = new Date(date + 'T00:00:00')
  const horizon = new Date(from); horizon.setFullYear(from.getFullYear() + 1)
  return firstOccurrenceFrom(items.filter(i => i.entryKey === entryKey), roots, from, horizon, () => true) ?? undefined
}

/**
 * The occurrence `id` names, wherever it sits now. A move keeps the id but not
 * the date (`applySingle`), so a stored row's own date wins over `date`, which
 * is only where the occurrence was when someone last looked.
 */
function occurrenceById(items: StoreItem[], roots: Roots, entryKey: EntryKey, id: string, date: string | undefined): Occurrence | undefined {
  const stored = items.find(i => !isSeries(i) && i.entryKey === entryKey && i.id === id && !i.excluded)
  const day = stored?.date || date
  return day ? occurrencesOn(items, roots, entryKey, day).find(o => o.id === id) : undefined
}

/**
 * Pins the occurrence the URL resolved to on mount, and from then on follows
 * *that* occurrence by id — never re-asks the URL.
 *
 * Re-asking is what made the editor wander: the URL's answer changes under it
 * on an ordinary edit. With no date in the URL it is the file's representative
 * occurrence (the earliest open one), so ticking that one done moved the
 * editor on to the next; with a date, moving the occurrence left the URL
 * pointing at an empty day. Either way the editor's next save went to an
 * occurrence the user never opened. The live re-read keeps `ownerId`, the date
 * and `source` current, which the save path keys off.
 */
function EntryReady({ occ: resolved, scope }: { occ: Occurrence; scope?: EditScope }) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const [pinned, setPinned] = useState(resolved)
  const occ = useMemo(
    () => occurrenceById(items, roots, pinned.entryKey, pinned.id, pinned.date)
      // The id itself can go: re-reading the file (a sync, another tab)
      // derives ids afresh, and a 'future' split re-keys the occurrences it
      // takes over — onto a later date, when the new rule doesn't produce this
      // one. The next occurrence from where it was last seen is what took its place.
      ?? (pinned.date ? firstFrom(items, roots, pinned.entryKey, pinned.date) : undefined)
      ?? pinned,
    [items, roots, pinned],
  )
  // Follow it under its new id from here on, or the next move loses it.
  if (occ.id !== pinned.id) setPinned(occ)
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
    // `id` picks the exact occurrence that was opened — two of the same file can
    // share a date, and one moved since the link was made is no longer on it.
    // Without a match (older links, or a file re-read since) fall back to the
    // first one on the date.
    const byId = id ? occurrenceById(items, roots, entryKey, id, date) : undefined
    return byId ?? (date ? occurrencesOn(items, roots, entryKey, date)[0] : undefined) ?? fom.get(entryKey) ?? null
  }, [fom, items, roots, entryKey, date, id])

  // A URL that names no occurrence gets the one it resolved to written in, so
  // Back and reload return to it rather than to whichever occurrence is the
  // file's representative by then (ticking this one done changes that).
  useEffect(() => {
    if (occ?.date && !date) void navigate({ ...entryRoute(occ, scope), replace: true })
  }, [occ, date, scope, navigate])

  if (vaultLoading && !occ) return <EntrySkeleton />
  if (!occ) return (
    <div className="flex flex-col px-3.5 pt-4 lg:max-w-3xl lg:mx-auto w-full">
      <IconButton variant="ghost" className="text-muted-foreground mb-4 self-start"
        label="Back to agenda"
        onClick={() => navigate({ to: '/' })}>
        <ArrowLeft size={18} />
      </IconButton>
      <p className="text-muted-foreground text-sm">Item not found.</p>
    </div>
  )

  // Keyed by what the URL resolved to, not by its raw params, so the rewrite
  // above — same occurrence, now spelled out — doesn't remount the editor.
  return <EntryReady key={`${entryKey}-${date ?? occ.date}-${id ?? occ.id}-${scope ?? 'single'}`} occ={occ} scope={scope} />
}
