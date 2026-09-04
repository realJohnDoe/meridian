import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useStore } from '@/store'
import { useEntryEditor } from '@/editor'
import { draftEntryKey } from '@/model'
import { EntrySkeleton } from '@/components/primitives/entry-skeleton'
import { titleToSlug, entryKey as makeEntryKey } from '@/fileIO'
import { keyRoute } from '@/entryRoute'
import { EntryTopbar } from './-entryTopbar'

const EntryEditor = lazy(() => import('@/editor').then(m => ({ default: m.EntryEditor })))

type ItemTypeSearch = 'task' | 'event' | 'note'
const ITEM_TYPES: ItemTypeSearch[] = ['task', 'event', 'note']

interface NewEntrySearch {
  title?: string
  date?: string
  time?: string
  duration?: string
  itemType?: ItemTypeSearch
  /** Which vault to create in, overriding `defaultVaultId`. */
  vault?: string
}

export const Route = createFileRoute('/_entry/entry/new')({
  component: NewEntryPage,
  validateSearch: (s: Record<string, unknown>): NewEntrySearch => ({
    title: typeof s.title === 'string' ? s.title : undefined,
    date: typeof s.date === 'string' ? s.date : undefined,
    time: typeof s.time === 'string' ? s.time : undefined,
    duration: typeof s.duration === 'string' ? s.duration : undefined,
    itemType: ITEM_TYPES.includes(s.itemType as ItemTypeSearch) ? (s.itemType as ItemTypeSearch) : undefined,
    vault: typeof s.vault === 'string' ? s.vault : undefined,
  }),
})

function NewEntryReady({ draftId, title, date, time, duration, itemType, vault }: NewEntrySearch & { draftId: string }) {
  const items          = useStore(s => s.items)
  const roots          = useStore(s => s.roots)
  const favorites      = useStore(s => s.favorites)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const hooks = useEntryEditor(null, 'all', title, { date, time, duration, itemType, vault }, draftId)

  // A brand-new item has no file yet, but once it has a title its eventual key is
  // predictable, so favoriting can target it immediately rather than waiting for
  // autosave. `titleToSlug` is only the estimate — once the first save has landed,
  // `createdKey` is the key the file actually got (they differ when the title
  // slugifies onto one another file already owns).
  const estimatedKey = hooks.vaultId && hooks.entry.title
    ? makeEntryKey(hooks.vaultId, titleToSlug(hooks.entry.title))
    : null
  const effectiveKey = hooks.entry.item?.entryKey ?? hooks.createdKey ?? estimatedKey
  const isFavorited = !!effectiveKey && favorites.includes(effectiveKey)

  return (
    <>
      <EntryTopbar
        isFavorited={isFavorited}
        onToggleFavorite={effectiveKey ? () => toggleFavorite(effectiveKey) : null}
        onDelete={hooks.handleDelete}
        onBack={hooks.handleClose}
      />
      <Suspense fallback={<EntrySkeleton />}>
        <EntryEditor hooks={hooks} items={items} roots={roots} />
      </Suspense>
    </>
  )
}

/**
 * The editor for a draft that has no file yet — or a redirect to the file it
 * already made.
 *
 * Mounted only once the vaults have finished loading, so both halves have the
 * whole store to answer against: `draftEntryKey` can see the file a previous
 * visit to this same history entry created, and the editor's first save can
 * see every slug that is already taken.
 *
 * The resume check is a mount-time question, not a live one. Within a session
 * this draft *does* acquire a file, and redirecting the moment it does is
 * exactly what the editor stopped doing — it tore down the open dialog under
 * the user (see createdItemRef in useEntryEditor). Coming back to it later is
 * the other case, and the one that used to leave a second file behind.
 */
function NewEntryDraft({ draftId, search }: { draftId: string; search: NewEntrySearch }) {
  const [resumeKey] = useState(() => draftEntryKey(useStore.getState().entries, draftId))
  const navigate = useNavigate()

  useEffect(() => {
    // `replace`, so Back skips the /entry/new URL this draft has outgrown
    // instead of bouncing straight back here.
    if (resumeKey) void navigate({ ...keyRoute(resumeKey), replace: true })
  }, [resumeKey, navigate])

  // Frozen at mount: the editor holds the title in its own state from here on,
  // so a later change to the `title` search param must not remount it and
  // throw away what has been typed since.
  const key = useMemo(() => `new-${search.title ?? ''}`, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (resumeKey) return <EntrySkeleton />
  return <NewEntryReady key={key} draftId={draftId} {...search} />
}

function NewEntryPage() {
  const search = Route.useSearch()
  const vaultLoading = useStore(s => s.vaultLoading)

  // One history entry, one draft. TanStack stamps `__TSR_key` on the history
  // entry it pushes, and the browser hands the same one back when the user
  // returns to it — by Back, or by reloading the page. Deriving the draft id
  // from it is what makes coming back here *resume* this draft: without it
  // every remount minted a fresh id, the file the draft already created looked
  // like an unrelated file sitting on the slug, and the editor dutifully
  // created a second one beside it (`buy-milk-2`) carrying none of the edits
  // that had landed on the first.
  const historyKey = useRouterState({ select: s => s.location.state.__TSR_key })
  const [draftId] = useState(() => historyKey ?? crypto.randomUUID())

  // Vaults are still parsing: there is nothing to resume from yet, and a save
  // landing now could take a slug a file that hasn't been read owns.
  if (vaultLoading) return <EntrySkeleton />
  return <NewEntryDraft draftId={draftId} search={search} />
}
