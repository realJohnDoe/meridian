import { useState, useCallback, useRef, useEffect } from 'react'
import { startOfToday } from 'date-fns'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from './save'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO } from '@/model'
import { useToday } from '@/hooks'
import { newEntryRoute } from '@/routes'
import { resolveWikilink } from '@/wikilinks'
import { type EntryState, type ItemType, ENTRY_DEFAULT } from './state'
import { useEntryDialogs } from './useEntryDialogs'

export type { DialogHandlers } from './useEntryDialogs'

function entryFromItem(item: Occurrence | null, editScope: EditScope): EntryState {
  if (!item) {
    return { ...ENTRY_DEFAULT, editScope, scheduled: { date: fmtISO(startOfToday()), time: '' } }
  }
  return entryFromOccurrence(item, editScope)
}

export function useEntryEditor(initialOcc: Occurrence | null, initialScope: EditScope = 'single', initialTitle?: string) {
  const defaultParticipants = useStore.getState().defaultParticipants
  const today = useToday()

  const [entry, setEntry] = useState<EntryState>(() => {
    const base = entryFromItem(initialOcc, initialScope)
    const seeded = (!initialOcc && defaultParticipants.length > 0)
      ? { ...base, participants: [...defaultParticipants] }
      : base
    return initialTitle ? { ...seeded, title: initialTitle } : seeded
  })

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Populated by EntryEditor once CodeMirror mounts; used by saveMeta to capture current body
  const getBodyRef = useRef<() => string>(() => '')
  // Populated by EntryEditor; allows topbar Save button to trigger a full save (body + pending links)
  const triggerSaveRef = useRef<() => void>(() => {})
  // Always points to the latest entry so timer callbacks don't close over stale state
  const entryRef = useRef(entry)
  useEffect(() => { entryRef.current = entry }, [entry])

  const saveMeta = useCallback((next: EntryState) => {
    if (!next.item || next.editScope === 'add') return
    saveNode(next.item, next.editScope, { ...next, body: getBodyRef.current() })
  }, [])

  const updateEntry = useCallback((next: EntryState) => {
    setEntry(next)
    saveMeta(next)
  }, [saveMeta])

  const scheduleAutoSave = useCallback((body: string) => {
    if (!entryRef.current.item) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      const e = entryRef.current
      saveNode(e.item!, e.editScope, { ...e, body })
      autosaveTimerRef.current = null
    }, 1500)
  }, [])

  const storeRoots = useStore(s => s.roots)
  const navigate = useNavigate()
  const router = useRouter()

  const handleOpenWikilink = useCallback((ref: string) => {
    const fileSlug = resolveWikilink(ref, storeRoots)
    if (!fileSlug) {
      navigate(newEntryRoute(ref))
      return
    }
    navigate({ to: '/entry/$slug', params: { slug: fileSlug } })
  }, [storeRoots, navigate])

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.history.back()
    else navigate({ to: '/' })
  }, [router, navigate])

  const handleSave = useCallback((body: string) => {
    const result = saveNode(entry.item, entry.editScope, { ...entry, body })
    if (result === 'saved') goBack()
  }, [entry, goBack])

  const dialogs = useEntryDialogs(entry, updateEntry)
  const { setSeriesSheetConfig, setPendingDelete } = dialogs

  const handleDelete = useCallback(() => {
    deleteNode(
      entry.item,
      goBack,
      setSeriesSheetConfig,
      () => setSeriesSheetConfig(null),
      (title, onConfirm) => setPendingDelete({ title, onConfirm }),
    )
  }, [entry.item, goBack, setSeriesSheetConfig, setPendingDelete])

  const handleClose = useCallback(() => goBack(), [goBack])

  const handleScopeChange = useCallback((scope: EditScope) => {
    if (!entry.item) return
    const { scheduled, repeat } = applyScope(entry.item, scope)
    updateEntry({ ...entry, editScope: scope, scheduled, repeat })
  }, [entry, updateEntry])

  const handleTypeChange = useCallback((t: ItemType) => {
    updateEntry({
      ...entry,
      itemType: t,
      tracked: t === 'task',
      priority: t !== 'task' ? null : entry.priority,
      scheduled:
        t === 'note'                         ? null
        : t === 'event' && !entry.scheduled  ? { date: fmtISO(today), time: '' }
        : entry.scheduled,
    })
  }, [entry, today, updateEntry])

  const handleDoneToggle = useCallback(() => {
    updateEntry({ ...entry, done: !entry.done })
  }, [entry, updateEntry])

  return {
    entry, setEntry,
    getBodyRef,
    triggerSaveRef,
    saveMeta,
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleClose,
    handleScopeChange,
    handleTypeChange,
    handleDoneToggle,
    handleOpenDlg: dialogs.handleOpenDlg,
    handleOpenRepeatDlg: dialogs.handleOpenRepeatDlg,
    dialogHandlers: dialogs.dialogHandlers,
    scheduleAutoSave,
  }
}
