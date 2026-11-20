import { useState, startTransition } from 'react'
import { X, ChevronDown } from 'lucide-react'
import type { Occurrence, Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import { parseItemEntry, itemKeys, serializeTaskEntry } from './items'
import { fileOccurrenceMap } from '@/fileOccurrence'
import { useStore } from '@/store'
import { resolveWikilink } from '@/wikilinks'
import { OccurrenceCard, TagChip, FlipList } from '@/components'
import MarkdownTaskCard from './MarkdownTaskCard'
import { isDimmed, priorityRank, occSortKey, compareSortKeys } from '@/calendar'
import type { SortKey } from '@/calendar'
import { occKind } from '@/occView'
import { IconButton } from '@/components/primitives/icon-button'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CollapsibleBody } from '@/components/primitives/collapsible-body'
import { ItemsPicker } from './ItemsPicker'
import { reopenOcc } from '@/occurrenceActions'
import { useFileOccurrenceMap, useLeavingRows } from '@/hooks'
import { CollapseRow } from '@/components/primitives/collapse-row'

interface Props {
  items:           string[]
  onChange:        (items: string[]) => void
  roots:           Roots
  currentKey:      EntryKey | null
  /** Which vault this entry's links resolve in — never crosses a vault boundary. */
  vaultId:         string | null
  onPromote:       (title: string, done: boolean) => string | null
  onOpenWikilink?: (ref: string) => void
  onToggleDone?:   (occ: Occurrence) => void
}

/**
 * The gap between item rows. A plain `gap-1.5` class would do for layout, but
 * a collapsing row has to cancel exactly this much bottom margin on its way out
 * (see CollapseRow), so the value is named once and passed to both rather than
 * written as a utility class here and a matching number there.
 */
const ROW_GAP = '0.375rem'

// `idx` is where the entry sits in `items` — what every mutation below writes
// through. `key` is the row's identity (see itemKeys): the two are deliberately
// separate, because a removal renumbers every later `idx` while leaving each
// row's `key` alone.
type ParsedEntry = ReturnType<typeof parseItemEntry> & { idx: number; key: string }
type Row = { entry: ParsedEntry; occ: Occurrence | undefined }

// Reuses sortOccs' own rule (type, then priority, then time, then title —
// see SortKey in @/calendar) for the rows that resolve to a real occurrence,
// so this list reads by the same logic as every calendar view instead of a
// second, drifting copy of it. The two row shapes sortOccs never has to
// handle get an equivalent key by hand: a plain checklist-text task has no
// priority field of its own to carry — unlike a linked occurrence, which can
// genuinely have no priority *set* — so it's ranked one past
// priorityRank(undefined), sorting past every linked item of its type
// (typeKey 3), no-priority ones included, rather than tying with them and
// falling back to alphabetical order between the two row shapes (bucket
// matches its own done state); a broken link resolves to nothing at all, so
// it gets a bucket of its own past both active and done items.
//
// occSort.ts's shared typeKey groups notes with tasks (both fall to 3) —
// harmless for every calendar view, which pre-filters to a single kind
// before sorting (see UndatedListView), so the two never actually appear
// side by side there. This list is the one place a note-link and a task can
// land in the same sort: without a key of its own, a note would interleave
// with tasks by priority/title (priorityRank(undefined) ties it with every
// no-priority task) instead of reading as its own group. So a linked note
// gets typeKey -1, ahead of every event (0-2) and task (3).
export function rowSortKey({ entry, occ }: Row, now: Date): SortKey {
  if (entry.kind === 'link') {
    if (!occ) return { bucket: 2, typeKey: 0, prioKey: 0, jsTimeMs: 0, title: entry.ref }
    const key = occSortKey(occ, now)
    return occKind(occ) === 'note' ? { ...key, typeKey: -1 } : key
  }
  return { bucket: entry.done ? 1 : 0, typeKey: 3, prioKey: priorityRank(undefined) + 1, jsTimeMs: 0, title: entry.text }
}

