import { useState } from 'react'
import { Plus, X, Tag, ChevronDown, CircleCheck } from 'lucide-react'
import type { Occurrence, OccurrenceEntry, OccurrenceMetadata, Roots } from '@/types'
import { isStandaloneOcc } from '@/types'
import { occKind, occState } from '@/occView'
import { parseItemEntry, serializeTaskEntry } from './items'
import { fileEntries } from '@/fileOccurrence'
import { useStore } from '@/store'
import { resolveWikilink } from '@/wikilinks'
import { OccurrenceCard, MarkdownTaskCard, TagChip } from '@/components'
import { Card } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { getItems, getRoots } from '@/storeBridge'
import { commitNext } from '@/storeCommit'
import { matchesQuery } from '@/lib/matching'

interface Props {
  items:           string[]
  onChange:        (items: string[]) => void
  roots:           Roots
  currentSlug:     string | null
  onPromote:       (title: string, done: boolean) => string | null
  onOpenWikilink?: (ref: string) => void
  onToggleDone?:   (occ: Occurrence) => void
}

type ParsedEntry = ReturnType<typeof parseItemEntry> & { idx: number }
type Row = { entry: ParsedEntry; occ: Occurrence | undefined }

// Sort order: notes α → events chronologically → open tasks by priority →
// open string tasks (stored) → done tasks + done string tasks α → broken links (stored)
function rowSortKey({ entry, occ }: Row): [number, number, string] {
  if (entry.kind === 'link') {
    if (!occ) return [5, entry.idx, '']
    const s = occState(occ)
    if (s === 'done' || s === 'event-past') {
      return [4, 0, occ.metadata.title?.toLowerCase() ?? '']
    }
    const k = occKind(occ)
    if (k === 'note')  return [0, 0, occ.metadata.title?.toLowerCase() ?? '']
    if (k === 'event') return [1, occ.metadata.jsTime?.getTime() ?? 0, '']
    // task: sort by priority
    const p = occ.metadata.priority
    const prank = p === 'high' ? 0 : p === 'medium' ? 1 : p === 'low' ? 2 : 3
    return [2, prank, occ.metadata.title?.toLowerCase() ?? '']
  }
  // string task
  if (entry.done) return [4, 0, entry.text.toLowerCase()]
  return [3, entry.idx, '']
}

