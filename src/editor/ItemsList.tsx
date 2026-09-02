import { useState } from 'react'
import { Plus, X, Tag, ChevronDown, CircleCheck } from 'lucide-react'
import type { Occurrence, Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import { occKind } from '@/occView'
import { parseItemEntry, serializeTaskEntry } from './items'
import { fileEntries, fileOccurrenceMap } from '@/fileOccurrence'
import { useStore } from '@/store'
import { resolveWikilink } from '@/wikilinks'
import { OccurrenceCard, MarkdownTaskCard, TagChip, FlipList } from '@/components'
import { isDimmed, priorityRank, doneKindOrder } from '@/calendar'
import { IconButton } from '@/components/primitives/icon-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { FloatingComboboxList } from './FloatingComboboxList'
import { reopenOcc } from '@/occurrenceActions'
import { rankByQuery } from '@/lib/matching'
import { useFloatingCombobox, useFileOccurrenceMap, useLeavingRows } from '@/hooks'
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

type ParsedEntry = ReturnType<typeof parseItemEntry> & { idx: number }
type Row = { entry: ParsedEntry; occ: Occurrence | undefined }

// Sort order: notes α → events chronologically → open tasks by priority →
// open string tasks (stored) → done tasks + done string tasks (notes α → events α → tasks α) → broken links (stored)
export function rowSortKey({ entry, occ }: Row): [number, number, string] {
  if (entry.kind === 'link') {
    if (!occ) return [5, entry.idx, '']
    if (isDimmed(occ)) {
      return [4, doneKindOrder(occKind(occ)), occ.metadata.title.toLowerCase()]
    }
    const k = occKind(occ)
    if (k === 'note')  return [0, 0, occ.metadata.title.toLowerCase()]
    if (k === 'event') return [1, occ.metadata.jsTime?.getTime() ?? 0, '']
    // task: sort by priority
    return [2, priorityRank(occ.metadata.priority), occ.metadata.title.toLowerCase()]
  }
  // string task (always kind 'task')
  if (entry.done) return [4, doneKindOrder('task'), entry.text.toLowerCase()]
  return [3, entry.idx, '']
}

export default function ItemsList({ items, onChange, roots, currentKey, vaultId, onPromote, onOpenWikilink, onToggleDone }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [editingIdx,  setEditingIdx]  = useState<number | null>(null)
  const [editText,    setEditText]    = useState('')
  const { anchorRef, listRef, placement } = useFloatingCombobox(pickerOpen, setPickerOpen)

  const occBySlug = useFileOccurrenceMap()
  const backlinks = useStore(s => s.backlinks)

  const entries: ParsedEntry[] = items.map((raw, idx) => ({ ...parseItemEntry(raw), idx }))

  // Files already linked from this entry have no business appearing in "Link
  // file" again — a wikilink's stored ref is always the bare fileSlug (see
  // addLink), so it compares directly against FilePickerEntry.fileSlug.
  const linkedSlugs = new Set(entries.filter(e => e.kind === 'link').map(e => e.ref))
  const allFiles  = fileEntries(roots, vaultId ?? undefined).filter(e => !linkedSlugs.has(e.fileSlug))
  const filtered  = pickerQuery ? rankByQuery(pickerQuery, allFiles, e => e.title) : allFiles

  const sortedRows: Row[] = (() => {
    const rows: Row[] = entries.map(entry => {
      if (entry.kind !== 'link') return { entry, occ: undefined }
      const target = vaultId ? resolveWikilink(entry.ref, roots, vaultId) : undefined
      return { entry, occ: target ? occBySlug.get(target) : undefined }
    })
    return [...rows].sort((a, b) => {
      const [ga, na, sa] = rowSortKey(a)
      const [gb, nb, sb] = rowSortKey(b)
      if (ga !== gb) return ga - gb
      if (na !== nb) return na - nb
      return sa.localeCompare(sb)
    })
  })()

  const toggleTask = (idx: number, text: string, done: boolean, row?: Row) => {
    // Animate out when marking done; commit immediately (optimistic)
    if (!done && row != null) beginLeave(row)
    const next = [...items]
    next[idx] = serializeTaskEntry(text, !done)
    onChange(next)
  }

  const addTask = (text: string) => {
    const t = text.trim()
    if (!t) return
    onChange([...items, serializeTaskEntry(t, false)])
    setPickerQuery('')
    setPickerOpen(false)
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
    setPickerQuery('')
    setPickerOpen(false)
  }

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
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

  // A row ticked done drops straight out of `activeRows`, so it has to be held
  // back here to have anything left to animate. `rows` is `activeRows` with the
  // held ones spliced back where they were, each flagged `leaving`.
  const { rows: activeRenderRows, beginLeave, endLeave, anyLeaving } =
    useLeavingRows(activeRows, row => row.entry.idx)

  const donePickerRows = (() => {
    const q = pickerQuery.toLowerCase()
    return doneRows.filter(({ entry, occ }) => {
      if (!q) return true
      if (entry.kind === 'task') return entry.text.toLowerCase().includes(q)
      return occ ? occ.metadata.title.toLowerCase().includes(q) : entry.ref.toLowerCase().includes(q)
    })
  })()

  const redoItem = (row: Row) => {
    const { entry, occ } = row
    if (entry.kind === 'task') {
      toggleTask(entry.idx, entry.text, entry.done, undefined)
    } else if (occ) {
      reopenOcc(occ)
    }
    setPickerQuery('')
    setPickerOpen(false)
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
                  // when the file's representative occurrence actually became
                  // dimmed — read post-toggle via the store directly, since the
                  // occBySlug this render closed over is the pre-toggle value.
                  const fresh = fileOccurrenceMap(useStore.getState().entries, roots).get(occ.entryKey)
                  if (!fresh || isDimmed(fresh)) beginLeave(row)
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
            onClick={() => remove(idx)}
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
          onClick={() => remove(idx)}
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
  function renderRow(row: Row, leaving = false) {
    const idx = row.entry.idx
    return (
      <CollapseRow
        key={idx}
        {...(leaving ? {} : { 'data-item-key': idx })}
        collapsed={leaving}
        onCollapsed={() => endLeave(idx)}
        gap={ROW_GAP}
      >
        <div className="flex items-start gap-1">
          {renderRowContent(row)}
        </div>
      </CollapseRow>
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
        <FlipList items={activeRenderRows} itemAttr="data-item-key" suspended={anyLeaving}>
          <div className="flex flex-col" style={{ gap: ROW_GAP }}>
            {activeRenderRows.map(({ item, leaving }) => renderRow(item, leaving))}
          </div>
        </FlipList>

        {/* Add item — half-card affordance, same dimensions as item cards.
            The input never moves once opened (see useFloatingCombobox); only
            the suggestion list floats above or below it. */}
        <div className="flex items-start gap-1">
          <div ref={anchorRef} className="flex-1">
            <Command shouldFilter={false} className="contents">
              {pickerOpen ? (
                <div className="rounded-lg border border-input bg-background">
                  <CommandInput
                    wrapperClassName="border-b-0"
                    placeholder="Add item or link file…"
                    value={pickerQuery}
                    onValueChange={setPickerQuery}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && pickerQuery.trim() && filtered.length === 0) {
                        addTask(pickerQuery)
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-input bg-card/50 pl-2 pr-2.5 py-2 text-left text-muted-foreground shadow-none transition-colors hover:bg-accent"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus size={13} className="shrink-0" />
                  <span className="text-sm">Add item…</span>
                </button>
              )}
              <FloatingComboboxList placement={placement} listRef={listRef} className="w-64">
                <CommandList>
                  {pickerQuery.trim() && (
                    <CommandItem
                      value={`__task__${pickerQuery}`}
                      onSelect={() => addTask(pickerQuery)}
                    >
                      <Tag size={13} className="shrink-0 opacity-60" />
                      <span>Add <strong>"{pickerQuery.trim()}"</strong></span>
                    </CommandItem>
                  )}
                  {donePickerRows.length > 0 && (
                    <CommandGroup heading="Done items">
                      {donePickerRows.slice(0, 8).map(row => {
                        const { entry, occ } = row
                        const label = entry.kind === 'task'
                          ? entry.text
                          : (occ?.metadata.title ?? entry.ref)
                        return (
                          <CommandItem
                            key={entry.idx}
                            value={`__redo__${entry.idx}`}
                            onSelect={() => redoItem(row)}
                          >
                            <CircleCheck size={13} className="shrink-0 opacity-60" />
                            <span className="truncate">{label}</span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  )}
                  {filtered.length > 0 && (
                    <CommandGroup heading="Link file">
                      {filtered.slice(0, 8).map(e => (
                        <CommandItem
                          key={e.fileSlug}
                          value={e.fileSlug}
                          onSelect={() => addLink(e.fileSlug)}
                        >
                          <span className="truncate">{e.title}</span>
                          {e.tags[0] && (
                            <span className="ml-auto text-2xs text-muted-foreground shrink-0">{e.tags[0]}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {!pickerQuery && filtered.length === 0 && donePickerRows.length === 0 && (
                    <CommandEmpty>No files found</CommandEmpty>
                  )}
                </CommandList>
              </FloatingComboboxList>
            </Command>
          </div>
          {/* Spacer matching the X button so the card aligns with cards above */}
          <span className="w-5 shrink-0" aria-hidden="true" />
        </div>

        {doneRows.length > 0 && (
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="flex items-center gap-1 mt-1 text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
              <ChevronDown size={12} className="transition-transform duration-200" />
              Done · {doneRows.length}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-1.5 mt-1.5">
              {doneRows.map(row => renderRow(row))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}
