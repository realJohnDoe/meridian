import { useState, useEffect, useCallback } from 'react'
import {
  Menu, FolderSync, FolderOpen, CalendarCheck2,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, X, Search,
} from 'lucide-react'
import { initApp, syncToDirectory, pickDirectory, tryRestoreDirectory, reconnectDirectory } from './vault'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from './mutations'
import type { SeriesSheetConfig } from './mutations'
import { buildBodyHtml, addDays, fmtLong, targetOccurrence } from './presentation'
import { openDayViewForDate, goToday } from './navigation'
import { fmtISO } from './model/expansion'
import { TODAY } from './constants'
import { useStore } from './store'
import type { PrimaryView } from './store'
import EntryEditor, { EntryState, ENTRY_DEFAULT } from './components/EntryEditor'
import RepeatDialog from './components/RepeatDialog'
import DatePickerDialog from './components/DatePickerDialog'
import DeleteDialog from './components/DeleteDialog'
import SeriesDeleteDialog from './components/SeriesDeleteDialog'
import PriorityDrawer from './components/PriorityDrawer'
import TimePickerDialog from './components/TimePickerDialog'
import DurationDialog from './components/DurationDialog'
import UndoToast from './components/UndoToast'
import AgendaView from './components/AgendaView'
import MonthView from './components/MonthView'
import DayView from './components/DayView'
import FilterOverlay from './components/FilterOverlay'
import type { Occurrence, Priority } from './types'
import { resolveWikilink } from './wikilinks'
import { cn } from './lib/utils'


function entryFromItem(item: any, editScope: string): EntryState {
  if (!item) {
    return { ...ENTRY_DEFAULT, scheduled: { date: fmtISO(TODAY), time: '' } }
  }
  return entryFromOccurrence(item, editScope, buildBodyHtml)
}