export default function ItemsList({ items, onChange, roots, currentSlug, onPromote, onOpenWikilink, onToggleDone }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [editingIdx,  setEditingIdx]  = useState<number | null>(null)
  const [editText,    setEditText]    = useState('')
  const [exitingEntries, setExitingEntries] = useState<{ row: Row; position: number }[]>([])

  const occBySlug = useStore(s => s.fom)
  const backlinks = useStore(s => s.backlinks)
  const allFiles  = fileEntries(roots)
  const filtered  = pickerQuery
    ? allFiles.filter(e => matchesQuery(pickerQuery, e.title))
    : allFiles

  const entries: ParsedEntry[] = items.map((raw, idx) => ({ ...parseItemEntry(raw), idx }))

  const sortedRows: Row[] = (() => {
    const rows: Row[] = entries.map(entry => {
      if (entry.kind !== 'link') return { entry, occ: undefined }
      const slug = resolveWikilink(entry.ref, roots)
      return { entry, occ: slug ? occBySlug.get(slug) : undefined }
    })
    return [...rows].sort((a, b) => {
      const [ga, na, sa] = rowSortKey(a)
      const [gb, nb, sb] = rowSortKey(b)
      if (ga !== gb) return ga - gb
      if (na !== nb) return na - nb
      return sa.localeCompare(sb)
    })
  })()

  const toggleTask = (idx: number, text: string, done: boolean, row?: Row, position?: number) => {
    // Animate out when marking done; commit immediately (optimistic)
    if (!done && row != null && position != null)
      setExitingEntries(prev => [...prev, { row, position }])
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

  const addLink = (fileSlug: string) => {
    const stored = `[[${fileSlug}]]`
    if (!items.includes(stored)) onChange([...items, stored])
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
    const slug = onPromote(text, done)
    if (!slug) return
    const next = [...items]
    next[idx] = `[[${slug}]]`
    onChange(next)
  }

  const isDoneRow = ({ entry, occ }: Row) => {
    if (entry.kind === 'link') {
      if (!occ) return false
      const s = occState(occ)
      return s === 'done' || s === 'event-past'
    }
    return entry.done
  }

  const activeRows = sortedRows.filter(r => !isDoneRow(r))
  const doneRows   = sortedRows.filter(r => isDoneRow(r))

  // Merge exiting rows back at their original active-list positions so they
  // animate out in-place rather than jumping to the bottom of the list.
  const displayRows: { row: Row; exiting: boolean }[] = (() => {
    const result: { row: Row; exiting: boolean }[] = activeRows.map(row => ({ row, exiting: false }))
    for (const { row, position } of exitingEntries) {
      const at = Math.min(position, result.length)
      result.splice(at, 0, { row, exiting: true })
    }
    return result
  })()

  const donePickerRows = (() => {
    const q = pickerQuery.toLowerCase()
    return doneRows.filter(({ entry, occ }) => {
      if (!q) return true
      if (entry.kind === 'task') return entry.text.toLowerCase().includes(q)
      return occ ? (occ.metadata.title ?? '').toLowerCase().includes(q) : entry.ref.toLowerCase().includes(q)
    })
  })()

  const redoItem = (row: Row) => {
    const { entry, occ } = row
    if (entry.kind === 'task') {
      toggleTask(entry.idx, entry.text, entry.done, undefined)
    } else if (occ) {
      const allItems = getItems()
      const existingUndated = allItems.find(
        i => isStandaloneOcc(i) && i.fileSlug === occ.fileSlug && i.date === '',
      ) as OccurrenceEntry<OccurrenceMetadata> | undefined
      if (existingUndated) {
        commitNext({
          items: allItems.map(i => i.id === existingUndated.id
            ? { ...existingUndated, metadata: { ...existingUndated.metadata, done: false } }
            : i,
          ),
          roots: getRoots(),
        }, [occ.fileSlug])
      } else {
        const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
          date:     '',
          time:     null,
          source:   'explicit',
          fileSlug: occ.fileSlug,
          id:       crypto.randomUUID(),
          metadata: {
            done:         false,
            participants: occ.metadata.participants ?? [],
            priority:     occ.metadata.priority,
            duration:     occ.metadata.duration,
            timezone:     occ.metadata.timezone,
          },
        }
        commitNext({ items: [...allItems, newOcc], roots: getRoots() }, [occ.fileSlug])
      }
    }
    setPickerQuery('')
    setPickerOpen(false)
  }

  function renderRowContent(row: Row, position?: number) {
    const { entry, occ } = row
    const { idx } = entry

    if (entry.kind === 'link') {
      const listedOn = occ
        ? (backlinks.get(occ.fileSlug) ?? [])
            .filter(slug => slug !== currentSlug)
            .map(slug => roots.get(slug)?.title ?? slug)
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
                onOpen={() => onOpenWikilink?.(occ.fileSlug)}
                onToggleDone={() => {
                  if (position != null) setExitingEntries(prev => [...prev, { row, position }])
                  onToggleDone?.(occ)
                }}
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
            onToggle={() => toggleTask(idx, text, done, row, position)}
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

  function renderRow(row: Row, exiting = false, position?: number) {
    const idx = row.entry.idx
    return (
      <div
        key={exiting ? `exit-${idx}` : idx}
        ref={exiting ? (el => {
          // Capture the row's natural height so the keyframe can collapse
          // the slot from a concrete value (CSS can't animate from `auto`).
          if (el && !el.style.getPropertyValue('--row-h')) {
            el.style.setProperty('--row-h', `${el.offsetHeight}px`)
          }
        }) : undefined}
        className={`flex items-start gap-1${exiting ? ' item-exit' : ''}`}
        onAnimationEnd={exiting ? () => setExitingEntries(prev => prev.filter(e => e.row.entry.idx !== idx)) : undefined}
      >
        {renderRowContent(row, position)}
      </div>
    )
  }

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase mb-2.5">Items</div>
      <div className="flex flex-col gap-1.5">
        {displayRows.map(({ row, exiting }, position) => renderRow(row, exiting, position))}

        {/* Add item — half-card affordance, same dimensions as item cards */}
        <div className="flex items-start gap-1">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Card className="flex-1 flex items-center gap-2 pl-2 pr-2.5 py-2 border-dashed bg-transparent shadow-none cursor-pointer hover:bg-accent transition-colors text-muted-foreground">
                <Plus size={13} className="shrink-0" />
                <span className="text-sm">Add item…</span>
              </Card>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Add item or link file…"
                  value={pickerQuery}
                  onValueChange={setPickerQuery}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && pickerQuery.trim() && filtered.length === 0) {
                      addTask(pickerQuery)
                    }
                  }}
                />
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
              </Command>
            </PopoverContent>
          </Popover>
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
