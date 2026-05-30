import { useState, useEffect, useCallback } from 'react'
import {
  Menu, FolderSync, FolderOpen, CalendarCheck2, Search,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, X, Bug,
} from 'lucide-react'
import {
  initApp, applyScope, buildBodyHtml,
  saveNode, deleteNode, closeEntry, pushOverlay,
  openDayViewForDate, goToday, openSearch,
  syncToDirectory, pickDirectory,
  addDays, fmtLong,
} from './meridian'
import type { SeriesSheetConfig } from './meridian'
import { fmtISO } from './model/expand'
import { TODAY } from './constants'
import { useStore } from './store'
import type { PrimaryView } from './store'
import EntryEditor, { EntryState, ENTRY_DEFAULT, ItemType } from './components/EntryEditor'
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
import SearchView from './components/SearchView'
import FilterOverlay from './components/FilterOverlay'
import NodeInheritanceDebugger from './debug/NodeInheritanceDebugger'
import type { Occurrence, Priority } from './types'


function entryFromItem(item: any, editScope: string): EntryState {
  if (!item) {
    return { ...ENTRY_DEFAULT, scheduled: { date: fmtISO(TODAY), time: '' } }
  }
  const root = item._node || item
  const { scheduled, repeat } = applyScope(item, editScope)
  const tracked = item.done !== undefined || root.done !== undefined
  const itemType: ItemType = tracked ? 'task' : scheduled ? 'event' : 'note'
  return {
    item: { ...item, _editScope: editScope },
    title: item.title || root.title || '',
    bodyHtml: buildBodyHtml(item.body || root.body || ''),
    scheduled,
    repeat,
    duration: item.duration || root.duration || '',
    tracked,
    itemType,
    done: item.done || false,
    tags: [...(item.tags || root.tags || [])],
    priority: item.priority || root.priority || null,
    editScope,
  }
}

export default function App() {
  const [entry, setEntry] = useState<EntryState>(ENTRY_DEFAULT)
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  // ── Navigation state (source of truth) ───────────────────────
  const primaryView  = useStore(s => s.primaryView)
  const setPrimary   = useStore(s => s.setPrimaryView)
  const overlayStack = useStore(s => s.overlayStack)
  const popOverlay   = useStore(s => s.popOverlay)
  const topOverlay   = overlayStack[overlayStack.length - 1] // 'entry' | 'search' | undefined

  const dvDate    = useStore(s => s.dvDate)
  const setDvDate = useStore(s => s.setDvDate)

  const syncDirtyCount   = useStore(s => s.syncDirtyCount)
  const syncFlash        = useStore(s => s.syncFlash)
  const dirHandle        = useStore(s => s.dirHandle)
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
  // Also hidden in debug view which renders its own full-screen header
  const showTopbar     = topOverlay === undefined && primaryView !== 'debug'
  const showDayHeader  = showTopbar && primaryView === 'day'
  // Bottom search bar: hidden inside overlays and in debug view
  const showBottomFloat = topOverlay === undefined && primaryView !== 'debug'

  useEffect(() => {
    initApp()
    // Scroll agenda to today after AgendaView has rendered its sections.
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}"]`)
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
    closeEntry()
  }, [])

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

  return (
    <>
      <div id="app">

        {/* ── TOPBAR ── visible only when no overlay is active */}
        {showTopbar && (
          <header className="topbar" id="mainTop">
            {showDayHeader ? (
              /* Day-view header: date title + prev/next navigation */
              <div className="tb-l" style={{ flex: 1, gap: 4, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <span style={{ flex: 1, fontFamily: 'var(--disp)', fontStyle: 'italic', fontSize: 15, color: 'var(--t0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              <button className="ib" onClick={pickDirectory} title="Open vault"><FolderOpen /></button>
              <button className="ib" onClick={goToday} title="Today"><CalendarCheck2 /></button>
              <button className="ib" onClick={openSearch} title="Search"><Search /></button>
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

        {/* Debug view breaks out of the 430px mobile container to use full viewport */}
        <section
          className={viewCls('debug')}
          id="view-debug"
          style={primaryView === 'debug' && !topOverlay
            ? { position: 'fixed', inset: 0, maxWidth: 'none', zIndex: 5 }
            : undefined}
        >
          {primaryView === 'debug' && (
            <NodeInheritanceDebugger
              onOpenEntry={(occ: Occurrence) => openEntry(occ, 'single')}
              onClose={() => navTo('agenda')}
            />
          )}
        </section>

        {/* ── OVERLAY VIEWS ── */}
        <section className={viewCls('search')} id="view-search">
          <SearchView
            onOpen={(item: any, scope?: string) => {
              openEntry(item, scope ?? (item?._node ? 'single' : 'all'))
            }}
            onClose={popOverlay}
          />
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
            <button
              className={`sni${primaryView === 'debug' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('debug')}
            >
              <Bug />Debugger
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