export default function ItemsList({ items, onChange, roots, currentKey, vaultId, onPromote, onOpenWikilink, onToggleDone }: Props) {
  // Opened inside a transition so the trigger paints at once while the done rows mount.
  const [doneOpen,    setDoneOpen]    = useState(false)
  const [editingIdx,  setEditingIdx]  = useState<number | null>(null)
  const [editText,    setEditText]    = useState('')

  const occBySlug = useFileOccurrenceMap()
  const backlinks = useStore(s => s.backlinks)

  const parsed = items.map(parseItemEntry)
  const keys = itemKeys(parsed)
  const entries: ParsedEntry[] = parsed.map((entry, idx) => ({ ...entry, idx, key: keys[idx]! }))

  // Files already linked from this entry have no business appearing in "Link
  // file" again — a wikilink's stored ref is always the bare fileSlug (see
  // addLink), so it compares directly against FilePickerEntry.fileSlug.
  const linkedSlugs = new Set(entries.filter(e => e.kind === 'link').map(e => e.ref))

  const sortedRows: Row[] = (() => {
    const rows: Row[] = entries.map(entry => {
      if (entry.kind !== 'link') return { entry, occ: undefined }
      const target = vaultId ? resolveWikilink(entry.ref, roots, vaultId) : undefined
      return { entry, occ: target ? occBySlug.get(target) : undefined }
    })
    const now = new Date()
    const decorated = rows.map(row => ({ row, key: rowSortKey(row, now) }))
    decorated.sort((a, b) => compareSortKeys(a.key, b.key))
    return decorated.map(d => d.row)
  })()

  const toggleTask = (idx: number, text: string, done: boolean, row?: Row) => {
    // Animate out of whichever section it's leaving; commit immediately (optimistic)
    if (row != null) leave(row)
    const next = [...items]
    next[idx] = serializeTaskEntry(text, !done)
    onChange(next)
  }

  const addTask = (text: string) => {
    const t = text.trim()
    if (!t) return
    onChange([...items, serializeTaskEntry(t, false)])
  }

  // A file stores the BARE slug, never the key — the vault is implied by which
  // file the link lives in.
  const addLink = (fileSlug: string) => {
    const stored = `[[${fileSlug}]]`
    if (!items.includes(stored)) {
      onChange([...items, stored])
      // Linking a file whose representative occurrence is done/past runs the
      // same reopen procedure as picking it from the "Done items" group below
      // (redoItem) — the file just arrived via a different entry point.
      const target = vaultId ? resolveWikilink(fileSlug, roots, vaultId) : undefined
      const occ = target ? occBySlug.get(target) : undefined
      if (occ && isDimmed(occ)) reopenOcc(occ)
    }
  }

  // Animate out, exactly as ticking a row done does — a removal is the same
  // shape of change, so it reads the same way instead of snapping out.
  const remove = (row: Row) => {
    leave(row)
    onChange(items.filter((_, i) => i !== row.entry.idx))
  }

  function startEdit(idx: number, text: string) {
    setEditingIdx(idx)
    setEditText(text)
  }

  function commitEdit(idx: number, done: boolean) {
    const t = editText.trim()
    if (t) {
      const next = [...items]
      next[idx] = serializeTaskEntry(t, done)
      onChange(next)
    }
    setEditingIdx(null)
  }

  function promote(idx: number, text: string, done: boolean) {
    const fileSlug = onPromote(text, done)
    if (!fileSlug) return
    const next = [...items]
    next[idx] = `[[${fileSlug}]]`
    onChange(next)
  }

  const isDoneRow = ({ entry, occ }: Row) => {
    if (entry.kind === 'link') return !!occ && isDimmed(occ)
    return entry.done
  }

  const activeRows = sortedRows.filter(r => !isDoneRow(r))
  const doneRows   = sortedRows.filter(r => isDoneRow(r))

  // A row ticked done drops straight out of `activeRows` (and an un-ticked one
  // out of `doneRows`), so it has to be held back here to have anything left to
  // animate. Each list's `rows` has its held ones spliced back where they were,
  // each flagged `leaving`.
  const activeList = useLeavingRows(activeRows, row => row.entry.key)
  const doneList   = useLeavingRows(doneRows,   row => row.entry.key)
  const leave = (row: Row) => (isDoneRow(row) ? doneList : activeList).beginLeave(row)

  const redoItem = (row: Row) => {
    const { entry, occ } = row
    if (entry.kind === 'task') {
      toggleTask(entry.idx, entry.text, entry.done, row)
    } else if (occ) {
      reopenOcc(occ)
    }
  }

  function renderRowContent(row: Row) {
    const { entry, occ } = row
    const { idx } = entry

    if (entry.kind === 'link') {
      const listedOn = occ
        ? (backlinks.get(occ.entryKey) ?? [])
            .filter(key => key !== currentKey)
            .map(key => roots.get(key)?.title ?? key)
        : []
      return (
        <>
          <div className="flex-1 min-w-0">
            {occ ? (
              <OccurrenceCard
                occ={occ}
                leadingIcon="both"
                showTime="badge"
                showDate
                showTagsParticipants
                listedOn={listedOn}
                onOpen={() => onOpenWikilink?.(occ.metadata.fileSlug)}
                onToggleDone={() => {
                  onToggleDone?.(occ)
                  // A wikilink row represents a *file*, not one occurrence — for
                  // a recurring series, checking off today's occurrence doesn't
                  // empty the row, it re-resolves to the series' next open one
                  // (see fileOccurrenceMap's resolveOneKey). Animating an exit
                  // in that case would fade a stale copy over a row that's
                  // still there, just showing a different date. Only animate
                  // when the file's representative occurrence actually changed
                  // section — read post-toggle via the store directly, since the
                  // occBySlug this render closed over is the pre-toggle value.
                  const fresh = fileOccurrenceMap(useStore.getState().entries, roots).get(occ.entryKey)
                  if (!fresh || isDimmed(fresh) !== isDoneRow(row)) leave(row)
                }}
                animate={false}
              />
            ) : (
              <TagChip label={entry.ref} isTopic className="opacity-50 line-through" />
            )}
          </div>
          <IconButton
            label="Remove"
            className="mt-2.5 p-1 text-muted-foreground hover:text-foreground"
            onClick={() => remove(row)}
          >
            <X size={13} />
          </IconButton>
        </>
      )
    }

    const { text, done } = entry
    const isEditing = editingIdx === idx
    return (
      <>
        <div className="flex-1 min-w-0">
          <MarkdownTaskCard
            text={text}
            done={done}
            onToggle={() => toggleTask(idx, text, done, row)}
            onPromote={() => promote(idx, text, done)}
            onClickText={isEditing ? undefined : () => startEdit(idx, text)}
            editValue={isEditing ? editText : undefined}
            onEditChange={setEditText}
            onEditCommit={() => commitEdit(idx, done)}
            onEditCancel={() => setEditingIdx(null)}
          />
        </div>
        <IconButton
          label="Remove"
          className="mt-2.5 p-1 text-muted-foreground hover:text-foreground"
          onClick={() => remove(row)}
        >
          <X size={13} />
        </IconButton>
      </>
    )
  }

  // `leaving` rows keep their key and their place, so React reuses the element
  // already on screen and the collapse has a height to transition *from*.
  // A leaving row also drops its `data-item-key`, which takes it out of the
  // FlipList's diff: it is being animated by CSS, not glided.
  function renderRow(row: Row, leaving: boolean, endLeave: (key: string) => void) {
    const { key } = row.entry
    return (
      <CollapseRow
        key={key}
        {...(leaving ? {} : { 'data-item-key': key })}
        collapsed={leaving}
        onCollapsed={() => endLeave(key)}
        gap={ROW_GAP}
      >
        <div className="flex items-start gap-1">
          {renderRowContent(row)}
        </div>
      </CollapseRow>
    )
  }

  function renderSection({ rows, endLeave, anyLeaving }: typeof activeList) {
    return (
      <FlipList items={rows} itemAttr="data-item-key" suspended={anyLeaving}>
        <div className="flex flex-col" style={{ gap: ROW_GAP }}>
          {rows.map(({ item, leaving }) => renderRow(item, leaving, endLeave))}
        </div>
      </FlipList>
    )
  }

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase mb-2.5">Items</div>
      <div className="flex flex-col gap-1.5">
        {/* A leaving row squeezes shut in flow (CollapseRow), which is what
            shrinks the section — no height is measured or pinned. The FlipList
            only glides rows that *move*, and stands down while a collapse is
            running so the two never animate the same rows at once. */}
        {renderSection(activeList)}

        <ItemsPicker
          roots={roots}
          vaultId={vaultId}
          linkedSlugs={linkedSlugs}
          doneItems={doneRows.map(({ entry, occ }) => ({
            key: entry.key,
            label: entry.kind === 'task' ? entry.text : (occ?.metadata.title ?? entry.ref),
          }))}
          onAddTask={addTask}
          onAddLink={addLink}
          onRedo={key => { const row = doneRows.find(r => r.entry.key === key); if (row) redoItem(row) }}
        />

        {doneList.rows.length > 0 && (
          <Collapsible open={doneOpen} onOpenChange={open => startTransition(() => setDoneOpen(open))}>
            <CollapsibleTrigger className="flex items-center gap-1 mt-1 text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
              <ChevronDown size={12} className="transition-transform duration-200" />
              Done · {doneRows.length}
            </CollapsibleTrigger>
            <CollapsibleBody className="pt-1.5">
              {renderSection(doneList)}
            </CollapsibleBody>
          </Collapsible>
        )}
      </div>
    </div>
  )
}
