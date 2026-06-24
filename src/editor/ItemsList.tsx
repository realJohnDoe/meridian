import { useState, useCallback, useMemo } from 'react'
import { Plus, X, Tag, ChevronDown } from 'lucide-react'
import type { Occurrence, Roots } from '@/types'
import { occKind, occState } from '@/occView'
import { parseItemEntry, serializeTaskEntry } from './items'
import { fileEntries } from '@/fileOccurrence'
import { useStore } from '@/store'
import { useParticipantFilter, NO_PARTICIPANT } from '@/hooks/useParticipantFilter'
import { resolveWikilink } from '@/wikilinks'
import OccurrenceCard from '@/components/OccurrenceCard'
import MarkdownTaskCard from '@/components/MarkdownTaskCard'
import TagChip from '@/components/TagChip'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'

interface Props {
  items:           string[]
  onChange:        (items: string[]) => void
  roots:           Roots
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

export default function ItemsList({ items, onChange, roots, onPromote, onOpenWikilink, onToggleDone }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [editingIdx,  setEditingIdx]  = useState<number | null>(null)
  const [editText,    setEditText]    = useState('')

  const occBySlug = useStore(s => s.fom)
  const allFiles  = useMemo(() => fileEntries(roots), [roots])
  const filtered  = pickerQuery
    ? allFiles.filter(e => e.title.toLowerCase().includes(pickerQuery.toLowerCase()))
    : allFiles

  const { filter: participantFilter } = useParticipantFilter()

  const entries: ParsedEntry[] = useMemo(
    () => items.map((raw, idx) => ({ ...parseItemEntry(raw), idx })),
    [items],
  )

  const sortedRows: Row[] = useMemo(() => {
    const rows: Row[] = entries.map(entry => {
      if (entry.kind !== 'link') return { entry, occ: undefined }
      const slug = resolveWikilink(entry.ref, roots)
      return { entry, occ: slug ? occBySlug.get(slug) : undefined }
    })
    const sorted = [...rows].sort((a, b) => {
      const [ga, na, sa] = rowSortKey(a)
      const [gb, nb, sb] = rowSortKey(b)
      if (ga !== gb) return ga - gb
      if (na !== nb) return na - nb
      return sa.localeCompare(sb)
    })
    if (!participantFilter.length) return sorted
    return sorted.filter(({ entry, occ }) => {
      if (entry.kind === 'link') {
        if (!occ) return true // broken link: always show
        const ps = occ.metadata.participants
        if (participantFilter.includes(NO_PARTICIPANT) && ps.length === 0) return true
        return ps.some(p => participantFilter.includes(p))
      }
      // string task: no participants → show only if NO_PARTICIPANT is checked
      return participantFilter.includes(NO_PARTICIPANT)
    })
  }, [entries, occBySlug, roots, participantFilter])

  const addTask = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    onChange([...items, serializeTaskEntry(t, false)])
    setPickerQuery('')
    setPickerOpen(false)
  }, [items, onChange])

  const addLink = useCallback((fileSlug: string) => {
    const stored = `[[${fileSlug}]]`
    if (!items.includes(stored)) onChange([...items, stored])
    setPickerQuery('')
    setPickerOpen(false)
  }, [items, onChange])

  const remove = useCallback((idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
  }, [items, onChange])

  const toggleTask = useCallback((idx: number, text: string, done: boolean) => {
    const next = [...items]
    next[idx] = serializeTaskEntry(text, !done)
    onChange(next)
  }, [items, onChange])

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

  function renderRow({ entry, occ }: Row) {
    const { idx } = entry

    if (entry.kind === 'link') {
      return (
        <div key={idx} className="flex items-start gap-1">
          <div className="flex-1 min-w-0">
            {occ ? (
              <OccurrenceCard
                occ={occ}
                leadingIcon="both"
                showTime="none"
                showTagsParticipants={false}
                onOpen={() => onOpenWikilink?.(occ.fileSlug)}
                onToggleDone={() => onToggleDone?.(occ)}
              />
            ) : (
              <TagChip label={entry.ref} isTopic className="opacity-50 line-through" />
            )}
          </div>
          <button
            type="button"
            className="shrink-0 mt-[9px] p-1 text-muted-foreground hover:text-foreground"
            onClick={() => remove(idx)}
            aria-label="Remove"
          >
            <X size={13} />
          </button>
        </div>
      )
    }

    // String task
    const { text, done } = entry
    const isEditing = editingIdx === idx
    return (
      <div key={idx} className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <MarkdownTaskCard
            text={text}
            done={done}
            onToggle={() => toggleTask(idx, text, done)}
            onPromote={() => promote(idx, text, done)}
            onClickText={isEditing ? undefined : () => startEdit(idx, text)}
            editValue={isEditing ? editText : undefined}
            onEditChange={setEditText}
            onEditCommit={() => commitEdit(idx, done)}
            onEditCancel={() => setEditingIdx(null)}
          />
        </div>
        <button
          type="button"
          className="shrink-0 mt-[9px] p-1 text-muted-foreground hover:text-foreground"
          onClick={() => remove(idx)}
          aria-label="Remove"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase mb-2.5">Items</div>
      <div className="flex flex-col gap-1.5">
        {/* Add item — half-card affordance, same dimensions as item cards */}
        <div className="flex items-start gap-1">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Card className="flex-1 flex items-center gap-2 pl-[8px] pr-[10px] py-[8px] border-dashed bg-transparent shadow-none cursor-pointer hover:bg-accent transition-colors text-muted-foreground">
                <Plus size={13} className="shrink-0" />
                <span className="text-[13px]">Add item…</span>
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
                    <CommandGroup heading="Item">
                      <CommandItem
                        value={`__task__${pickerQuery}`}
                        onSelect={() => addTask(pickerQuery)}
                      >
                        <Tag size={13} className="shrink-0 opacity-60" />
                        <span>Add <strong>"{pickerQuery.trim()}"</strong> as item</span>
                      </CommandItem>
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
                            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{e.tags[0]}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {!pickerQuery && filtered.length === 0 && (
                    <CommandEmpty>No files found</CommandEmpty>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {/* Spacer matching the X button so the card aligns with cards above */}
          <span className="w-[21px] shrink-0" aria-hidden="true" />
        </div>

        {activeRows.map(row => renderRow(row))}

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