export default function App() {
  const [entry, setEntry] = useState<EntryState>(ENTRY_DEFAULT)
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  // ── Navigation state (source of truth) ───────────────────────
  const storeItems   = useStore(s => s.items)
  const storeRoots   = useStore(s => s.roots)
  const primaryView  = useStore(s => s.primaryView)
  const setPrimary   = useStore(s => s.setPrimaryView)
  const overlayStack = useStore(s => s.overlayStack)
  const pushOverlay  = useStore(s => s.pushOverlay)
  const popOverlay   = useStore(s => s.popOverlay)
  const topOverlay   = overlayStack[overlayStack.length - 1] // 'entry' | undefined

  const dvDate    = useStore(s => s.dvDate)
  const setDvDate = useStore(s => s.setDvDate)

  const syncDirtyCount   = useStore(s => s.syncDirtyCount)
  const syncFlash        = useStore(s => s.syncFlash)
  const dirHandle        = useStore(s => s.dirHandle)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)
  const errorNotification = useStore(s => s.errorNotification)
  const setErrorNotification = useStore(s => s.setErrorNotification)

  // Derive sync-button appearance from store state (replaces updateSyncUI DOM writes)
  const syncColor = syncFlash
    ? 'var(--grn)'
    : !dirHandle ? 'var(--t3)' : syncDirtyCount > 0 ? 'var(--amb)' : 'var(--t2)'
  const syncTitle = !dirHandle
    ? 'Click folder icon to open vault'
    : syncDirtyCount > 0
      ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''} — click to sync`
      : 'All synced'

  // Derive CSS class for each section — only one is 'active' at a time
  const viewCls = (name: string) => {
    const active = topOverlay ? name === topOverlay : name === primaryView
    return active ? 'view active' : 'view'
  }

  // Topbar is hidden while an overlay is open (each has its own header)
  const showTopbar     = topOverlay === undefined
  const showDayHeader  = showTopbar && primaryView === 'day'
  // Bottom search bar: hidden inside overlays
  const showBottomFloat = topOverlay === undefined

  useEffect(() => {
    initApp()
    tryRestoreDirectory()
    // Scroll agenda to today after AgendaView has rendered its sections.
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    }, 200)
    // Close the active dialog when the user presses Escape.
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveDialog(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const openEntry = useCallback((item: any, scope?: string, prefillTitle?: string) => {
    const editScope = scope ?? (item ? 'single' : 'all')
    const state = entryFromItem(item, editScope)
    setEntry(prefillTitle && !item ? { ...state, title: prefillTitle } : state)
    pushOverlay('entry')
  }, [])

  /**
   * Navigate to a wikilink ref — resolve to a file root node, find the best
   * occurrence (next upcoming or last past), and open the entry editor.
   * If the ref can't be resolved to a known file, pre-fill a new entry with
   * the ref as the title so the user can create it.
   */
  const handleOpenWikilink = useCallback((ref: string) => {
    const fileSlug = resolveWikilink(ref, storeRoots)
    if (fileSlug) {
      const occ = targetOccurrence(fileSlug, storeItems, storeRoots)
      if (occ) { openEntry(occ, 'single'); return }
    }
    // No occurrence found — open as new entry prefilled with the ref/title
    const prefillTitle = fileSlug ? (storeRoots.get(fileSlug)?.title ?? ref) : ref
    openEntry(null, undefined, prefillTitle)
  }, [storeRoots, storeItems, openEntry])

  const handleSave = useCallback((body: string) => {
    saveNode(entry.item, entry.editScope, { ...entry, body })
  }, [entry])

  const handleDelete = useCallback(() => {
    deleteNode(
      entry.item,
      (config) => setSeriesSheetConfig(config),
      () => setSeriesSheetConfig(null),
      (title, onConfirm) => setPendingDelete({ title, onConfirm }),
    )
  }, [entry.item])

  const handleClose = useCallback(() => {
    popOverlay()
  }, [popOverlay])

  const handleScopeChange = useCallback((scope: string) => {
    setEntry(prev => {
      if (!prev.item) return prev
      const { scheduled, repeat } = applyScope(prev.item, scope)
      return { ...prev, editScope: scope, scheduled, repeat }
    })
  }, [])

  const handleOpenDlg = useCallback((id: string) => {
    setActiveDialog(id)
  }, [])

  const handleOpenRepeatDlg = useCallback((_itemType?: string) => {
    setActiveDialog('dlgRepeat')
  }, [])

  const closeDialog = useCallback(() => setActiveDialog(null), [])

  const handleDateConfirm = useCallback((dateStr: string) => {
    setEntry(prev => ({ ...prev, scheduled: { date: dateStr, time: prev.scheduled?.time || '' } }))
    setActiveDialog(null)
  }, [])

  const handleDateRemove = useCallback(() => {
    setEntry(prev => ({ ...prev, scheduled: null, duration: '' }))
    setActiveDialog(null)
  }, [])

  const confirmTime = useCallback((hhmm: string) => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: hhmm } } : prev)
  }, [])

  const removeTime = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: '' } } : prev)
  }, [])

  const confirmDur = useCallback((dur: string) => {
    setEntry(prev => ({ ...prev, duration: dur }))
  }, [])

  const removeDur = useCallback(() => {
    setEntry(prev => ({ ...prev, duration: '' }))
  }, [])


  const setPriority = useCallback((p: Priority | null) => {
    setEntry(prev => ({ ...prev, priority: p }))
    setActiveDialog(null)
  }, [])

  // Sidebar nav: switch primary view and close the panel
  const navTo = (v: PrimaryView) => {
    setSidebarOpen(false)
    setPrimary(v)
  }

  // Suppress unused-variable warning — popOverlay is wired but SearchView removed;
  // keep it in scope for future overlays.
  void popOverlay

  return (
    <>
      <div id="app">

        {/* ── TOPBAR ── visible only when no overlay is active */}
        {showTopbar && (
          <header className="topbar" id="mainTop">
            {showDayHeader ? (
              /* Day-view header: date title + prev/next navigation */
              <div className="tb-l tb-l--day">
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <span className="dv-date-title">
                  {fmtLong(dvDate)}
                </span>
                <button className="ib" onClick={() => setDvDate(addDays(dvDate, -1))}><ChevronLeft /></button>
                <button className="ib" onClick={() => setDvDate(addDays(dvDate, 1))}><ChevronRight /></button>
              </div>
            ) : (
              /* Default header: logo + app name */
              <div className="tb-l" id="tbDefault">
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
                <span className="vault-name">Meridian</span>
              </div>
            )}
            <div className="tb-r">
              <button className="ib" onClick={syncToDirectory} title={syncTitle} style={{ color: syncColor }}><FolderSync /></button>
              <button
                className={cn('ib', pendingDirReconnect && !dirHandle && 'text-[var(--amb)]')}
                onClick={pendingDirReconnect && !dirHandle ? reconnectDirectory : pickDirectory}
                title={pendingDirReconnect && !dirHandle ? `Reconnect vault "${pendingDirReconnect}"` : 'Open vault'}
              ><FolderOpen /></button>
              <button className="ib" onClick={goToday} title="Today"><CalendarCheck2 /></button>
            </div>
          </header>
        )}

        {/* ── PRIMARY VIEWS ── */}
        <section className={viewCls('agenda')} id="view-agenda">
          <div className="ag-sc" id="agSc">
            <AgendaView onOpen={(occ: Occurrence, scope?: string) => {
              openEntry(occ, scope ?? 'single')
            }} />
          </div>
        </section>

        <section className={viewCls('calendar')} id="view-calendar">
          <MonthView onDayClick={openDayViewForDate} />
        </section>

        <section className={viewCls('day')} id="view-day">
          <DayView onOpen={(occ: Occurrence, scope?: string) => {
            openEntry(occ, scope ?? 'single')
          }} />
        </section>

        <section className={viewCls('entry')} id="view-entry">
          <EntryEditor
            entry={entry}
            onChange={setEntry}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={handleClose}
            onOpenDlg={handleOpenDlg}
            onOpenRepeatDlg={handleOpenRepeatDlg}
            onScopeChange={handleScopeChange}
            items={storeItems}
            roots={storeRoots}
            onOpenWikilink={handleOpenWikilink}
          />
        </section>

        {/* ── SIDEBAR ── */}
        <div
          className={`sidebar-ov${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />
        <div className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-head">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
            <span className="sidebar-title">Meridian</span>
          </div>
          <div className="sidebar-body">
            <button
              className={`sni${primaryView === 'agenda' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('agenda')}
            >
              <AlignLeft />Agenda
            </button>
            <button
              className={`sni${primaryView === 'calendar' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('calendar')}
            >
              <CalendarDays />Month
            </button>
            <button
              className={`sni${primaryView === 'day' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('day')}
            >
              <CalendarClock />Day
            </button>
          </div>
        </div>

        {/* ── FILTER OVERLAY ── sits above views, below topbar and search bar */}
        {showBottomFloat && (
          <FilterOverlay
            query={filterQuery}
            onOpen={(occ: Occurrence) => {
              openEntry(occ, 'single')
            }}
            onCreate={(title: string) => {
              openEntry(null, undefined, title)
              setFilterQuery('')
            }}
          />
        )}

        {/* ── BOTTOM FLOAT: toast (above) + search bar (below) ── */}
        {showBottomFloat && (
          <div className="bottom-float">
            <UndoToast />
            <div className="search-bar-wrap">
              <Search size={15} className="search-bar-icon" />
              <input
                id="filterInput"
                className="search-bar-input"
                placeholder="Search or create…"
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && filterQuery) {
                    openEntry(null, undefined, filterQuery)
                    setFilterQuery('')
                  }
                }}
              />
              {filterQuery && (
                <button className="search-bar-clear" onClick={() => setFilterQuery('')}>
                  <X size={13} />
                </button>
              )}
              <button
                className="search-bar-add"
                onClick={() => {
                  openEntry(null, undefined, filterQuery || undefined)
                  if (filterQuery) setFilterQuery('')
                }}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}

      </div>{/* end #app */}

      {/* ── DIALOGS ── */}

      {/* DATE — shadcn Dialog + react-day-picker Calendar */}
      <DatePickerDialog
        open={activeDialog === 'dlgSched'}
        initialDate={entry.scheduled?.date || fmtISO(TODAY)}
        onConfirm={handleDateConfirm}
        onRemove={handleDateRemove}
        onClose={closeDialog}
      />

      {/* PRIORITY */}
      <PriorityDrawer
        open={activeDialog === 'dlgPriority'}
        value={entry.priority}
        onSelect={setPriority}
        onClose={closeDialog}
      />

      {/* TIME */}
      <TimePickerDialog
        open={activeDialog === 'dlgTime'}
        value={entry.scheduled?.time || ''}
        onConfirm={confirmTime}
        onRemove={removeTime}
        onClose={closeDialog}
      />

      {/* DURATION */}
      <DurationDialog
        open={activeDialog === 'dlgDur'}
        value={entry.duration || ''}
        onConfirm={confirmDur}
        onRemove={removeDur}
        onClose={closeDialog}
      />

      {/* REPEAT DLG */}
      <RepeatDialog
        open={activeDialog === 'dlgRepeat'}
        scheduled={entry.scheduled}
        tracked={entry.tracked}
        itemType={entry.itemType}
        repeat={entry.repeat}
        onConfirm={repeat => { setEntry(prev => ({ ...prev, repeat })); setActiveDialog(null) }}
        onRemove={() => { setEntry(prev => ({ ...prev, repeat: null })); setActiveDialog(null) }}
        onClose={() => setActiveDialog(null)}
      />

      {/* SERIES DELETE */}
      <SeriesDeleteDialog
        config={seriesSheetConfig}
        onClose={() => setSeriesSheetConfig(null)}
      />

      {/* ── ERROR NOTIFICATION BANNER ── */}
      {errorNotification && (
        <div className="error-banner" role="alert">
          <span className="error-banner-msg">{errorNotification}</span>
          <button className="error-banner-close" onClick={() => setErrorNotification(null)}><X size={13} /></button>
        </div>
      )}

      {/* DELETE CONFIRM */}
      <DeleteDialog
        open={!!pendingDelete}
        title={pendingDelete?.title ?? ''}
        onConfirm={() => pendingDelete?.onConfirm()}
        onClose={() => setPendingDelete(null)}
      />
    </>
  )
}
